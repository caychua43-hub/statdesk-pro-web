import { StatDeskError } from './index.js';
const powers = [1n];
export function pow10(exponent) {
    if (!Number.isInteger(exponent) || exponent < 0 || exponent > 4096)
        throw new StatDeskError('DECIMAL_RANGE', 'Unsupported internal decimal scale');
    while (powers.length <= exponent)
        powers.push(powers[powers.length - 1] * 10n);
    return powers[exponent];
}
const abs = (n) => n < 0n ? -n : n;
function gcd(a, b) { a = abs(a); b = abs(b); while (b) {
    const r = a % b;
    a = b;
    b = r;
} return a; }
export function fraction(numerator, denominator = 1n) {
    if (!denominator)
        throw new StatDeskError('DECIMAL_DIVISION', 'Zero denominator');
    if (!numerator)
        return { numerator: 0n, denominator: 1n };
    if (denominator < 0n) {
        numerator = -numerator;
        denominator = -denominator;
    }
    const factor = gcd(numerator, denominator);
    return { numerator: numerator / factor, denominator: denominator / factor };
}
export function add(a, b) { return fraction(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator); }
export function subtract(a, b) { return fraction(a.numerator * b.denominator - b.numerator * a.denominator, a.denominator * b.denominator); }
export function multiply(a, b) { return fraction(a.numerator * b.numerator, a.denominator * b.denominator); }
export function divide(a, b) { return fraction(a.numerator * b.denominator, a.denominator * b.numerator); }
export function compareRational(a, b) { const delta = a.numerator * b.denominator - b.numerator * a.denominator; return delta < 0n ? -1 : delta > 0n ? 1 : 0; }
export function absolute(a) { return { numerator: abs(a.numerator), denominator: a.denominator }; }
export function parseDecimal(raw, decimal) {
    if (typeof raw !== 'string' || !['dot', 'comma'].includes(decimal))
        throw new StatDeskError('INVALID_NUMBER', 'Invalid decimal token or locale');
    const token = raw.trim();
    if (token.length > 256)
        throw new StatDeskError('TOKEN_LIMIT', 'Numeric token exceeds 256 characters');
    const pattern = decimal === 'dot' ? /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/ : /^([+-]?)(?:(\d+)(?:,(\d*))?|,(\d+))(?:[eE]([+-]?\d+))?$/;
    const match = pattern.exec(token);
    if (!match)
        throw new StatDeskError('INVALID_NUMBER', 'Invalid decimal token');
    const integer = match[2] ?? '', fractional = match[3] ?? match[4] ?? '', significand = (integer + fractional).replace(/^0+/, '');
    if (significand.length > 128)
        throw new StatDeskError('SIGNIFICAND_LIMIT', 'Numeric token exceeds 128 significant digits');
    const exponentToken = match[5] ?? '0';
    let exponent = 0;
    for (const character of exponentToken.replace(/^[+-]/, '')) {
        exponent = exponent * 10 + character.charCodeAt(0) - 48;
        if (exponent > 256)
            throw new StatDeskError('EXPONENT_LIMIT', 'Explicit exponent exceeds absolute 256');
    }
    if (exponentToken[0] === '-')
        exponent = -exponent;
    let coefficient = BigInt(significand || '0') * (match[1] === '-' ? -1n : 1n), scale = fractional.length - exponent;
    if (coefficient === 0n)
        return { coefficient: 0n, scale: 0 };
    while (coefficient % 10n === 0n) {
        coefficient /= 10n;
        scale--;
    }
    return { coefficient, scale };
}
export function scaledCoefficient(value, scale) { return value.coefficient * pow10(scale - value.scale); }
export function decimalFraction(value) { return value.scale >= 0 ? fraction(value.coefficient, pow10(value.scale)) : fraction(value.coefficient * pow10(-value.scale)); }
export function compareDecimal(a, b) {
    const scale = Math.max(a.scale, b.scale), delta = scaledCoefficient(a, scale) - scaledCoefficient(b, scale);
    return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}
/** Exact canonical labels retain small/large observations without display rounding. */
export function canonicalDecimal(value) {
    const negative = value.coefficient < 0n, digits = abs(value.coefficient).toString();
    let text;
    if (value.scale <= 0)
        text = digits + '0'.repeat(-value.scale);
    else if (value.scale >= digits.length)
        text = '0.' + '0'.repeat(value.scale - digits.length) + digits;
    else
        text = digits.slice(0, -value.scale) + '.' + digits.slice(-value.scale);
    return (negative ? '-' : '') + text;
}
function validateDigits(digits) { if (!Number.isInteger(digits) || digits < 0 || digits > 50)
    throw new StatDeskError('INVALID_FORMAT', 'Pro decimal places must be 0..50'); }
function fixed(coefficient, digits) {
    const negative = coefficient < 0n, text = abs(coefficient).toString().padStart(digits + 1, '0');
    return (negative ? '-' : '') + (digits ? text.slice(0, -digits) + '.' + text.slice(-digits) : text);
}
export function displayRational(value, digits) {
    validateDigits(digits);
    const scaled = abs(value.numerator) * pow10(digits), denominator = value.denominator;
    let quotient = scaled / denominator;
    const remainder = scaled % denominator;
    if (2n * remainder > denominator || (2n * remainder === denominator && quotient % 2n !== 0n))
        quotient++;
    return { text: fixed(value.numerator < 0n ? -quotient : quotient, digits), exact: remainder === 0n };
}
/** Newton integer root. Correct rounding is decided against the exact midpoint squared. */
function integerSquareRoot(value) {
    if (value < 2n)
        return value;
    let root = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
    while (true) {
        const next = (root + value / root) / 2n;
        if (next >= root)
            return root;
        root = next;
    }
}
export function displaySquareRoot(value, digits, negative = false) {
    validateDigits(digits);
    if (value.numerator < 0n)
        throw new StatDeskError('DECIMAL_ROOT', 'Square root requires a nonnegative value');
    const numerator = value.numerator * pow10(2 * digits), denominator = value.denominator;
    let quotient = integerSquareRoot(numerator / denominator);
    const midpointComparison = 4n * numerator - (2n * quotient + 1n) ** 2n * denominator;
    if (midpointComparison > 0n || (midpointComparison === 0n && quotient % 2n !== 0n))
        quotient++;
    return { text: fixed(negative ? -quotient : quotient, digits), exact: quotient * quotient * denominator === numerator };
}
