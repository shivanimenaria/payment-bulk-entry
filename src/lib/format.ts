import { formatUnits, rdashUnits, type Units } from "./payments/money";
// Display formatting (client-safe). Null/undefined render as "—" — never a
// substituted default.
export const DASH = "—";

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
/** Plain text; null, undefined, "" or whitespace-only → "—" (never shown blank). */
export function textOrDash(value: string | null | undefined): string {
  return value === null || value === undefined || value.trim() === "" ? DASH : value;
}

// rDash request types (exact labels for known values).
const REQUEST_TYPE_LABELS: Record<string, string> = {
  non_order: "Non Order",
  po_advance: "PO Advance",
  invoice: "Invoice",
};

/** Request Type like rDash: known values → their labels; any other value →
 *  underscores to spaces + Title Case ("running_bill" → "Running Bill");
 *  null / "" → "—". */
export function formatRequestType(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === "") return DASH;
  const known = REQUEST_TYPE_LABELS[value];
  if (known) return known;
  return value
    .trim()
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Money display (exact; lib/payments/money.ts units) ────────
// Never Number()/Intl for money: formatting works on the digit string, so
// any size is shown exactly and nothing is rounded.

/** rDash amount ("29500.0000" or a number) → "29,500.00" (2–4 decimals,
 *  exact). Invalid → the raw value as given (never hidden, never rounded);
 *  null / "" → "—". */
export function formatRdashAmount(value: unknown): string {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return DASH;
  const units = rdashUnits(value);
  return units === null ? String(value) : formatUnits(units);
}

/** "1,23,456.50" with an optional currency symbol prefix ("₹1,23,456.50"). */
export function formatMoneyUnits(units: Units | null | undefined, symbol: string | null): string {
  if (units === null || units === undefined) return DASH;
  return `${symbol ?? ""}${formatUnits(units)}`;
}

/** Summary-card style (rDash): "₹ 2,00,000"; decimals only when non-zero
 *  ("₹ 29,999.50", "₹ 0.0001"). */
export function formatCardUnits(units: Units | null | undefined, symbol: string | null): string {
  if (units === null || units === undefined) return DASH;
  const n = formatUnits(units, { wholeOnlyIfInteger: true });
  return symbol ? `${symbol} ${n}` : n;
}
