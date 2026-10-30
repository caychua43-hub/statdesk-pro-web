import { formatNumber } from '../../packages/core/index.js';
export const labels = { count: 'Số lượng', sum: 'Tổng', mean: 'Trung bình', min: 'Nhỏ nhất', max: 'Lớn nhất', median: 'Trung vị', modes: 'Mốt', populationVariance: 'Phương sai tổng thể', sampleVariance: 'Phương sai mẫu', populationStandardDeviation: 'Độ lệch chuẩn tổng thể', sampleStandardDeviation: 'Độ lệch chuẩn mẫu' };
const el = (tag, text) => { const e = document.createElement(tag); if (text !== undefined)
    e.textContent = text; return e; };
export function table(dataset, indices, limit = 200) { const wrap = el('div'); wrap.className = 'table-wrap'; const t = el('table'), head = el('thead'), hr = el('tr'); hr.append(el('th', 'Hàng dữ liệu')); dataset.columns.forEach(x => hr.append(el('th', x))); head.append(hr); t.append(head); const body = el('tbody'); for (const i of indices.slice(0, limit)) {
    const tr = el('tr');
    tr.append(el('td', String(i + 1)));
    dataset.rows[i].forEach(x => tr.append(el('td', x)));
    body.append(tr);
} t.append(body); wrap.append(t); if (indices.length > limit)
    wrap.append(el('p', `Hiển thị ${limit} / ${indices.length} hàng.`)); return wrap; }
export function sortedIndices(dataset, config, source) { const indices = [...source]; if (config.sort) {
    const { column, direction } = config.sort;
    const factor = direction === 'asc' ? 1 : -1;
    if (column === config.valueColumn) {
        const number = (i) => Number(config.decimal === 'comma' ? dataset.rows[i][column].trim().replace(',', '.') : dataset.rows[i][column].trim());
        indices.sort((a, b) => (number(a) - number(b)) * factor);
    }
    else
        indices.sort((a, b) => dataset.rows[a][column].localeCompare(dataset.rows[b][column], undefined, { numeric: true }) * factor);
} return indices; }
export function renderResult(container, dataset, config, r, elapsed, version) { container.replaceChildren(); container.append(el('p', `Tổng ${r.counts.total} hàng • Được chọn ${r.counts.selected} • Hợp lệ ${r.counts.valid} • Thiếu ${r.counts.missing} • Loại bởi bộ lọc ${r.counts.total - r.counts.selected}`)); container.append(el('p', `Thuật toán ${version} • ${elapsed.toFixed(1)} ms • Thiếu: ${config.missing === 'skip' ? 'bỏ qua' : 'báo lỗi'} • Dấu thập phân: ${config.decimal === 'dot' ? 'chấm' : 'phẩy'}`)); if (r.stats) {
    const grid = el('div');
    grid.className = 'stats';
    for (const key of config.metrics) {
        const value = key === 'count' ? r.counts.valid : r.stats[key];
        const d = el('div');
        d.className = 'stat';
        d.append(el('span', labels[key]), el('strong', Array.isArray(value) ? (value.length ? value.map(n => formatNumber(n, config.precision)).join(', ') : 'Không có') : value === null ? 'Không xác định' : formatNumber(value, config.precision)));
        grid.append(d);
    }
    container.append(grid);
}
else
    container.append(el('p', 'Không có giá trị hợp lệ để tính chỉ số.')); container.append(el('h3', 'Tần suất')); const bars = el('div'); bars.className = 'bars'; const max = Math.max(1, ...r.frequency.map(x => x.count)); for (const f of r.frequency.slice(0, 100)) {
    const row = el('div');
    row.className = 'bar-row';
    const track = document.createElement('progress');
    track.className = 'bar-track';
    track.max = max;
    track.value = f.count;
    track.setAttribute('aria-label', `Tần suất ${f.value}: ${f.count}`);
    row.append(el('span', formatNumber(f.value, config.precision)), track, el('span', `${f.count} (${formatNumber(f.percentage, config.precision)}%)`));
    bars.append(row);
} container.append(bars); if (r.frequency.length > 100)
    container.append(el('p', `Hiển thị 100 / ${r.frequency.length} giá trị tần suất; các tổng tính trên toàn bộ dữ liệu.`)); if (r.groups.length) {
    container.append(el('h3', 'Tóm tắt theo nhóm'));
    const list = el('ul');
    for (const g of r.groups.slice(0, 100))
        list.append(el('li', `${g.label}: n=${g.count}, tổng=${formatNumber(g.sum, config.precision)}, trung bình=${formatNumber(g.mean, config.precision)}`));
    container.append(list);
    if (r.groups.length > 100)
        container.append(el('p', `Hiển thị 100 / ${r.groups.length} nhóm; các tổng tính trên toàn bộ dữ liệu.`));
} const indices = sortedIndices(dataset, config, r.sourceRowIndices); container.append(el('h3', 'Các hàng nguồn hợp lệ'), table(dataset, indices)); }
