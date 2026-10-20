// Exact money. Pure; shared by client and server.
//
// Model: fixed-point with SCALE 4 — a value is a BigInt count of 0.0001
// ("units"). Parsing, totals, comparisons, Pay in Full, retry, payloads all
// use units. Never Number() / parseFloat for money (the only conversion to a
// JS number is unitsToExactNumber, for the bulk API, and it refuses anything
// that wouldn't round-trip exactly).
//
// Limits:
//   - READ from rDash (config / details amounts): DECIMAL(33,4) →
//     ≤ MAX_RDASH_INT_DIGITS integer digits, ≤ MAX_DECIMALS decimals.
//   - ENTER / SUBMIT (Amount paid, Payment Done, Pay in Full result): the POST
//     bulk API limit 99999999999999999999.9999 → ≤ MAX_SUBMIT_INT_DIGITS
//     integer digits, ≤ MAX_DECIMALS decimals.

export const MAX_RDASH_INT_DIGITS = 29;
export const MAX_SUBMIT_INT_DIGITS = 20;
export const MAX_DECIMALS = 4;

/** Money in units of 0.0001. */
export type Units = bigint;

const SCALE: Units = BigInt(10000);
const ZERO: Units = BigInt(0);
/** 99999999999999999999.9999 in units. */
export const MAX_SUBMIT_UNITS: Units = BigInt("9".repeat(MAX_SUBMIT_INT_DIGITS + MAX_DECIMALS));

export const SUBMIT_LIMIT_MESSAGE = "Max amount is 99,999,999,999,999,999,999.9999 (20 digits, 4 decimals)";

const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;

/** Plain non-negative decimal text → units, with digit limits. Extra decimal
 *  digits are accepted only when they are zeros ("1.50000"); otherwise null.
 *  `maxInt` null = no integer-digit limit (sums for display). */
function parseDecimalText(text: string, maxInt: number | null, maxDec: number, allowTrailingZeroDecimals: boolean): Units | null {
  const m = DECIMAL_RE.exec(text);
  if (!m) return null;
  const whole = m[1].replace(/^0+(?=\d)/, "");
  let frac = m[2] ?? "";
  if (frac.length > maxDec) {
    if (!allowTrailingZeroDecimals || /[1-9]/.test(frac.slice(maxDec))) return null;
    frac = frac.slice(0, maxDec);
  }
  if (maxInt !== null && whole.length > maxInt) return null;
  return BigInt(whole) * SCALE + BigInt(frac.padEnd(MAX_DECIMALS, "0"));
}

/** JSON number → its decimal text, or null if it's not a plain finite
 *  non-negative number (no exponent forms). */
function numberText(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const s = String(value);
  return /e/i.test(s) ? null : s;
}

// ── Reading rDash amounts ─────────────────────────────────────
export type RdashAmountResult = { ok: true; units: Units } | { ok: false; reason: "invalid" };

/** rDash amount (decimal string like "29500.0000"; details may use numbers):
 *  ≤ 29 integer digits, ≤ 4 decimals (zeros beyond are tolerated). Anything
 *  else → invalid ("Invalid amount from rDash"). */
export function parseRdashAmount(value: unknown): RdashAmountResult {
  const text = typeof value === "string" ? value.trim() : typeof value === "number" ? numberText(value) : null;
  const units = text === null ? null : parseDecimalText(text, MAX_RDASH_INT_DIGITS, MAX_DECIMALS, true);
  return units === null ? { ok: false, reason: "invalid" } : { ok: true, units };
}

/** Units of an rDash amount, or null when invalid. */
export function rdashUnits(value: unknown): Units | null {
  const r = parseRdashAmount(value);
  return r.ok ? r.units : null;
}

// ── User-entered / submitted amounts ─────────────────────────
/** User amount (string from an input, or a number): plain decimal, ≤ 20
 *  integer digits, ≤ 4 decimals. Negative, exponent, non-numeric, 21+ digits,
 *  5+ decimals → null (SUBMIT_LIMIT_MESSAGE). */
