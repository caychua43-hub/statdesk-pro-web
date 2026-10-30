import { LIMITS, createDataset, defaultConfig, parseCsv, parseBackup, serializeBackup, exportCsv, loadLibrary, saveProject, removeProject } from '../../packages/core/index.js';
import { AppState } from './state.js';
import { labels, table } from './render.js';
import { renderPro } from './pro-render.js';
import { compareDecimalText } from '../../packages/core/pro.js';
const $ = (id) => document.getElementById(id);
const input = (id) => $(id);
const select = (id) => $(id);
const state = new AppState();
let worker = null;
let library = [];
let elapsed = 0;
let configValid = true;
let importGeneration = 0;
const prefKey = 'statdesk.pro.preferences.v1';
let pro = { mode: 'precision', digits: 2, pairColumn: null };
let reducedMotion = false;
let darkTheme = false;
try {
    const saved = JSON.parse(localStorage.getItem(prefKey) ?? 'null');
    if (saved?.version === 1) {
        if (['precision', 'distribution', 'relationship'].includes(saved.mode))
            pro.mode = saved.mode;
        if (Number.isInteger(saved.digits) && saved.digits >= 0 && saved.digits <= 50)
            pro.digits = saved.digits;
        reducedMotion = saved.reducedMotion === true;
        darkTheme = saved.theme === 'dark';
    }
}
catch { }
const preferenceSaveError = 'Không thể lưu tùy chọn giao diện trên thiết bị này.';
const savePrefs = () => { try {
    localStorage.setItem(prefKey, JSON.stringify({ version: 1, mode: pro.mode, digits: pro.digits, reducedMotion, theme: darkTheme ? 'dark' : 'light' }));
    return true;
}
catch {
    return false;
} };
const status = (message) => { $('status').textContent = message; };
function error(e, source = 'data') { const x = e; const details = x.issues?.map(i => `${source === 'csv' ? 'Dòng CSV' : 'Hàng dữ liệu'} ${i.row}, cột ${i.column}: ${i.code}`).join('; '); status(`${x.code ?? 'LỖI'}: ${x.message ?? String(e)}${details ? ' — ' + details : ''}${x.issueCount > 20 ? ` (${x.issueCount} lỗi)` : ''}`); }
function stop() { worker?.terminate(); worker = null; state.cancel(); $('cancel').disabled = true; $('calculate').setAttribute('aria-busy', 'false'); }
function freshness() { const marker = $('result-freshness'); marker.hidden = !state.resultStale; marker.textContent = state.resultStale ? 'Kết quả trước đó chưa cập nhật theo thiết lập hiện tại. Hãy tính lại trước khi sử dụng hoặc in.' : ''; $('view-results').hidden = !state.result || state.resultStale; }
function dirty() { $('dirty').textContent = state.project ? (state.dirty ? 'Có thay đổi chưa lưu' : 'Đã lưu') : 'Chưa có dữ liệu'; }
function options(s, items, selected) { s.replaceChildren(); for (const [value, label] of items) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    s.append(o);
} s.value = selected; }
function controls() { const p = state.project; if (!p)
    return; const c = p.config, cols = p.dataset.columns.map((name, i) => [String(i), name]); options(select('value'), cols, String(c.valueColumn)); options(select('group'), [['', 'Không nhóm'], ...cols], c.groupColumn === null ? '' : String(c.groupColumn)); options(select('sort'), [['', 'Không sắp xếp'], ...cols], c.sort === null ? '' : String(c.sort.column)); options(select('pair'), [['', 'Chọn cột Y'], ...cols], pro.pairColumn === null ? '' : String(pro.pairColumn)); if (pro.pairColumn !== null && pro.pairColumn >= cols.length) {
    pro.pairColumn = null;
    select('pair').value = '';
} suggestColumns(); select('direction').value = c.sort?.direction ?? 'asc'; select('missing').value = c.missing; select('decimal').value = c.decimal; input('precision').value = String(c.precision); input('groupFilter').value = c.groupFilter; input('query').value = c.query; const box = $('metrics'); box.replaceChildren(); for (const [key, label] of Object.entries(labels)) {
    const l = document.createElement('label'), check = document.createElement('input');
    check.type = 'checkbox';
    check.value = key;
    check.checked = c.metrics.includes(key);
    check.dataset.metric = key;
    l.append(check, document.createTextNode(label));
    box.append(l);
} const preview = $('preview'); preview.replaceChildren(); preview.append(document.createTextNode(`${p.dataset.name} — ${p.dataset.rows.length} hàng, ${p.dataset.columns.length} cột`), table(p.dataset, p.dataset.rows.map((_, i) => i), 20)); dirty(); }
function suggestColumns() { const p = state.project; if (!p)
    return; const host = $('suggestion'); host.replaceChildren(document.createTextNode('Cột có dữ liệu số hợp lệ (chọn để dùng): ')); const decimal = p.config.decimal; const valid = (v) => { try {
    compareDecimalText(v, v, decimal);
    return true;
}
catch {
    return false;
} }; let found = false; p.dataset.columns.forEach((name, i) => { const values = p.dataset.rows.map(row => row[i].trim()).filter(Boolean); if (values.length && values.every(valid)) {
    found = true;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'suggestion';
    b.textContent = name;
    b.onclick = () => { select('value').value = String(i); config(); };
    host.append(b);
} }); if (!found)
    host.append(document.createTextNode('Không có gợi ý; kiểm tra dấu thập phân và dữ liệu.')); }
