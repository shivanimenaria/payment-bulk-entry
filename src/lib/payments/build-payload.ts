// Shared (client + server) bulk payload builders. Pure. Input must come from
// validateAllocation (client) or validateSubmission (server) — both produce
// a ValidatedSubmission containing only rows with amount > 0, already checked
// against bulkAmountValue below.
import type { BulkPaymentEntryInput } from "@/types/rdash";
import type { BulkSubmitRequest, PaymentHeader } from "@/types/payments";
import { unitsToDecimalString, unitsToExactNumber, type Units } from "./money";
import type { ValidatedSubmission } from "./validation";

// rDash Swagger types the bulk `amount` as number($float), which can't carry
// 20+4 digits exactly.
// TODO(verify): ask the rDash backend whether `amount` is a DecimalField that
// accepts a decimal string (docs/api-notes.md → #19). Until then: false.
//   false → send a JSON number ONLY when it round-trips exactly (≤ 15
//           significant digits); otherwise the submission is rejected
//           before rDash is called (validation) — never a rounded number.
//   true  → send the exact decimal string, e.g. "99999999999999999999.9999".
export const BULK_AMOUNT_AS_STRING = false;

export const AMOUNT_NOT_EXACT_MESSAGE =
  "Amount too large to submit exactly (rDash API takes numbers) — max 15 significant digits until rDash confirms string amounts";

/** The bulk API `amount` for exact `units`, or null when it can't be sent
 *  exactly with the current BULK_AMOUNT_AS_STRING setting. */
export function bulkAmountValue(units: Units, asString: boolean = BULK_AMOUNT_AS_STRING): number | string | null {
  return asString ? unitsToDecimalString(units) : unitsToExactNumber(units);
}

/** One entry per validated row. payment_date / payment_mode come from the
 *  header; transaction_id = header reference or null; remark = row remark or
 *  null; proof fields null (v1, no upload endpoint). No other defaults. Also
 *  what the Payload Preview shows. */
export function buildBulkEntries(v: ValidatedSubmission, asString: boolean = BULK_AMOUNT_AS_STRING): BulkPaymentEntryInput[] {
  return v.rows.map((r) => {
    const amount = bulkAmountValue(r.amountUnits, asString);
    // Validation already rejected these; never send a rounded/garbled value.
    if (amount === null) throw new Error(`Amount for ${r.payment_request_id} can't be sent exactly`);
    return {
      payment_request_id: r.payment_request_id,
      amount,
      payment_mode: v.paymentMode,
      payment_date: v.paymentDate,
      transaction_id: v.reference,
      transaction_proof_file_url: null,
      transaction_proof_file_name: null,
      remark: r.remark,
    };
  });
}

/** Client → POST /api/rdash/payment-entries/bulk body: the header as entered
 *  and only the selected rows (amount > 0), amounts as exact decimal strings.
 *  The server re-validates. */
export function buildSubmitRequest(header: PaymentHeader, v: ValidatedSubmission): BulkSubmitRequest {
  return {
    header,
    rows: v.rows.map((r) => ({
      payment_request_id: r.payment_request_id,
      amount: unitsToDecimalString(r.amountUnits),
      remark: r.remark,
    })),
  };
}