export function userUnits(value: unknown): Units | null {
  const text = typeof value === "string" ? value.trim() : typeof value === "number" ? numberText(value) : null;
  return text === null ? null : parseDecimalText(text, MAX_SUBMIT_INT_DIGITS, MAX_DECIMALS, false);
}

/** A row's Payment Done input: "" (or whitespace) = not paying this row = 0. */
export function rowAmountUnits(amount: unknown): Units | null {
  if (typeof amount === "string" && amount.trim() === "") return ZERO;
  return userUnits(amount);
}

/** Keystroke guard for money inputs: allow only text that can still become a
 *  valid amount — digits, at most one dot, ≤ 20 integer digits, ≤ 4 decimals. */
export function isAllowedAmountInput(text: string): boolean {
  return new RegExp(`^\\d{0,${MAX_SUBMIT_INT_DIGITS}}(\\.\\d{0,${MAX_DECIMALS}})?$`).test(text);
}

/** Any non-negative decimal text (no digit limit) — for amounts PBE itself
 *  produced, e.g. recorded totals returned by the bulk route. */
export function decimalUnits(value: unknown): Units | null {
  return typeof value === "string" ? parseDecimalText(value.trim(), null, MAX_DECIMALS, false) : null;
}

// ── Output ────────────────────────────────────────────────────
function splitUnits(units: Units): { neg: boolean; whole: string; frac4: string } {
  const neg = units < ZERO;
  const abs = neg ? -units : units;
  return { neg, whole: (abs / SCALE).toString(), frac4: (abs % SCALE).toString().padStart(MAX_DECIMALS, "0") };
}

/** Plain decimal text with no trailing zeros ("1200.5", "7", "0.0001") — for
 *  inputs, request bodies and exact string amounts. */
export function unitsToDecimalString(units: Units): string {
  const { neg, whole, frac4 } = splitUnits(units);
  const frac = frac4.replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** rDash's 4-decimal string form ("29500.0000") — e.g. mock data. */
export function unitsToRdash(units: Units): string {
  const { neg, whole, frac4 } = splitUnits(units);
  return `${neg ? "-" : ""}${whole}.${frac4}`;
}

/** Indian digit grouping on a plain integer digit string (any size). */
export function groupIndian(whole: string): string {
  if (whole.length <= 3) return whole;
  return `${whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${whole.slice(-3)}`;
}

/** Display: "1,23,456.50" — 2 decimals normally, 3–4 only when those digits
 *  are non-zero ("12.3456"). Exact for any size, never rounded.
 *  `wholeOnlyIfInteger`: "₹ 2,00,000" card style (no ".00"). */
export function formatUnits(units: Units, opts?: { wholeOnlyIfInteger?: boolean }): string {
  const { neg, whole, frac4 } = splitUnits(units);
  let frac = frac4.slice(2) === "00" ? frac4.slice(0, 2) : frac4.replace(/0+$/, "");
  if (opts?.wholeOnlyIfInteger && /^0+$/.test(frac4)) frac = "";
  return `${neg ? "-" : ""}${groupIndian(whole)}${frac ? `.${frac}` : ""}`;
}

/** Number of significant digits of a units value (for exact-number checks). */
function significantDigits(units: Units): number {
  const digits = (units < ZERO ? -units : units).toString().replace(/0+$/, "");
  return digits === "" ? 1 : digits.replace(/^0+/, "").length;
}

export const MAX_EXACT_NUMBER_DIGITS = 15;

/** A JS number exactly equal to `units`, or null when it can't round-trip
 *  (> 15 significant digits, or the number's text parses back differently).
 *  Never returns a rounded value. */
export function unitsToExactNumber(units: Units): number | null {
  if (significantDigits(units) > MAX_EXACT_NUMBER_DIGITS) return null;
  const text = unitsToDecimalString(units);
  const n = Number(text);
  const back = numberText(n);
  if (back === null) return null;
  return parseDecimalText(back, null, MAX_DECIMALS, false) === units ? n : null;
}

export const unitsZero = ZERO;
