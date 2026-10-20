import { NextRequest } from "next/server";
import { getSessionOrMock } from "@/lib/server/auth";
import { getRdashSource } from "@/lib/server/rdash-source";
import { loadAllocationRows } from "@/lib/server/rdash-source/allocation-rows";
import { isPayable } from "@/lib/payments/payable";
import { safeJson } from "@/lib/server/respond-safe";
import { rdashRouteError } from "@/lib/server/route-errors";

export const dynamic = "force-dynamic";

// GET /api/rdash/payment-requests → { rows: AllocationRow[] }
// Vendor = the SESSION vendor (auth.vendorId). No params are read — a
// vendor id in the query is ignored.
//  - config: all pages; details: concurrency 5, only rows with project_id
//    (others → detailsUnavailable); projectName from the projects list (null
//    if missing); failed details → row.detailsError (row kept).
//  - Only PAYABLE requests are kept (lib/payments/payable.ts: status in
//    PAYABLE_STATUSES AND payment_due > 0); the rest are dropped BEFORE any
//    details call.
export async function GET(request: NextRequest) {
  try {
    const { auth } = await getSessionOrMock(request);
    const rows = await loadAllocationRows(getRdashSource(auth), auth.vendorId, {
      keep: isPayable,
    });
    return safeJson({ rows }, { route: "GET /api/rdash/payment-requests" });
  } catch (err) {
    return rdashRouteError(err, "GET /api/rdash/payment-requests");
  }
}
