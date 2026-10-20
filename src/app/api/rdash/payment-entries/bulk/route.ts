import { NextRequest, NextResponse } from "next/server";
import { getSessionOrMock, withAuthCookies } from "@/lib/server/auth";
import { getRdashSource } from "@/lib/server/rdash-source";
import { devStaticTokenConfig, resolveAuthMode } from "@/lib/runtime-config";
import { safeJson } from "@/lib/server/respond-safe";
import { rdashRouteError, withCookieHeader } from "@/lib/server/route-errors";
import { validateSubmission } from "@/lib/payments/validation";
import { unitsToDecimalString, type Units } from "@/lib/payments/money";
import { BULK_AMOUNT_AS_STRING, buildBulkEntries } from "@/lib/payments/build-payload";
import type { BulkSubmitResult } from "@/types/payments";
import type { BulkPaymentEntryCreateOutput } from "@/types/rdash";

export const dynamic = "force-dynamic";

const ROUTE = "POST /api/rdash/payment-entries/bulk";

// POST /api/rdash/payment-entries/bulk   body { header, rows: [{ payment_request_id, amount, remark }] }
// Server never trusts client payment data:
//  1. Re-fetch the config for the SESSION vendor (all pages, user's token).
//     Any vendor id in the query/body is ignored.
//  2. Validate every row against that fresh config (validateSubmission). Any
//     invalid / duplicate / unknown row → 400 with field errors; the bulk API
//     is NOT called.
//  3. Build entries, create in one bulk call, map created/failed to amounts.
export const POST = withAuthCookies(async (request: NextRequest) => {
  // DEV static-token mode: writes blocked unless RDASH_DEV_ALLOW_WRITES=true.
  // Checked first — nothing is read from rDash either.
  if (resolveAuthMode(process.env) === "static_token" && !devStaticTokenConfig(process.env).allowWrites) {
    console.warn(`[${ROUTE}] blocked: writes disabled in dev static-token mode`);
    return NextResponse.json({ error: "Writes disabled in dev static-token mode" }, { status: 403 });
  }
  let body: { header?: unknown; rows?: unknown };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const { auth, cookieHeader } = await getSessionOrMock(request);
    const source = getRdashSource(auth);

    const freshConfig = await source.listPaymentRequestConfig(auth.vendorId);
    // Amount form (exact JSON number vs exact decimal string) is decided once
    // here and used for both validation and the payload.
    const bulkAmountAsString = BULK_AMOUNT_AS_STRING;
    const result = validateSubmission({ header: body.header, rows: body.rows }, freshConfig, { bulkAmountAsString });
    if (!result.ok) {
      return withCookieHeader(
        NextResponse.json(
          { error: "Validation failed", fieldErrors: result.errors, summary: result.summary },
          { status: 400 },
        ),
        cookieHeader,
      );
    }

    const entries = buildBulkEntries(result.value, bulkAmountAsString);
    const output = await source.createBulkPaymentEntries(entries);

    const amountById = new Map(result.value.rows.map((r) => [r.payment_request_id, r.amountUnits]));
    const summary = summarize(output, amountById);
    if (!summary) {
      // rDash's answer doesn't account for exactly the entries we sent. Some
      // may have been recorded, so we must not report them as "not recorded"
      // (a retry could pay twice).
      console.error(`[${ROUTE}] bulk output does not match submitted entries`, {
        submitted: Array.from(amountById.keys()),
        output,
      });
      return withCookieHeader(
        NextResponse.json(
          { error: "Could not confirm which payments were recorded. Check Payment Entries in rDash before retrying." },
          { status: 502 },
        ),
        cookieHeader,
      );
    }
    return withCookieHeader(safeJson(summary, { route: ROUTE }), cookieHeader);
  } catch (err) {
    return rdashRouteError(err, ROUTE);
  }
});

// created + failed must cover every submitted id exactly once; otherwise null.
// Amounts are exact units; the response carries exact decimal strings.
function summarize(output: BulkPaymentEntryCreateOutput, amountById: Map<string, Units>): BulkSubmitResult | null {
  if (!output || !Array.isArray(output.created) || !Array.isArray(output.failed)) return null;
  const seen = new Set<string>();
  let recorded = BigInt(0);
  let notRecorded = BigInt(0);
  for (const [list, isCreated] of [[output.created, true], [output.failed, false]] as const) {
    for (const item of list) {
      const id = item?.payment_request_id;
      const amount = typeof id === "string" ? amountById.get(id) : undefined;
      if (amount === undefined || seen.has(id)) return null;
      seen.add(id);
      if (isCreated) recorded += amount;
      else notRecorded += amount;
    }
  }
  if (seen.size !== amountById.size) return null;
  return {
    count: output.count,
    created: output.created,
    failed: output.failed,
    recordedAmount: unitsToDecimalString(recorded),
    notRecordedAmount: unitsToDecimalString(notRecorded),
  };
}
