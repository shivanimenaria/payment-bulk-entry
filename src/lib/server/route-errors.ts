import "server-only";
import { NextResponse } from "next/server";
import { AuthError, authErrorResponse } from "./auth";
import { DevTokenInvalidError, RdashPermissionError } from "./api";

export const PERMISSION_MESSAGE = "You do not have access to perform this action";
export const UPSTREAM_MESSAGE = "Could not load data from rDash. Please try again.";

// One error mapping for every BFF route (CLAUDE.md "Error surfacing"):
//   AuthError            → 401 (fixed message, cookie cleared) → client re-handovers
//   RdashPermissionError → 403 with the fixed permission message
//   anything else        → 502 generic message; details only in console.error
// Never an empty list / fake success.
export function rdashRouteError(err: unknown, route: string): NextResponse {
  if (err instanceof AuthError) return authErrorResponse(err);
  // DEV static-token mode only. Not a 401: that would send the browser into
  // the iframe re-handover flow, which doesn't exist in this mode.
  if (err instanceof DevTokenInvalidError) {
    console.error(`[${route}] dev token invalid (rDash 401) — replace RDASH_DEV_API_TOKEN`);
    return NextResponse.json({ error: "Dev token rejected by rDash (401)." }, { status: 502 });
  }
  if (err instanceof RdashPermissionError) {
    return NextResponse.json({ error: PERMISSION_MESSAGE }, { status: 403 });
  }
  console.error(`[${route}] upstream error`, err);
  return NextResponse.json({ error: UPSTREAM_MESSAGE }, { status: 502 });
}

// getAuth / getSessionOrMock return cookieHeader when they rotated the cookie.
export function withCookieHeader(res: NextResponse, cookieHeader: string | undefined): NextResponse {
  if (cookieHeader) res.headers.append("Set-Cookie", cookieHeader);
  return res;
}
