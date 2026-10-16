// Row-level allocation actions. Pure, immutable updates; shared rules only.
import type { AllocationRow } from "@/types/payments";
import { paiseToInput, parseRdashAmount } from "./money";

export const AMOUNT_TOO_LARGE_MESSAGE = "Amount too large to process";
export const AMOUNT_INVALID_MESSAGE = "Invalid amount from rDash";

/** A config amount (request / paid / due) PBE can't process exactly:
 *  too large for safe integer paise, or not a valid decimal (incl. non-zero
 *  sub-paisa digits). Such a row is shown with this error and can't take a
 *  payment; it is excluded from totals. null = all amounts fine. */
export function rowAmountIssue(row: Pick<AllocationRow, "config">): string | null {
  const results = [row.config.request_amount, row.config.paid_amount, row.config.payment_due].map(parseRdashAmount);
  if (results.some((r) => !r.ok && r.reason === "too_large")) return AMOUNT_TOO_LARGE_MESSAGE;
  if (results.some((r) => !r.ok)) return AMOUNT_INVALID_MESSAGE;
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

/** Pay in Full: Payment Done = Payment Due (exact paise). A due that isn't
 *  valid money leaves the row unchanged (never guessed). */
export function payInFull(row: AllocationRow): AllocationRow {
  if (!isAmountEditable(row)) return row;
  const due = parseRdashAmount(row.config.payment_due);
  if (!due.ok || due.paise <= 0) return row;
  return { ...row, amount: paiseToInput(due.paise) };
}

/** Clear applied amount: reset Payment Done on every editable row. */
export function clearAppliedAmounts(rows: AllocationRow[]): AllocationRow[] {
  return rows.map((r) => (isAmountEditable(r) && r.amount !== "" ? { ...r, amount: "" } : r));
}

/** Remove a failed (rowError) row from the pending payment: amount cleared,
 *  error cleared, editable again; the remark (and its override flag) is kept.
 *  Pair with removeFailedId (retry.ts) so Retry failed no longer sends it.
 *  Rows without rowError are returned unchanged. */
export function dismissFailedRow(row: AllocationRow): AllocationRow {
  if (!row.rowError) return row;
  return { ...row, amount: "", rowError: null, rowStatus: "idle" };
}
