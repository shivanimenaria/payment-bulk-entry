// Two-page flow rules (CLAUDE.md "UI Layout"): /payments (read-only list,
// "+ Create Payment") → /payments/new (payment form + allocation table →
// Submit → confirmation dialog → bulk API). Pure: the pages only hold state.
// All checks reuse lib/payments/validation.ts (the same functions the server
// runs), so nothing here changes a rule.
import type { AllocationRow, PaymentHeader } from "@/types/payments";
import type { PaymentMode } from "@/types/rdash";
import type { Totals } from "./totals";
import type { PaymentTally } from "./submit";
import { formatCardUnits, formatPaymentDate } from "@/lib/format";

export const PAYMENTS_PATH = "/payments";
export const NEW_PAYMENT_PATH = "/payments/new";

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  bank_transfer: "Bank Transfer",
  cheque: "Cheque",
  cash: "Cash",
  upi: "UPI",
};

/** Payment form fields, in display order (Remark = header remark). */
export const FORM_FIELDS: readonly (keyof PaymentHeader)[] = [
  "amountPaid",
  "paymentDate",
  "paymentMode",
  "reference",
  "remark",
];

export const EMPTY_HEADER: PaymentHeader = {
  amountPaid: "",
  paymentDate: "",
  paymentMode: null,
  reference: "",
  remark: "",
};

/** Page 1 "+ Create Payment": once rows have loaded and the selected
 *  currency has payable rows. */
export function canCreatePayment(state: { loaded: boolean; payableCount: number }): boolean {
  return state.loaded && state.payableCount > 0;
}

/** In-app path carrying the selected currency (`?currency=INR`); the
 *  session context params are added by buildUrl. */
export function withCurrency(path: string, currency: string | null): string {
  return currency ? `${path}?currency=${encodeURIComponent(currency)}` : path;
}

/** The currency picked on the other page (`?currency=`), or null. Only a
 *  plain currency code is accepted; whether it exists is decided by
 *  resolveSelectedCurrency against the loaded rows (never guessed). */
export function currencyFromSearch(search: string): string | null {
  const v = new URLSearchParams(search).get("currency");
  return v && /^[A-Za-z]{2,10}$/.test(v) ? v.toUpperCase() : null;
}

/** "← Back" asks "Discard entered amounts?" when anything was entered: a
 *  header field, a row amount or a row's own remark. */
export function hasEnteredAnything(header: PaymentHeader, rows: AllocationRow[]): boolean {
  const headerEntered = (Object.keys(EMPTY_HEADER) as (keyof PaymentHeader)[]).some(
    (k) => header[k] !== EMPTY_HEADER[k],
  );
  return headerEntered || rows.some((r) => r.amount.trim() !== "" || r.remarkOverridden);
}

/** Field errors show only after Submit was pressed (then live while the
 *  user fixes them). */
export function visibleFieldErrors(
  errors: Record<string, string>,
  attempted: boolean,
): Partial<Record<keyof PaymentHeader, string>> {
  const out: Partial<Record<keyof PaymentHeader, string>> = {};
  if (!attempted) return out;
  for (const [field, msg] of Object.entries(errors)) if (msg) out[field as keyof PaymentHeader] = msg;
  return out;
}

/** Submit errors that keep the user on /payments/new: a 400 rejection
 *  (nothing recorded; row / field errors are mapped inline, `form` = the
 *  server's whole-submission errors), a 403 or a network error. */
export type SubmitOutcome = { kind: "rejected"; form: string[] } | { kind: "error"; message: string };

export const REJECTED_PREFIX = "Nothing was recorded";

/** The one small red line in the form card footer (next to Total Due), or
 *  null: the submit error (if any), then — only after Submit — the
 *  whole-submission validation errors (e.g. "Allocated total must equal
 *  Amount Paid"). Field and row errors are shown inline, never here. */
export function formLevelMessage(o: { attempted: boolean; formErrors: string[]; outcome: SubmitOutcome | null }): string | null {
  const parts: string[] = [];
  if (o.outcome?.kind === "error") parts.push(o.outcome.message);
  if (o.outcome?.kind === "rejected") {
    parts.push(o.outcome.form.length > 0 ? `${REJECTED_PREFIX}: ${o.outcome.form.join(" · ")}` : `${REJECTED_PREFIX} — fix the highlighted fields and submit again.`);
  }
  if (o.attempted) for (const m of o.formErrors) if (!parts.some((p) => p.includes(m))) parts.push(m);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Amount Paid / Excess for the summary cards: null ("—") until Amount Paid
 *  is a valid Amount Paid (within the submit limit and > 0 — the header
 *  rule); Excess = Amount Paid − Allocated. */
export function paidAndExcess(
  totals: Pick<Totals, "amountPaidUnits" | "allocatedUnits">,
): { amountPaidUnits: Totals["amountPaidUnits"]; excessUnits: Totals["excessUnits"] } {
  const paid = totals.amountPaidUnits;
  if (paid === null || paid <= BigInt(0)) return { amountPaidUnits: null, excessUnits: null };
  return { amountPaidUnits: paid, excessUnits: paid - totals.allocatedUnits };
}

// ── Result popup lines ──

/** "2 payments · ₹ 80,000" (exact; "—" for an unparseable amount). */
export function tallyLine(t: PaymentTally, symbol: string | null): string {
  return `${t.count} payment${t.count === 1 ? "" : "s"} · ${formatCardUnits(t.amountUnits, symbol)}`;
}

/** "Payment date · Mode · Ref" → "21 Oct 2026 · UPI · UTR-77"
 *  (formatPaymentDate: from the "YYYY-MM-DD" parts, no timezone shift); an
 *  empty reference is left out. */
export function paymentDetailsLine(h: { paymentDate: string; paymentMode: PaymentMode | null; reference: string }): string {
  return [formatPaymentDate(h.paymentDate), h.paymentMode ? PAYMENT_MODE_LABELS[h.paymentMode] : "", h.reference.trim()]
    .filter(Boolean)
    .join(" · ");
}
