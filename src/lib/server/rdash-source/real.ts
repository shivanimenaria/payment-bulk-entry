import "server-only";
import type {
  BulkPaymentEntryCreateOutput,
  BulkPaymentEntryInput,
  ExternalBulkPaymentEntryCreateInput,
  PaymentRequestDetails,
  RdashProject,
  VendorPaymentRequestConfigItem,
} from "@/types/rdash";
import { apiFetch, paginateRdash, paginateRdashDrf } from "../api";
import { encodeRdashId } from "../rdash-id";
import type { RdashSource } from "./types";

// RDASH_DATA_SOURCE=real. Every call uses the logged-in user's access token,
// so rDash CAN_* permissions apply and entries are attributed to that user.
// Lazy refresh-on-401 happens inside apiFetch / paginateRdash; routes using
// this source must be wrapped in withAuthCookies (enforced by a test).
//
// Ids from rDash (project ids, payment_request_id) are passed back unchanged.
// Only the session vendor id (stored decoded) is re-encoded for the query —
// except in DEV static-token mode (`rawVendorId`), where RDASH_DEV_VENDOR_ID is
// already rDash's own hashid and is sent exactly as given.

// Bulk body shape — confirmed `{ entries: [...] }` (Swagger's "data" is only
// the body parameter's name). docs/api-notes.md #13 (resolved).
export const BULK_BODY_WRAPPER: "entries" | "data.entries" = "entries";

export function buildBulkBody(
  entries: BulkPaymentEntryInput[],
): ExternalBulkPaymentEntryCreateInput | { data: ExternalBulkPaymentEntryCreateInput } {
  const body: ExternalBulkPaymentEntryCreateInput = { entries };
  return BULK_BODY_WRAPPER === "entries" ? body : { data: body };
}

export function createRealSource(accessToken: string, opts?: { rawVendorId?: boolean }): RdashSource {
  if (!accessToken) throw new Error("createRealSource: missing access token");
  return {
    async listProjects(): Promise<RdashProject[]> {
      // Ids pass through untouched (NO decodeIdField): allocation-rows.ts
      // matches them against config project_id, which is also passed through.
      return paginateRdash<RdashProject>("/v2/projects", accessToken);
    },

    async listPaymentRequestConfig(vendorId: string): Promise<VendorPaymentRequestConfigItem[]> {
      // TODO(verify): in handover mode the vendor_id query param takes the
      // PBE-salt hashid (docs/api-notes.md → #1).
      const vendor = encodeURIComponent(opts?.rawVendorId ? vendorId : encodeRdashId(vendorId));
      // DRF pagination: `results`, follow `next` until null, total must equal
      // `count` (never single-page, never partial).
      return paginateRdashDrf<VendorPaymentRequestConfigItem>(
        `/v2/vendor-payment-requests/config/?vendor_id=${vendor}`,
        accessToken,
      );
    },

    async getPaymentRequestDetails(projectId: string, requestId: string): Promise<PaymentRequestDetails> {
      if (!projectId || !requestId) throw new Error("getPaymentRequestDetails: projectId and requestId are required");
      // Path ids are the config's project_id / payment_request_id exactly as
      // returned. TODO(verify): standard { success, data } envelope
      // (docs/api-notes.md → #14).
      return apiFetch<PaymentRequestDetails>(
        `/v2/projects/${encodeURIComponent(projectId)}/vendor-payment-requests/${encodeURIComponent(requestId)}`,
        accessToken,
      );
    },

    async createBulkPaymentEntries(entries: BulkPaymentEntryInput[]): Promise<BulkPaymentEntryCreateOutput> {
      // Output confirmed (count, created[], failed[]). TODO(verify): partial
      // failure is a 2xx with `failed[]`, and the max entries per call
      // (docs/api-notes.md → #12).
      return apiFetch<BulkPaymentEntryCreateOutput>(
        "/v2/vendor-payment-requests/payment-entries/bulk/",
        accessToken,
        { method: "POST", body: JSON.stringify(buildBulkBody(entries)) },
      );
    },
  };
}
