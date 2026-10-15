import "server-only";
import type {
  BulkPaymentEntryCreateOutput,
  BulkPaymentEntryInput,
  ExternalBulkPaymentEntryCreateInput,
  PaymentRequestDetails,
  RdashProject,
  VendorPaymentRequestConfigItem,
} from "@/types/rdash";
import { apiFetch, paginateRdash } from "../api";
import { encodeRdashId } from "../rdash-id";
import type { RdashSource } from "./types";

// RDASH_DATA_SOURCE=real. Every call uses the logged-in user's access token,
// so rDash CAN_* permissions apply and entries are attributed to that user.
// Lazy refresh-on-401 happens inside apiFetch / paginateRdash; routes using
// this source must be wrapped in withAuthCookies (enforced by a test).
//
// Ids from rDash (project ids, payment_request_id) are passed back unchanged.
// Only the session vendor id (stored decoded) is re-encoded for the query.

// Bulk body shape. ONE place to flip once rDash confirms.
// TODO(verify): `{ entries }` vs `{ data: { entries } }` (docs/api-notes.md → #13).
export const BULK_BODY_WRAPPER: "entries" | "data.entries" = "entries";

export function buildBulkBody(
  entries: BulkPaymentEntryInput[],
): ExternalBulkPaymentEntryCreateInput | { data: ExternalBulkPaymentEntryCreateInput } {
  const body: ExternalBulkPaymentEntryCreateInput = { entries };
  return BULK_BODY_WRAPPER === "entries" ? body : { data: body };
}

export function createRealSource(accessToken: string): RdashSource {
  if (!accessToken) throw new Error("createRealSource: missing access token");
  return {
    async listProjects(): Promise<RdashProject[]> {
      // Ids pass through untouched (NO decodeIdField): allocation-rows.ts
      // matches them against config project_id, which is also passed through.
      return paginateRdash<RdashProject>("/v2/projects", accessToken);
    },

    async listPaymentRequestConfig(vendorId: string): Promise<VendorPaymentRequestConfigItem[]> {
      // TODO(verify): vendor_id query param takes the PBE-salt hashid
      // (docs/api-notes.md → #1).
      const vendor = encodeURIComponent(encodeRdashId(vendorId));
      // Paged until `count` items are collected (never single-page).
      return paginateRdash<VendorPaymentRequestConfigItem>(
        `/v2/vendor-payment-requests/config/?vendor_id=${vendor}`,
        accessToken,
        { untilCount: true },
      );
    },

    async getPaymentRequestDetails(projectId: string, requestId: string): Promise<PaymentRequestDetails> {
      if (!projectId || !requestId) throw new Error("getPaymentRequestDetails: projectId and requestId are required");
      // TODO(verify): path ids are the config's project_id / payment_request_id
      // as returned, and the response uses the standard { success, data }
      // envelope (docs/api-notes.md → #10, #14).
      return apiFetch<PaymentRequestDetails>(
        `/v2/projects/${encodeURIComponent(projectId)}/vendor-payment-requests/${encodeURIComponent(requestId)}`,
        accessToken,
      );
    },

    async createBulkPaymentEntries(entries: BulkPaymentEntryInput[]): Promise<BulkPaymentEntryCreateOutput> {
      // TODO(verify): partial failure comes back as 2xx with `failed[]`
      // (not a 4xx), max entries per call (docs/api-notes.md → #12, #13).
      return apiFetch<BulkPaymentEntryCreateOutput>(
        "/v2/vendor-payment-requests/payment-entries/bulk/",
        accessToken,
        { method: "POST", body: JSON.stringify(buildBulkBody(entries)) },
      );
    },
  };
}
