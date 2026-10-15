// Shared (client + server) bulk payload builders. Pure. Input must come from
// validateAllocation (client) or validateSubmission (server) — both produce
// a ValidatedSubmission containing only rows with amount > 0.
import type { BulkPaymentEntryInput } from "@/types/rdash";
import type { BulkSubmitRequest, PaymentHeader } from "@/types/payments";
import { fromPaise, paiseToInput } from "./money";
import type { ValidatedSubmission } from "./validation";

/** One entry per validated row. payment_date / payment_mode come from the
 *  header; transaction_id = header reference or null; remark = row remark or
 *  null; proof fields null (v1, no upload endpoint). No other defaults. Also
 *  what the Payload Preview shows. */
export function buildBulkEntries(v: ValidatedSubmission): BulkPaymentEntryInput[] {
  return v.rows.map((r) => ({
    payment_request_id: r.payment_request_id,
    amount: fromPaise(r.amountPaise),
    payment_mode: v.paymentMode,
    payment_date: v.paymentDate,
    transaction_id: v.reference,
    transaction_proof_file_url: null,
    transaction_proof_file_name: null,
    remark: r.remark,
  }));
}

/** Client → POST /api/rdash/payment-entries/bulk body: the header as entered
 *  and only the selected rows (amount > 0). The server re-validates. */
export function buildSubmitRequest(header: PaymentHeader, v: ValidatedSubmission): BulkSubmitRequest {
  return {
    header,
    rows: v.rows.map((r) => ({
      payment_request_id: r.payment_request_id,
      amount: paiseToInput(r.amountPaise),
      remark: r.remark,
    })),
  };
}
