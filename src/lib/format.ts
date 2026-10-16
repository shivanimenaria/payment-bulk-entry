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
