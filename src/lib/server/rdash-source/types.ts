import "server-only";
import type {
  BulkPaymentEntryCreateOutput,
  BulkPaymentEntryInput,
  PaymentRequestDetails,
  RdashProject,
  VendorPaymentRequestConfigItem,
} from "@/types/rdash";

// One data source per request: mock (JSON fixtures) or real (rDash with the
// logged-in user's token). Chosen ONLY by RDASH_DATA_SOURCE (index.ts).
// Ids are passed through exactly as the source returned them.
export interface RdashSource {
  /** All projects (every page). */
  listProjects(): Promise<RdashProject[]>;
  /** Every config item for the vendor (all pages). `vendorId` is the SESSION
   *  vendor (decoded integer-string in real mode) — never a client value. */
  listPaymentRequestConfig(vendorId: string): Promise<VendorPaymentRequestConfigItem[]>;
  /** One request's details. Only called for config items that carry a
   *  project_id (see allocation-rows.ts). */
  getPaymentRequestDetails(projectId: string, requestId: string): Promise<PaymentRequestDetails>;
  /** Create entries in one bulk call. */
  createBulkPaymentEntries(entries: BulkPaymentEntryInput[]): Promise<BulkPaymentEntryCreateOutput>;
}
