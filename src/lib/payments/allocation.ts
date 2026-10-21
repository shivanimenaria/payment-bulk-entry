// Row-level allocation actions. Pure, immutable updates; shared rules only.
import type { AllocationRow } from "@/types/payments";
import { MAX_SUBMIT_UNITS, parseRdashAmount, unitsToDecimalString, userUnits } from "./money";

export const AMOUNT_INVALID_MESSAGE = "Invalid amount from rDash";
export const DUE_OVER_LIMIT_MESSAGE = "Payment due exceeds the bulk API limit";

/** Why a row can't take a payment, from its rDash amounts (null = fine):
 *  - any of request / paid / due not a valid rDash amount (DECIMAL(33,4)) →
 *    "Invalid amount from rDash" — excluded from totals;
 *  - payment_due above the POST bulk limit (99999999999999999999.9999) →
 *    "Payment due exceeds the bulk API limit" — shown normally and STILL
 *    counted in Total Due, but Pay in Full / Payment Done are disabled. */
export function rowAmountIssue(row: Pick<AllocationRow, "config">): string | null {
  const results = [row.config.request_amount, row.config.paid_amount, row.config.payment_due].map(parseRdashAmount);
  if (results.some((r) => !r.ok)) return AMOUNT_INVALID_MESSAGE;
  const due = results[2];
  if (due.ok && due.units > MAX_SUBMIT_UNITS) return DUE_OVER_LIMIT_MESSAGE;
  return null;
}

/** Can the user enter / change Payment Done on this row?
 *  - detailsUnavailable / detailsError: no (also enforced by validateAllocation).
 *  - an amount PBE can't process (rowAmountIssue): no.
 *  - rowError (failed in a previous bulk submit): no — the amount is kept
 *    unchanged so Retry failed resends exactly what failed. */
export function isAmountEditable(row: AllocationRow): boolean {
  return !row.detailsUnavailable && !row.detailsError && !row.rowError && rowAmountIssue(row) === null;
}

export function setRowAmount(row: AllocationRow, amount: string): AllocationRow {
  return isAmountEditable(row) ? { ...row, amount } : row;
}

/** Pay in Full: Payment Done = Payment Due (exact units). A due that isn't
 *  valid money leaves the row unchanged (never guessed). */
export function payInFull(row: AllocationRow): AllocationRow {
  if (!isAmountEditable(row)) return row;
  const due = parseRdashAmount(row.config.payment_due);
  if (!due.ok || due.units <= BigInt(0) || due.units > MAX_SUBMIT_UNITS) return row;
  return { ...row, amount: unitsToDecimalString(due.units) };
}

/** Clear applied amount: reset Payment Done on every editable row. */
export function clearAppliedAmounts(rows: AllocationRow[]): AllocationRow[] {
  return rows.map((r) => (isAmountEditable(r) && r.amount !== "" ? { ...r, amount: "" } : r));
}


/** Amount Paid as exact units when Auto allocate can run (a valid amount
 *  > 0 within the submit limit), else null. */
export function autoAllocatePaidUnits(amountPaid: string): bigint | null {
  const paid = userUnits(amountPaid);
  return paid !== null && paid > BigInt(0) ? paid : null;
}

/** Auto allocate asks "Replace the amounts already entered?" first when an
 *  editable row already has an amount (locked rows are never replaced). */
export function hasReplaceableAmounts(rows: AllocationRow[]): boolean {
  return rows.some((r) => isAmountEditable(r) && r.amount.trim() !== "");
}

/** Auto allocate: walk `order` (payment_request_ids in the table's display
 *  order — filters applied, all pages, selected currency) top to bottom; each
 *  editable row gets min(remaining, payment_due) in the Pay in Full decimal
 *  form until nothing remains, later rows get "". Every other editable row
 *  (e.g. hidden by a filter) is cleared, so Allocated = exactly what was
 *  auto-allocated. Non-editable rows (isAmountEditable false) are untouched;
 *  remarks are kept. Amount Paid above the rows' total due → every row in
 *  full, the rest stays as Excess. Invalid / zero Amount Paid → rows
 *  unchanged. Exact BigInt units. */
export function autoAllocate(rows: AllocationRow[], order: string[], amountPaid: string): AllocationRow[] {
  const paid = autoAllocatePaidUnits(amountPaid);
  if (paid === null) return rows;
  const rowById = new Map(rows.map((r) => [r.config.payment_request_id, r] as const));
  const byId = new Map<string, string>();
  let remaining = paid;
  for (const id of order) {
    const row = rowById.get(id);
    if (!row || !isAmountEditable(row) || byId.has(id)) continue;
    // Editable ⇒ payment_due is valid and within the submit limit.
    const due = parseRdashAmount(row.config.payment_due);
    const dueUnits = due.ok && due.units > BigInt(0) ? due.units : BigInt(0);
    const take = remaining < dueUnits ? remaining : dueUnits;
    byId.set(id, take > BigInt(0) ? unitsToDecimalString(take) : "");
    remaining -= take;
  }
  return rows.map((r) => {
    if (!isAmountEditable(r)) return r;
    const amount = byId.get(r.config.payment_request_id) ?? "";
    return r.amount === amount ? r : { ...r, amount };
  });
}
