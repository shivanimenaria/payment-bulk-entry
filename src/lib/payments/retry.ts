// Retry failed (CLAUDE.md Key Rules → Partial failure). Pure.
// Resends ONLY ids listed in result.failed[]. An id missing from both created
// and failed is never resent (it may have been recorded; the bulk route
// already answers 502 for that case instead of a result).
import type { BulkPaymentEntryInput } from "@/types/rdash";
import type { BulkSubmitRequest, BulkSubmitResult } from "@/types/payments";
import { unitsToDecimalString, userUnits } from "./money";

/** A failed id that isn't among the previous entries — the result doesn't
 *  belong to this submission; refuse rather than guess. */
export class RetryMismatchError extends Error {
  constructor(id: string) {
    super(`Failed id ${id} was not in the previous submission`);
    this.name = "RetryMismatchError";
  }
}

function failedIds(result: BulkSubmitResult, previousIds: Set<string>): Set<string> {
  const ids = new Set<string>();
  for (const f of result.failed) {
    if (!previousIds.has(f.payment_request_id)) throw new RetryMismatchError(f.payment_request_id);
    ids.add(f.payment_request_id);
  }
  return ids;
}

/** Entries to resend: the previous entries whose id is in failed[] (unchanged). */
export function buildRetryEntries(result: BulkSubmitResult, previous: BulkPaymentEntryInput[]): BulkPaymentEntryInput[] {
  const ids = failedIds(result, new Set(previous.map((e) => e.payment_request_id)));
  return previous.filter((e) => ids.has(e.payment_request_id));
}

/** Route body for Retry failed: only failed rows; Amount Paid becomes the
 *  not-recorded amount (exact sum of the retried rows). */
export function buildRetryRequest(result: BulkSubmitResult, previous: BulkSubmitRequest): BulkSubmitRequest {
  const ids = failedIds(result, new Set(previous.rows.map((r) => r.payment_request_id)));
  const rows = previous.rows.filter((r) => ids.has(r.payment_request_id));
  let total = BigInt(0);
  for (const r of rows) {
    const u = userUnits(r.amount);
    if (u === null) throw new Error(`Invalid amount in previous submission for ${r.payment_request_id}`);
    total += u;
  }
  return { header: { ...previous.header, amountPaid: unitsToDecimalString(total) }, rows };
}

/** Drop one id from the retryable failures (after the user removed that row).
 *  Only failed[] changes — created[] and the recorded/not-recorded amounts are
 *  what actually happened and stay as reported. */
export function removeFailedId(result: BulkSubmitResult, id: string): BulkSubmitResult {
  return { ...result, failed: result.failed.filter((f) => f.payment_request_id !== id) };
}

/** Header Amount Paid after a partial failure = the not-recorded amount still
 *  retryable ("" when nothing is left — never "0", which would be invalid). */
export function retryAmountPaid(result: BulkSubmitResult, previous: BulkSubmitRequest): string {
  if (result.failed.length === 0) return "";
  return buildRetryRequest(result, previous).header.amountPaid;
}
