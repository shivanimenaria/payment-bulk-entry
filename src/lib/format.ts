// Display formatting (client-safe). Null/undefined render as "—" — never a
// substituted default.
export const DASH = "—";

const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Indian grouping, 2 decimals: 123456.5 → "1,23,456.50". */
export function formatAmount(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? DASH : inr.format(value);
}

/** "₹1,23,456.50" */
export function formatINR(value: number | null | undefined): string {
  const s = formatAmount(value);
  return s === DASH ? s : `₹${s}`;
}

const istDate = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

/** dd/mm/yyyy. "YYYY-MM-DD" is shown as-is (no timezone shift); a datetime is
 *  shown in IST. An unparseable value is shown raw rather than hidden. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return DASH;
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (plain) return `${plain[3]}/${plain[2]}/${plain[1]}`;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : istDate.format(d);
}

/** "partially_paid" → "Partially paid" (display only). */
export function formatStatus(value: string | null | undefined): string {
  if (!value) return DASH;
  const s = value.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Plain text, or "—" when null/empty. */
export function textOrDash(value: string | null | undefined): string {
  return value === null || value === undefined || value === "" ? DASH : value;
}

const inrWhole = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** Summary-card style (rDash): "₹ 2,00,000"; paise are shown when present
 *  ("₹ 29,999.50") — never rounded away. */
export function formatCardINR(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return Number.isInteger(value) ? `₹ ${inrWhole.format(value)}` : `₹ ${inr.format(value)}`;
}

/** Indian digit grouping on a plain integer digit string (works for any size). */
function groupIndian(whole: string): string {
  const w = whole.replace(/^0+(?=\d)/, "");
  if (w.length <= 3) return w;
  const last3 = w.slice(-3);
  const rest = w.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

/**
 * rDash amount (decimal string like "29500.0000", or a number) → "29,500.00",
 * computed on the digits (no float), so even amounts too large to process are
 * shown exactly. Sub-paisa values keep their real digits ("12.3456" →
 * "12.3456") — never rounded. Non-decimal input is shown raw; null → "—".
 */
export function formatRdashAmount(value: unknown): string {
  if (value === null || value === undefined || value === "") return DASH;
  const text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : String(value).trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return text || DASH;
  const [, whole, frac = ""] = m;
  const shown = /[1-9]/.test(frac.slice(2)) ? frac.replace(/0+$/, "") : frac.slice(0, 2).padEnd(2, "0");
  return `${groupIndian(whole)}.${shown}`;
}

/** "₹ 2,00,000" style with a given currency symbol (null symbol → number only). */
export function formatCardAmount(value: number | null | undefined, symbol: string | null): string {
  const s = formatCardINR(value);
  if (s === DASH) return s;
  return symbol === "₹" ? s : symbol ? s.replace(/^₹ /, `${symbol} `) : s.replace(/^₹ /, "");
}

/** "₹1,23,456.50" style with a given currency symbol (null symbol → number only). */
export function formatMoney(value: number | null | undefined, symbol: string | null): string {
  const s = formatAmount(value);
  return s === DASH ? s : `${symbol ?? ""}${s}`;
}
