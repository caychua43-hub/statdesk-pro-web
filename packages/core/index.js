export const ALGORITHM_VERSION = '1.0.0';
export const LIMITS = { bytes: 5 * 1024 * 1024, rows: 50000, columns: 64, cells: 1000000, field: 32768, projects: 10 };
export class StatDeskError extends Error {
    code;
    issues;
    issueCount;
    constructor(code, message, issues = [], issueCount = issues.length) { super(message); this.name = 'StatDeskError'; this.code = code; this.issues = issues; this.issueCount = issueCount; }
}
const fail = (code, message) => { throw new StatDeskError(code, message); };
const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const text = (v) => typeof v === 'string' && v.length <= LIMITS.field;
const str = (v) => text(v) && v.length > 0;
const checkSize = (s) => { if (new TextEncoder().encode(s).length > LIMITS.bytes)
    fail('INPUT_LIMIT', 'Input exceeds 5 MiB'); };
const metricKeys = ['count', 'sum', 'mean', 'min', 'max', 'median', 'modes', 'populationVariance', 'sampleVariance', 'populationStandardDeviation', 'sampleStandardDeviation'];
export function validateDataset(v) {
    if (!obj(v) || v.schemaVersion !== 1 || !str(v.id) || !text(v.name) || !str(v.createdAt) || !str(v.updatedAt) || !Number.isSafeInteger(v.revision) || v.revision < 0 || !obj(v.source) || !['manual', 'csv', 'json', 'sample'].includes(v.source.kind) || (v.source.name !== undefined && !text(v.source.name)))
        return fail('INVALID_DATASET', 'Invalid dataset metadata');
    if (!Array.isArray(v.columns) || v.columns.length < 1 || v.columns.length > LIMITS.columns || !Array.from(v.columns).every(text) || !Array.isArray(v.rows) || v.rows.length > LIMITS.rows || v.rows.length * v.columns.length > LIMITS.cells)
        return fail('DATASET_LIMIT', 'Invalid dataset dimensions');
    for (const row of v.rows)
        if (!Array.isArray(row) || row.length !== v.columns.length || !Array.from(row).every(text))
            return fail('INVALID_ROW', 'Invalid row width or field');
    return { schemaVersion: 1, id: v.id, name: v.name, columns: [...v.columns], rows: v.rows.map((r) => [...r]), createdAt: v.createdAt, updatedAt: v.updatedAt, revision: v.revision, source: { kind: v.source.kind, ...(v.source.name === undefined ? {} : { name: v.source.name }) } };
}
export function validateConfig(v, dataset) {
    const d = validateDataset(dataset);
    const col = (n) => Number.isInteger(n) && n >= 0 && n < d.columns.length;
    if (!obj(v) || !col(v.valueColumn) || !(v.groupColumn === null || col(v.groupColumn)) || !['reject', 'skip'].includes(v.missing) || !['dot', 'comma'].includes(v.decimal) || !Number.isInteger(v.precision) || v.precision < 0 || v.precision > 10 || !text(v.groupFilter) || !text(v.query) || !Array.isArray(v.metrics) || v.metrics.length > metricKeys.length || new Set(v.metrics).size !== v.metrics.length || !Array.from(v.metrics).every(x => metricKeys.includes(x)) || !(v.sort === null || (obj(v.sort) && col(v.sort.column) && ['asc', 'desc'].includes(v.sort.direction))))
        return fail('INVALID_CONFIG', 'Invalid analysis configuration');
    return { valueColumn: v.valueColumn, groupColumn: v.groupColumn, missing: v.missing, decimal: v.decimal, precision: v.precision, groupFilter: v.groupFilter, query: v.query, metrics: [...v.metrics], sort: v.sort === null ? null : { column: v.sort.column, direction: v.sort.direction } };
}
export function defaultConfig(dataset) { validateDataset(dataset); return { valueColumn: 0, groupColumn: null, missing: 'reject', decimal: 'dot', precision: 2, groupFilter: '', query: '', metrics: [...metricKeys], sort: null }; }
export function createDataset(columns, rows, options = {}) { const now = new Date().toISOString(); return validateDataset({ schemaVersion: 1, id: options.id ?? `ds-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, name: options.name ?? 'Dữ liệu', columns, rows, createdAt: options.createdAt ?? now, updatedAt: options.updatedAt ?? now, revision: options.revision ?? 0, source: options.source ?? { kind: 'manual' } }); }
export function parseCsv(input, options = {}) {
    if (typeof input !== 'string')
        return fail('INVALID_CSV', 'CSV must be text');
    checkSize(input);
    const s = input.replace(/^\uFEFF/, '');
    const delimiter = options.delimiter ?? (() => { let counts = [0, 0, 0], q = false; for (let i = 0; i < s.length; i++) {
        const x = s[i];
        if (x === '"') {
            if (q && s[i + 1] === '"')
                i++;
            else
                q = !q;
        }
        else if (!q && (x === '\n' || x === '\r'))
            break;
        else if (!q) {
            const j = [',', ';', '\t'].indexOf(x);
            if (j >= 0)
                counts[j]++;
        }
    } return [',', ';', '\t'][counts.indexOf(Math.max(...counts))]; })();
    if (![',', ';', '\t'].includes(delimiter))
        return fail('INVALID_CSV', 'Invalid delimiter');
    const records = [];
    let row = [], field = '', quoted = false, closed = false, start = true, line = 1, recordLine = 1, cells = 0;
    const csvError = (code, message, errorLine = line, column = row.length + 1) => { throw new StatDeskError(code, message, [{ row: errorLine, column, code, value: field.slice(0, 200) }]); };
    const fieldEnd = () => { const column = row.length + 1; if (field.length > LIMITS.field)
        csvError('FIELD_LIMIT', 'Field too long'); if (column > LIMITS.columns)
        csvError('COLUMN_LIMIT', 'Too many columns'); if (records.length && column > records[0].length)
        csvError('INVALID_ROW', 'Row has too many fields', recordLine, column); if (records.length && cells >= LIMITS.cells)
        csvError('CELL_LIMIT', 'Too many cells'); row.push(field); if (records.length)
        cells++; field = ''; start = true; closed = false; };
    const rowEnd = () => { fieldEnd(); if (records.length && row.length !== records[0].length)
        csvError('INVALID_ROW', 'Row has too few fields', recordLine, row.length + 1); if (records.length > LIMITS.rows)
        csvError('ROW_LIMIT', 'Too many rows', recordLine, 1); records.push(row); row = []; };
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (quoted) {
            if (ch === '"') {
                if (s[i + 1] === '"') {
                    field += '"';
                    i++;
                }
                else {
                    quoted = false;
                    closed = true;
                }
            }
            else {
                field += ch;
                if (ch === '\r') {
                    if (s[i + 1] === '\n') {
                        field += '\n';
                        i++;
                    }
                    line++;
                }
                else if (ch === '\n')
                    line++;
            }
        }
        else if (ch === '"') {
            if (!start)
                csvError('INVALID_CSV', 'Unexpected quote');
            quoted = true;
            start = false;
        }
        else if (ch === delimiter) {
            fieldEnd();
        }
        else if (ch === '\r' || ch === '\n') {
            rowEnd();
            if (ch === '\r' && s[i + 1] === '\n')
                i++;
            line++;
            recordLine = line;
        }
        else {
            if (closed)
                csvError('INVALID_CSV', 'Text after closing quote');
            field += ch;
            start = false;
        }
        if (field.length > LIMITS.field)
            csvError('FIELD_LIMIT', 'Field too long');
    }
    if (quoted)
        csvError('INVALID_CSV', 'Unclosed quoted field');
    if (s.length === 0)
        return fail('INVALID_CSV', 'Empty CSV');
    if (!(/[\r\n]$/.test(s)) || row.length || field.length || closed)
        rowEnd();
    const columns = records.shift();
    if (!columns)
        return fail('INVALID_CSV', 'Missing header');
    return createDataset(columns, records, { name: options.name ?? 'CSV', source: { kind: 'csv', ...(options.name === undefined ? {} : { name: options.name }) } });
}
export function exportCsv(dataset) { const d = validateDataset(dataset); const cell = (s) => { let safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(s) ? "'" + s : s; return /[",;\t\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe; }; return [d.columns, ...d.rows].map(r => r.map(cell).join(',')).join('\r\n'); }
const finite = (n) => Number.isFinite(n) ? n : fail('NUMBER_RANGE', 'Numerical result outside finite range');
const midpoint = (a, b) => { const total = a + b; return Number.isFinite(total) ? total / 2 : a / 2 + b / 2; };
export function analyze(dataset, config) {
    const d = validateDataset(dataset), c = validateConfig(config, d), values = [], indices = [], issues = [], frequencies = new Map(), groups = new Map();
    let missing = 0, selected = 0, issueCount = 0;
    for (let i = 0; i < d.rows.length; i++) {
        let row = d.rows[i];
        if (c.query && !row.some(x => x.toLocaleLowerCase().includes(c.query.toLocaleLowerCase())))
            continue;
        if (c.groupColumn !== null && c.groupFilter && row[c.groupColumn] !== c.groupFilter)
            continue;
        selected++;
        let raw = row[c.valueColumn].trim();
        let code = '';
        if (!raw) {
            missing++;
            if (c.missing === 'reject')
                code = 'MISSING_VALUE';
            else
                continue;
        }
        else {
            let pattern = c.decimal === 'dot' ? /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/ : /^[+-]?(?:\d+(?:,\d*)?|,\d+)(?:[eE][+-]?\d+)?$/;
            if (!pattern.test(raw))
                code = 'INVALID_NUMBER';
            else {
                let n = Number(c.decimal === 'comma' ? raw.replace(',', '.') : raw);
                if (!Number.isFinite(n) || (Number.isInteger(n) && !Number.isSafeInteger(n)) || (n === 0 && /[1-9]/.test(raw.split(/[eE]/, 1)[0])))
                    code = 'NUMBER_RANGE';
                else {
                    values.push(n);
                    indices.push(i);
                    frequencies.set(n, (frequencies.get(n) ?? 0) + 1);
                    let label = c.groupColumn === null ? '' : row[c.groupColumn];
                    let arr = groups.get(label) ?? [];
                    arr.push(n);
                    groups.set(label, arr);
                }
            }
        }
        if (code) {
            issueCount++;
            if (issues.length < 20)
                issues.push({ row: i + 1, column: c.valueColumn + 1, code, value: raw.slice(0, 200) });
        }
    }
    if (issueCount)
        throw new StatDeskError('INVALID_CELLS', 'Invalid numerical cells', issues, issueCount);
    const sum = (a) => { let s = 0, correction = 0; for (const x of a) {
        let t = finite(s + x);
        correction = finite(correction + (Math.abs(s) >= Math.abs(x) ? (s - t) + x : (x - t) + s));
        s = t;
    } return finite(s + correction); };
    let stats = null;
    if (values.length) {
        let n = values.length, total = sum(values), mean = finite(total / n), sorted = [...values].sort((a, b) => a - b), origin = sorted[0], shifted = values.map(x => finite(x - origin)), shiftedMean = finite(sum(shifted) / n), m2 = sum(shifted.map(x => { const delta = finite(x - shiftedMean); return finite(delta * delta); }));
        let pv = finite(Math.max(0, m2 / n)), sv = n < 2 ? null : finite(Math.max(0, m2 / (n - 1))), maxCount = Math.max(...frequencies.values());
        stats = { sum: total, mean, min: sorted[0], max: sorted[n - 1], median: n % 2 ? sorted[(n - 1) / 2] : finite(midpoint(sorted[n / 2 - 1], sorted[n / 2])), modes: maxCount === 1 ? [] : [...frequencies].filter(([, count]) => count === maxCount).map(([v]) => v).sort((a, b) => a - b), populationVariance: pv, sampleVariance: sv, populationStandardDeviation: finite(Math.sqrt(pv)), sampleStandardDeviation: sv === null ? null : finite(Math.sqrt(sv)) };
    }
    return { counts: { total: d.rows.length, selected, valid: values.length, missing }, sourceRowIndices: indices, stats, frequency: [...frequencies].sort((a, b) => a[0] - b[0]).map(([value, count]) => ({ value, count, percentage: count / values.length * 100 })), groups: c.groupColumn === null ? [] : [...groups].map(([label, a]) => ({ label, count: a.length, sum: sum(a), mean: finite(sum(a) / a.length) })) };
}
export function formatNumber(value, precision) { if (!Number.isFinite(value) || !Number.isInteger(precision) || precision < 0 || precision > 10)
    return fail('INVALID_FORMAT', 'Invalid number or precision'); return value.toFixed(precision); }
function project(v) { if (!obj(v))
    return fail('INVALID_PROJECT', 'Invalid project'); let dataset = validateDataset(v.dataset); return { dataset, config: validateConfig(v.config, dataset) }; }
export function serializeBackup(p) { const result = JSON.stringify({ schemaVersion: 1, algorithmVersion: ALGORITHM_VERSION, exportedAt: new Date().toISOString(), project: project(p) }, null, 2); checkSize(result); return result; }
export function parseBackup(s) { if (typeof s !== 'string')
    return fail('INVALID_BACKUP', 'Backup must be text'); checkSize(s); let v; try {
    v = JSON.parse(s);
}
catch {
    return fail('INVALID_BACKUP', 'Invalid backup JSON');
} if (!obj(v) || v.schemaVersion !== 1 || !str(v.algorithmVersion) || !str(v.exportedAt))
    return fail('INVALID_BACKUP', 'Invalid backup envelope'); return project(v.project); }
const KEY = 'statdesk.library.v1';
export function loadLibrary(storage) { let raw; try {
    raw = storage.getItem(KEY);
}
catch {
    return fail('STORAGE_READ', 'Cannot read library');
} if (raw === null)
    return []; let v; try {
    v = JSON.parse(raw);
}
catch {
    return fail('STORAGE_CORRUPT', 'Library is corrupt');
} if (!obj(v) || v.schemaVersion !== 1 || !Array.isArray(v.projects) || v.projects.length > LIMITS.projects)
    return fail('STORAGE_CORRUPT', 'Invalid library'); try {
    let p = v.projects.map(project);
    if (new Set(p.map(x => x.dataset.id)).size !== p.length)
        return fail('STORAGE_CORRUPT', 'Duplicate project ID');
    return p;
}
catch {
    return fail('STORAGE_CORRUPT', 'Invalid library project');
} }
export function saveProject(storage, p) { let valid = project(p), projects = loadLibrary(storage), index = projects.findIndex(x => x.dataset.id === valid.dataset.id); if (index < 0) {
    if (projects.length >= LIMITS.projects)
        return fail('PROJECT_LIMIT', 'Library is full');
    projects.push(valid);
}
else
    projects[index] = valid; let raw = JSON.stringify({ schemaVersion: 1, projects }); try {
    storage.setItem(KEY, raw);
}
catch {
    return fail('STORAGE_WRITE', 'Cannot save library');
} }
export function removeProject(storage, id) { let projects = loadLibrary(storage); try {
    storage.setItem(KEY, JSON.stringify({ schemaVersion: 1, projects: projects.filter(x => x.dataset.id !== id) }));
}
catch {
    return fail('STORAGE_WRITE', 'Cannot update library');
} }
