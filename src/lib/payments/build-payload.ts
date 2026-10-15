// Shared (client + server) bulk payload builder. Pure.
// MINIMAL VERSION (see validation.ts). Input must come from validateSubmission.
import type { BulkPaymentEntryInput } from "@/types/rdash";
import { fromPaise, type ValidatedSubmission } from "./validation";

/** One entry per validated row. payment_date / payment_mode / transaction_id
 *  come from the header for every entry; remark is per row; proof fields are
 *  null in v1 (no upload endpoint). */
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
