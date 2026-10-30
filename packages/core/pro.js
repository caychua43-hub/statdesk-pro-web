import { LIMITS, StatDeskError, validateConfig, validateDataset } from './index.js';
import { absolute, add, canonicalDecimal, compareDecimal, compareRational, displayRational, displaySquareRoot, fraction, multiply, parseDecimal, pow10, scaledCoefficient, subtract } from './decimal.js';
export const PRO_ALGORITHM_VERSION = '2.0.0';
const standardKeys = ['sum', 'mean', 'min', 'max', 'median', 'populationVariance', 'sampleVariance', 'populationStandardDeviation', 'sampleStandardDeviation'];
function validateOptions(options, columns) {
    if (!options || typeof options !== 'object' || !['precision', 'distribution', 'relationship'].includes(options.mode) || !Number.isInteger(options.digits) || options.digits < 0 || options.digits > 50 || !(options.pairColumn === null || (Number.isInteger(options.pairColumn) && options.pairColumn >= 0 && options.pairColumn < columns)) || (options.mode === 'relationship' && options.pairColumn === null))
        throw new StatDeskError('INVALID_PRO_OPTIONS', 'Invalid Pro tool, decimal places or paired column');
    return { mode: options.mode, digits: options.digits, pairColumn: options.pairColumn };
}
function checkInputSize(dataset) {
    const encoder = new TextEncoder();
    let bytes = encoder.encode(JSON.stringify({ ...dataset, rows: [] })).length;
    for (let i = 0; i < dataset.rows.length; i++) {
        bytes += encoder.encode(JSON.stringify(dataset.rows[i])).length + (i ? 1 : 0);
        if (bytes > LIMITS.bytes)
            throw new StatDeskError('INPUT_LIMIT', 'Dataset exceeds 5 MiB serialized input');
    }
    if (bytes > LIMITS.bytes)
        throw new StatDeskError('INPUT_LIMIT', 'Dataset exceeds 5 MiB serialized input');
}
export function compareDecimalText(a, b, decimal) { return compareDecimal(parseDecimal(a, decimal), parseDecimal(b, decimal)); }
function quantile(sorted, numerator, denominator) {
    const position = (sorted.length - 1) * numerator, index = Math.floor(position / denominator), remainder = position % denominator;
    return remainder === 0 ? sorted[index] : add(sorted[index], multiply(subtract(sorted[index + 1], sorted[index]), fraction(BigInt(remainder), BigInt(denominator))));
}
export function analyzePro(dataset, config, options) {
    const d = validateDataset(dataset), c = validateConfig(config, d), o = validateOptions(options, d.columns.length);
    checkInputSize(d);
    const values = [], pairValues = [], indices = [], issues = [];
    const frequencies = new Map(), groupIndices = new Map();
    let selected = 0, missing = 0, issueCount = 0;
    const query = c.query.toLocaleLowerCase();
    const issue = (row, column, code, raw) => { issueCount++; if (issues.length < 20)
        issues.push({ row: row + 1, column: column + 1, code, value: raw.slice(0, 200) }); };
    for (let i = 0; i < d.rows.length; i++) {
        const row = d.rows[i];
        if (query && !row.some(text => text.toLocaleLowerCase().includes(query)))
            continue;
        if (c.groupColumn !== null && c.groupFilter && row[c.groupColumn] !== c.groupFilter)
            continue;
        selected++;
        let rowMissing = false, rowInvalid = false;
        const parsed = [];
        const columns = o.mode === 'relationship' && o.pairColumn !== c.valueColumn ? [c.valueColumn, o.pairColumn] : [c.valueColumn];
        for (const column of columns) {
            const raw = row[column].trim();
            if (!raw) {
                rowMissing = true;
                if (c.missing === 'reject')
                    issue(i, column, 'MISSING_VALUE', raw);
                continue;
            }
            try {
                parsed.push(parseDecimal(raw, c.decimal));
            }
            catch (error) {
                if (!(error instanceof StatDeskError))
                    throw error;
                issue(i, column, error.code, raw);
                rowInvalid = true;
            }
        }
        if (rowMissing)
            missing++;
        if (rowMissing || rowInvalid)
            continue;
        const value = parsed[0];
        indices.push(i);
        values.push(value);
        if (o.mode === 'relationship')
            pairValues.push(o.pairColumn === c.valueColumn ? value : parsed[1]);
        const key = value.coefficient + 'e' + (-value.scale), frequency = frequencies.get(key);
        if (frequency)
            frequency.count++;
        else
            frequencies.set(key, { value, count: 1 });
        if (c.groupColumn !== null) {
            const label = row[c.groupColumn], group = groupIndices.get(label);
            if (group)
                group.push(values.length - 1);
            else
                groupIndices.set(label, [values.length - 1]);
        }
    }
    if (issueCount)
        throw new StatDeskError('INVALID_CELLS', 'Invalid numerical cells', issues, issueCount);
    const stats = { count: displayRational(fraction(BigInt(values.length)), o.digits) };
    for (const key of standardKeys)
        stats[key] = null;
    const notes = ['Tính toán thập phân/hữu tỉ bằng BigInt; số hiển thị được làm tròn gần nhất, hòa về chữ số chẵn.'];
    const result = { mode: o.mode, method: o.mode === 'precision' ? 'Exact decimal descriptive statistics' : o.mode === 'distribution' ? 'Type 7 quantiles; raw MAD; Tukey 1.5 IQR potential-outlier labels' : 'Paired Pearson correlation and ordinary least squares', algorithmVersion: PRO_ALGORITHM_VERSION, counts: { total: d.rows.length, selected, valid: values.length, missing }, sourceRowIndices: indices, stats, modes: [], frequency: [], frequencyTotal: frequencies.size, groups: [], groupTotal: groupIndices.size, notes };
    if (o.mode === 'distribution') {
        for (const key of ['q1', 'q3', 'iqr', 'mad', 'lowerFence', 'upperFence'])
            stats[key] = null;
        result.outlierCount = 0;
        result.outlierRowIndices = [];
        notes.push('MAD là trung vị độ lệch tuyệt đối chưa chuẩn hóa. Nhãn ngoại lệ tiềm năng không phải kiểm định và không xóa quan sát.');
    }
    if (o.mode === 'relationship') {
        for (const key of ['xMean', 'yMean', 'slope', 'intercept', 'correlation', 'rSquared'])
            stats[key] = null;
        result.relationshipReason = 'INSUFFICIENT_PAIRS';
        notes.push('Chỉ mô tả quan hệ tuyến tính trong các cặp hợp lệ; không khẳng định nhân quả, p-value hoặc ngoại suy.');
    }
    if (!values.length)
        return result;
    let scale = 0;
    for (const value of values)
        scale = Math.max(scale, value.scale);
    const denominator = pow10(scale), integers = values.map(value => scaledCoefficient(value, scale));
    const n = BigInt(values.length);
    let sum = 0n, squares = 0n;
    for (const value of integers) {
        sum += value;
        squares += value * value;
    }
    const sorted = [...integers].sort((a, b) => a < b ? -1 : a > b ? 1 : 0), rationalSorted = sorted.map(value => fraction(value, denominator));
    const median = quantile(rationalSorted, 1, 2), centered = n * squares - sum * sum, populationVariance = fraction(centered, n * n * denominator * denominator), sampleVariance = values.length < 2 ? null : fraction(centered, n * (n - 1n) * denominator * denominator);
    const display = (value) => displayRational(value, o.digits);
    stats.sum = display(fraction(sum, denominator));
    stats.mean = display(fraction(sum, n * denominator));
    stats.min = display(rationalSorted[0]);
    stats.max = display(rationalSorted[rationalSorted.length - 1]);
    stats.median = display(median);
    stats.populationVariance = display(populationVariance);
    stats.sampleVariance = sampleVariance === null ? null : display(sampleVariance);
    stats.populationStandardDeviation = displaySquareRoot(populationVariance, o.digits);
    stats.sampleStandardDeviation = sampleVariance === null ? null : displaySquareRoot(sampleVariance, o.digits);
    const sortedFrequency = [...frequencies.values()].sort((a, b) => compareDecimal(a.value, b.value));
    let maxFrequency = 0;
    for (const entry of sortedFrequency)
        maxFrequency = Math.max(maxFrequency, entry.count);
    if (maxFrequency > 1) {
        let modeCount = 0;
        for (const entry of sortedFrequency)
            if (entry.count === maxFrequency) {
                modeCount++;
                if (result.modes.length < 100)
                    result.modes.push({ text: canonicalDecimal(entry.value), exact: true });
            }
        if (modeCount > 100)
            notes.push(`Hiển thị 100/${modeCount} mốt; các quan sát vẫn được dùng đầy đủ.`);
    }
    result.frequency = sortedFrequency.slice(0, 100).map(entry => ({ value: { text: canonicalDecimal(entry.value), exact: true }, count: entry.count, percentage: entry.count / values.length * 100 }));
    for (const [label, members] of groupIndices) {
        if (result.groups.length === 100)
            break;
        let groupSum = 0n;
        for (const index of members)
            groupSum += integers[index];
        result.groups.push({ label, count: members.length, sum: display(fraction(groupSum, denominator)), mean: display(fraction(groupSum, BigInt(members.length) * denominator)) });
    }
    if (frequencies.size > 100)
        notes.push(`Hiển thị 100/${frequencies.size} giá trị tần suất; phần trăm dùng toàn bộ ${values.length} quan sát hợp lệ.`);
    if (groupIndices.size > 100)
        notes.push(`Hiển thị 100/${groupIndices.size} nhóm; thống kê chung vẫn dùng toàn bộ quan sát hợp lệ.`);
    if (o.mode === 'distribution') {
        const q1 = quantile(rationalSorted, 1, 4), q3 = quantile(rationalSorted, 3, 4), iqr = subtract(q3, q1), distance = multiply(iqr, fraction(3n, 2n)), lower = subtract(q1, distance), upper = add(q3, distance);
        const deviations = rationalSorted.map(value => absolute(subtract(value, median))).sort(compareRational), mad = quantile(deviations, 1, 2);
        for (const [key, value] of Object.entries({ q1, q3, iqr, mad, lowerFence: lower, upperFence: upper }))
            stats[key] = display(value);
        const outliers = [];
        for (let i = 0; i < integers.length; i++) {
            const value = fraction(integers[i], denominator);
            if (compareRational(value, lower) < 0 || compareRational(value, upper) > 0)
                outliers.push(indices[i]);
        }
        result.outlierRowIndices = outliers;
        result.outlierCount = outliers.length;
    }
    if (o.mode === 'relationship') {
        let yScale = 0;
        for (const value of pairValues)
            yScale = Math.max(yScale, value.scale);
        const yDenominator = pow10(yScale), ys = pairValues.map(value => scaledCoefficient(value, yScale));
        let ySum = 0n, ySquares = 0n, products = 0n;
        for (let i = 0; i < ys.length; i++) {
            ySum += ys[i];
            ySquares += ys[i] * ys[i];
            products += integers[i] * ys[i];
        }
        const xMean = fraction(sum, n * denominator), yMean = fraction(ySum, n * yDenominator);
        stats.xMean = display(xMean);
        stats.yMean = display(yMean);
        if (values.length >= 2) {
            const xx = centered, yy = n * ySquares - ySum * ySum, xy = n * products - sum * ySum;
            if (xx === 0n)
                result.relationshipReason = yy === 0n ? 'CONSTANT_X_AND_Y' : 'CONSTANT_X';
            else {
                const slope = fraction(xy * denominator, xx * yDenominator);
                stats.slope = display(slope);
                stats.intercept = display(subtract(yMean, multiply(slope, xMean)));
                if (yy === 0n)
                    result.relationshipReason = 'CONSTANT_Y';
                else {
                    const rSquared = fraction(xy * xy, xx * yy);
                    stats.rSquared = display(rSquared);
                    stats.correlation = displaySquareRoot(rSquared, o.digits, xy < 0n);
                    result.relationshipReason = null;
                }
            }
        }
    }
    return result;
}