function proControls() { for (const b of document.querySelectorAll('[data-mode]'))
    b.setAttribute('aria-pressed', String(b.dataset.mode === pro.mode)); $('pair-label').hidden = pro.mode !== 'relationship'; input('pro-digits').value = String(pro.digits); document.body.classList.toggle('reduce-motion', reducedMotion); document.body.classList.toggle('dark', darkTheme); $('theme').setAttribute('aria-pressed', String(darkTheme)); $('motion').setAttribute('aria-pressed', String(reducedMotion)); }
function proChanged() { stop(); state.invalidateResult(); freshness(); const saved = savePrefs(); proControls(); status(saved ? 'Thiết lập đã thay đổi. Tính lại để cập nhật kết quả.' : preferenceSaveError); }
function replace(p, saved = false) { state.replace(p); pro.pairColumn = null; importGeneration++; stop(); state.dirty = !saved; configValid = true; controls(); $('data-entry').open = false; $('result').textContent = 'Dữ liệu đã thay đổi. Nhấn Tính toán để xem kết quả.'; freshness(); }
function config() { if (!state.project)
    return; const c = state.project.config; try {
    state.update({ ...c, valueColumn: Number(select('value').value), groupColumn: select('group').value === '' ? null : Number(select('group').value), groupFilter: input('groupFilter').value, query: input('query').value, missing: select('missing').value, decimal: select('decimal').value, precision: Number(input('precision').value), sort: select('sort').value === '' ? null : { column: Number(select('sort').value), direction: select('direction').value }, metrics: [...document.querySelectorAll('#metrics input:checked')].map(x => x.value) });
    configValid = true;
    stop();
    dirty();
    freshness();
    suggestColumns();
    status('Thiết lập đã thay đổi. Tính lại để cập nhật kết quả.');
}
catch (e) {
    configValid = false;
    state.invalidateResult();
    stop();
    freshness();
    error(e);
} }
function libraryRefresh() { library = loadLibrary(localStorage); const preferred = state.project?.dataset.id ?? select('projects').value; options(select('projects'), library.map(p => [p.dataset.id, p.dataset.name]), library.some(p => p.dataset.id === preferred) ? preferred : library[0]?.dataset.id ?? ''); }
function download(name, text, type) { const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
async function readFile(file, kind) { const generation = ++importGeneration; try {
    if (file.size > LIMITS.bytes)
        throw new Error('Tệp vượt quá 5 MiB');
    const text = await file.text();
    if (generation !== importGeneration)
        return;
    if (kind === 'json' || file.name.toLowerCase().endsWith('.json'))
        replace(parseBackup(text));
    else {
        const dataset = parseCsv(text, { name: file.name });
        replace({ dataset, config: defaultConfig(dataset) });
    }
    status('Đã nhập dữ liệu hợp lệ.');
}
catch (e) {
    if (generation !== importGeneration)
        return;
    error(e, kind === 'json' || file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv');
} }
$('sample').onclick = () => { const dataset = createDataset(['Nhóm', 'Giá trị'], [['A', '10'], ['A', '20'], ['B', '20'], ['B', '30']], { name: 'Mẫu tổng hợp', source: { kind: 'sample' } }); const c = defaultConfig(dataset); c.valueColumn = 1; replace({ dataset, config: c }); status('Đã nạp dữ liệu mẫu tổng hợp.'); };
$('import').onclick = () => { try {
    const dataset = parseCsv($('paste').value, { name: 'Dữ liệu dán' });
    dataset.source = { kind: 'manual' };
    replace({ dataset, config: defaultConfig(dataset) });
    status('Đã nhập nội dung hợp lệ.');
}
catch (e) {
    error(e, 'csv');
} };
for (const id of ['file', 'restore'])
    input(id).onchange = () => { const f = input(id).files?.[0]; if (f)
        void readFile(f, id === 'restore' ? 'json' : 'auto'); input(id).value = ''; };
for (const id of ['value', 'group', 'missing', 'decimal', 'sort', 'direction', 'metrics'])
    $(id).addEventListener('change', config);
for (const id of ['groupFilter', 'query', 'precision'])
    $(id).addEventListener('input', config);
for (const b of document.querySelectorAll('[data-mode]'))
    b.onclick = () => { pro.mode = b.dataset.mode; proChanged(); };
select('pair').onchange = () => { pro.pairColumn = select('pair').value === '' ? null : Number(select('pair').value); proChanged(); };
input('pro-digits').oninput = () => { const raw = input('pro-digits').value; const n = Number(raw); stop(); state.invalidateResult(); freshness(); if (raw === '' || !Number.isInteger(n) || n < 0 || n > 50) {
    status('Chữ số Pro phải là số nguyên từ 0 đến 50.');
    return;
} pro.digits = n; const saved = savePrefs(); status(saved ? 'Thiết lập đã thay đổi. Tính lại để cập nhật kết quả.' : preferenceSaveError); };
$('motion').onclick = () => { reducedMotion = !reducedMotion; if (!savePrefs())
    status(preferenceSaveError); proControls(); };
proControls();
$('calculate').onclick = () => {
    if (!state.project) {
        status('Hãy nhập dữ liệu trước.');
        return;
    }
    if (!configValid) {
        status('Thiết lập chưa hợp lệ; hãy sửa trước khi tính.');
        return;
    }
    const digits = input('pro-digits').value;
    if (digits === '' || !Number.isInteger(Number(digits)) || Number(digits) < 0 || Number(digits) > 50) {
        status('Chữ số Pro phải là số nguyên từ 0 đến 50.');
        return;
    }
    if (pro.mode === 'relationship' && pro.pairColumn === null) {
        status('Hãy chọn cột Y.');
        return;
    }
    stop();
    const id = state.start();
    freshness();
    const p = state.project;
    let task;
    try {
        task = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    }
    catch {
        stop();
        status('Không thể khởi tạo bộ tính toán. Hãy tải lại trang hoặc dùng trình duyệt hỗ trợ Web Worker.');
        return;
    }
    worker = task;
    $('cancel').disabled = false;
    $('calculate').setAttribute('aria-busy', 'true');
    status('Đang tính toán…');
    const finish = () => { task.terminate(); if (worker === task) {
        worker = null;
        $('cancel').disabled = true;
        $('calculate').setAttribute('aria-busy', 'false');
    } };
    task.onmessage = (event) => {
        if (worker !== task)
            return;
        const data = event.data;
        if (data.error) {
            if (state.fail(data.id)) {
                freshness();
                error(data.error, 'data');
            }
            finish();
            return;
        }
        if (state.complete(data.id, data.result)) {
            elapsed = data.elapsed;
            renderPro($('result'), p.dataset, p.config, data.result, elapsed);
            $('results').classList.remove('complete');
            requestAnimationFrame(() => $('results').classList.add('complete'));
            freshness();
            status('Đã tính xong.');
        }
        finish();
    };
    task.onerror = () => { if (worker !== task)
        return; stop(); status('Không thể chạy bộ tính toán.'); };
    try {
        task.postMessage({ id, project: p, pro: { ...pro } });
    }
    catch {
        stop();
        status('Không thể gửi dữ liệu đến bộ tính toán. Hãy thử lại hoặc nhập bảng nhỏ hơn.');
    }
};
$('cancel').onclick = () => { stop(); status('Đã hủy tính toán; kết quả trước đó được giữ lại.'); };
$('save').onclick = () => { try {
    if (!state.project)
        throw new Error('Hãy nhập dữ liệu trước.');
    if (!configValid)
        throw new Error('Thiết lập chưa hợp lệ.');
    saveProject(localStorage, state.project);
    state.dirty = false;
    dirty();
    libraryRefresh();
    status('Đã lưu dự án trên thiết bị này.');
}
catch (e) {
    error(e);
} };
$('open').onclick = () => { const p = library.find(x => x.dataset.id === select('projects').value); if (p) {
    replace(p, true);
    status('Đã mở dự án.');
}
else
    status('Không có dự án được chọn.'); };
$('remove').onclick = () => { try {
    if (!select('projects').value)
        return;
    const id = select('projects').value;
    const selected = library.find(p => p.dataset.id === id);
    if (!selected || !window.confirm(`Xóa dự án “${selected.dataset.name}”?`))
        return;
    removeProject(localStorage, id);
    state.projectRemoved(id);
    dirty();
    libraryRefresh();
    status('Đã xóa dự án khỏi thư viện.');
}
catch (e) {
    error(e);
} };
$('csv').onclick = () => { try {
    if (!state.project)
        throw new Error('Hãy nhập dữ liệu trước.');
    download('statdesk.csv', exportCsv(state.project.dataset), 'text/csv;charset=utf-8');
    status('Đã chuẩn bị CSV; hãy hoàn tất và kiểm tra việc lưu tệp.');
}
catch (e) {
    error(e);
} };
$('backup').onclick = () => { try {
    if (!state.project)
        throw new Error('Hãy nhập dữ liệu trước.');
    if (!configValid)
        throw new Error('Thiết lập chưa hợp lệ.');
    download('statdesk.json', serializeBackup(state.project), 'application/json');
    status('Đã chuẩn bị JSON; hãy hoàn tất và kiểm tra việc lưu tệp.');
}
catch (e) {
    error(e);
} };
$('theme').onclick = () => { darkTheme = !darkTheme; document.body.classList.toggle('dark', darkTheme); $('theme').setAttribute('aria-pressed', String(darkTheme)); if (!savePrefs())
    status(preferenceSaveError); };
$('print').onclick = () => { if (!state.result) {
    status('Hãy tính toán trước khi in kết quả.');
    return;
} if (state.resultStale) {
    status('Kết quả chưa cập nhật; hãy tính lại trước khi in.');
    return;
} window.print(); };
window.addEventListener('beforeunload', e => { if (state.dirty) {
    e.preventDefault();
    e.returnValue = '';
} });
try {
    libraryRefresh();
}
catch (e) {
    error(e);
}
const drop = $('drop-zone');
for (const type of ['dragenter', 'dragover'])
    drop.addEventListener(type, e => { e.preventDefault(); drop.classList.add('dragging'); });
for (const type of ['dragleave', 'drop'])
    drop.addEventListener(type, e => { e.preventDefault(); drop.classList.remove('dragging'); });
drop.addEventListener('drop', e => { const f = e.dataTransfer?.files[0]; if (f)
    void readFile(f, 'auto'); });
window.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    $('calculate').click();
} });
