import { compareDecimalText } from '../../packages/core/pro.js';
import { table, labels } from './render.js';
const el = (tag, text) => { const n = document.createElement(tag); if (text !== undefined)
    n.textContent = text; return n; };
const names = { ...labels, q1: 'Cuartil Q1', q3: 'Cuartil Q3', iqr: 'Khoảng tứ phân vị', mad: 'MAD (không hiệu chỉnh)', lowerFence: 'Ngưỡng dưới Tukey', upperFence: 'Ngưỡng trên Tukey', xMean: 'Trung bình X', yMean: 'Trung bình Y', slope: 'Hệ số góc', intercept: 'Hệ số chặn', correlation: 'Tương quan Pearson r', rSquared: 'R²' };
const reasons = { INSUFFICIENT_PAIRS: 'Cần ít nhất hai cặp hợp lệ.', CONSTANT_X: 'Cột X không thay đổi nên không xác định hệ số góc và tương quan.', CONSTANT_Y: 'Cột Y không thay đổi nên không xác định tương quan và R².', CONSTANT_X_AND_Y: 'Cả X và Y không thay đổi nên không xác định hồi quy và tương quan.' };
const display = (v) => v === null ? 'Không xác định' : `${v.exact ? '=' : '≈'} ${v.text}`;
function metric(value, text) { const strong = el('strong'); if (value === null) {
    strong.textContent = 'Không xác định';
    return strong;
} const badge = el('span', value.exact ? '=' : '≈'); badge.className = 'accuracy'; badge.title = value.exact ? 'Chính xác' : 'Đã làm tròn'; badge.setAttribute('aria-label', badge.title); const number = el('span', text ?? value.text); number.className = 'stat-value'; strong.append(badge, number); return strong; }
export function renderPro(container, dataset, config, r, elapsed) {
    container.replaceChildren();
    container.append(el('p', `Tổng ${r.counts.total} hàng • Được chọn ${r.counts.selected} • Hợp lệ ${r.counts.valid} • Thiếu ${r.counts.missing} • Loại bởi bộ lọc ${r.counts.total - r.counts.selected}`));
    const method = { precision: 'Thống kê độ chính xác cao', distribution: 'Phân phối và ngoại lệ tiềm năng', relationship: 'Tương quan và hồi quy tuyến tính' }[r.mode];
    container.append(el('p', `${method} • ${elapsed.toFixed(1)} ms`));
    container.append(el('p', '= Chính xác · ≈ Đã làm tròn theo số chữ số đã chọn. Khi nằm chính giữa hai giá trị, kết quả làm tròn về chữ số chẵn.'));
    const grid = el('div');
    grid.className = 'stats';
    for (const [key, value] of Object.entries(r.stats)) {
        if (key in labels && !config.metrics.includes(key))
            continue;
        const d = el('div');
        d.className = 'stat';
        d.append(el('span', names[key] ?? key), metric(value, key === 'count' ? String(r.counts.valid) : undefined));
        grid.append(d);
    }
    if (r.modes.length && config.metrics.includes('modes')) {
        const d = el('div');
        d.className = 'stat';
        d.append(el('span', 'Mốt'), el('strong', r.modes.map(display).join(', ')));
        grid.append(d);
    }
    container.append(grid);
    if (r.mode === 'relationship' && r.relationshipReason)
        container.append(el('p', `Không xác định: ${reasons[r.relationshipReason] ?? r.relationshipReason}`));
    if (r.mode === 'distribution') {
        container.append(el('p', `Điểm ngoại lệ tiềm năng: ${r.outlierCount ?? 0}. Hàng dữ liệu: ${(r.outlierRowIndices ?? []).slice(0, 200).map(i => i + 1).join(', ') || 'không có'}. Tối đa 200 hàng được hiển thị. Không tự xóa quan sát.`));
    }
    for (const note of r.notes)
        if (!note.includes('BigInt'))
            container.append(el('p', note));
    container.append(el('h3', 'Tần suất'));
    const bars = el('div');
    bars.className = 'bars';
    const max = Math.max(1, ...r.frequency.map(x => x.count));
    for (const f of r.frequency) {
        const row = el('div');
        row.className = 'bar-row';
        const track = document.createElement('progress');
        track.className = 'bar-track';
        track.max = max;
        track.value = f.count;
        track.setAttribute('aria-label', `Tần suất ${f.value.text}: ${f.count}`);
        row.append(el('span', f.value.text), track, el('span', `${f.count} (${f.percentage.toFixed(2)}%)`));
        bars.append(row);
    }
    container.append(bars);
    if (r.frequencyTotal > r.frequency.length)
        container.append(el('p', `Hiển thị ${r.frequency.length} / ${r.frequencyTotal} giá trị tần suất; các tổng tính trên toàn bộ dữ liệu.`));
    if (r.groups.length) {
        container.append(el('h3', 'Tóm tắt theo nhóm'));
        const list = el('ul');
        for (const g of r.groups)
            list.append(el('li', `${g.label}: n=${g.count}, tổng=${display(g.sum)}, trung bình=${display(g.mean)}`));
        container.append(list);
        if (r.groupTotal > r.groups.length)
            container.append(el('p', `Hiển thị ${r.groups.length} / ${r.groupTotal} nhóm; các tổng tính trên toàn bộ dữ liệu.`));
    }
    const indices = [...r.sourceRowIndices];
    if (config.sort) {
        const { column, direction } = config.sort;
        const factor = direction === 'asc' ? 1 : -1;
        indices.sort((a, b) => { const x = dataset.rows[a][column], y = dataset.rows[b][column]; if (column === config.valueColumn || column === config.sort?.column && r.mode === 'relationship' && column !== config.groupColumn) {
            try {
                return compareDecimalText(x, y, config.decimal) * factor;
            }
            catch {
                return x.localeCompare(y) * factor;
            }
        } return x.localeCompare(y, undefined, { numeric: true }) * factor; });
    }
    container.append(el('h3', 'Các hàng nguồn hợp lệ'), table(dataset, indices));
}
