import { NextRequest } from "next/server";
import { getSessionOrMock, withAuthCookies } from "@/lib/server/auth";
import { getRdashSource } from "@/lib/server/rdash-source";
import { loadAllocationRows } from "@/lib/server/rdash-source/allocation-rows";
import { safeJson } from "@/lib/server/respond-safe";
import { rdashRouteError, withCookieHeader } from "@/lib/server/route-errors";

export const dynamic = "force-dynamic";

// GET /api/rdash/payment-requests → { rows: AllocationRow[] }
// Vendor = the SESSION vendor (auth.vendorId). No params are read — a
// vendor id in the query is ignored.
//  - config: all pages; details: concurrency 5, only rows with project_id
//    (others → detailsUnavailable); projectName from the projects list (null
//    if missing); failed details → row.detailsError (row kept).
//  - Only payment_due > 0 is kept, dropped BEFORE any details call.
//    TODO(verify): payable status values (CLAUDE.md Open Items → "Payable
//    statuses"); no status filter until rDash confirms them.
export const GET = withAuthCookies(async (request: NextRequest) => {
  try {
    const { auth, cookieHeader } = await getSessionOrMock(request);
    const rows = await loadAllocationRows(getRdashSource(auth), auth.vendorId, {
      keep: (c) => c.payment_due > 0,
    });
    return withCookieHeader(safeJson({ rows }, { route: "GET /api/rdash/payment-requests" }), cookieHeader);
  } catch (err) {
    return rdashRouteError(err, "GET /api/rdash/payment-requests");
  }
});
