// Cell display rules for the payment requests table, styled like the RFQ list
// table (docs/ui-reference/rfq-table/rfq-app/RfqListClient.tsx). Pure: class
// strings + text only; the table renders them. Money stays exact
// (lib/payments/money.ts) — never Number().
import { formatUnits, rdashUnits } from "./money";
import { DASH } from "@/lib/format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** S.No "01", "02", … (1-based position, continuing across pages). */
export function formatSerial(position: number): string {
  return String(position).padStart(2, "0");
}

/** Local calendar date "YYYY-MM-DD" of an rDash date / datetime, or null.
 *  A plain "YYYY-MM-DD" is taken as-is (no timezone shift); a datetime uses
 *  the browser's local date — the same as what <input type="date"> emits, so
 *  the date filters compare like-for-like (RFQ toLocalDateKey). */
export function localDateKey(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string" || !value.trim()) return null;
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (plain) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "20 May 2026" (RFQ list date: 2-digit day, short month); "—" when absent
 *  or unparseable. */
export function formatShortDate(value: string | null | undefined): string {
  const key = localDateKey(value);
  if (!key) return DASH;
  const [y, m, d] = key.split("-");
  const month = MONTHS[Number(m) - 1];
  return month ? `${d} ${month} ${y}` : DASH;
}

export interface DueDateDisplay {
  text: string;
  /** Text classes: red when the due date is past, grey otherwise. */
  className: string;
  /** Row left accent bar (RFQ deadline urgency), or "" for none. */
  accent: string;
  /** No due date → no clock icon. */
  icon: boolean;
}

/** Due Date cell + row accent, like RFQ "Deadline": clock icon + date; red
 *  text when the date is past (before today); the row's left accent bar is
 *  red-400 when past or due today, red-300 tomorrow, orange-300 within 3 days. */
export function dueDateDisplay(due: string | null | undefined, todayKey: string): DueDateDisplay {
  const key = localDateKey(due);
  if (!key) return { text: DASH, className: "text-gray-400", accent: "", icon: false };
  const days = Math.round((Date.UTC(...ymd(key)) - Date.UTC(...ymd(todayKey))) / 86_400_000);
  const past = days < 0;
  const accent = days <= 0 ? "border-l-4 border-l-red-400" : days === 1 ? "border-l-4 border-l-red-300" : days <= 3 ? "border-l-4 border-l-orange-300" : "";
  return { text: formatShortDate(key), className: past ? "text-red-600 font-medium" : "text-gray-500", accent, icon: true };
}

function ymd(key: string): [number, number, number] {
  const [y, m, d] = key.split("-").map(Number);
  return [y, m - 1, d];
}

/** Today's local "YYYY-MM-DD". */
export function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// RFQ outline badge colours (Badge variant="outline" + these classes).
const BLUE = "border-blue-200 bg-blue-50 text-blue-700";
const AMBER = "border-amber-200 bg-amber-50 text-amber-700";
const ORANGE = "border-orange-200 bg-orange-50 text-orange-700";
const GREEN = "border-green-200 bg-green-50 text-green-700";
const GRAY = "border-gray-200 bg-gray-50 text-gray-600";

/** Request Type pill: Invoice = blue, PO Advance = amber, Non Order = orange;
 *  any other type keeps the amber "Closed Book" look (one colour, never a
 *  guessed meaning). Matched on the raw rDash value or its label. */
export function requestTypeBadgeClass(type: string | null | undefined): string {
  const t = (type || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (t === "invoice") return BLUE;
  if (t === "po_advance") return AMBER;
  if (t === "non_order") return ORANGE;
  return AMBER;
}

/** rDash toTitleCase: "partially_paid" → "Partially Paid"; "" / null → "—". */
export function titleCase(value: string | null | undefined): string {
  if (!value) return DASH;
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Status pill with a coloured dot (RFQ STATUS_MAP look): Approved = green,
 *  Pending = amber, Submitted = blue, anything else grey. Exact lowercase
 *  status values, like the payable filter. */
export function statusBadge(status: string | null | undefined): { label: string; className: string; dot: string } {
  const label = titleCase(status);
  switch (status) {
    case "approved":
      return { label, className: GREEN, dot: "bg-green-500" };
    case "pending":
      return { label, className: AMBER, dot: "bg-amber-500" };
    case "submitted":
      return { label, className: BLUE, dot: "bg-blue-500" };
    default:
      return { label, className: GRAY, dot: "bg-gray-400" };
  }
}

/** Table amount "₹92,06,000" (symbol attached, Indian grouping, decimals only
 *  when non-zero — "₹29,999.50", up to 4 when the 3rd/4th are non-zero).
 *  Exact; an invalid rDash amount is shown raw (never hidden, never rounded);
 *  null / "" → "—". */
export function formatTableAmount(value: unknown, symbol: string | null): string {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return DASH;
  const units = rdashUnits(value);
  if (units === null) return String(value);
  return `${symbol ?? ""}${formatUnits(units, { wholeOnlyIfInteger: true })}`;
}
