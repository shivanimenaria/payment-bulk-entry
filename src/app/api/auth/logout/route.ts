import { NextRequest, NextResponse } from "next/server";
import {
  clearAuthCookie,
  clearSessionCache,
  readAuthCookieFromRequest,
  getRequestLogContext,
} from "@/lib/server/auth";
import { checkSameOriginRequest } from "@/lib/server/request-guards";

// Session-dependent: always render per request, never prerender at build.
export const dynamic = "force-dynamic";

// Called when the parent rdash app posts a `{ type: "rdash_logout" }` message
// into the PBE iframe (see EmbeddedLogoutListener). The iframe's listener
// fetches this route which:
//
//   1. Clears the in-process `refreshInFlight` map + `pbe_user_sessions` DB
//      row for this user, so any concurrent refresh attempts can't serve a
//      cached outcome for the now-dead session.
//   2. Sets `pbe-auth=; Max-Age=0` with the exact same attributes
//      (httpOnly / secure / sameSite=none / partitioned / path=/) as
//      `setAuthCookie` — without attribute parity the browser would treat
//      the response as creating a *different* cookie and leave the original
//      alive.
//
// Cross-origin: rdash-api (the embedded token store) has already revoked
// the session via its own `/api/v1/auth/logout/` by the time we get here.
// Our only job is to clean up PBE-side state so the browser doesn't keep
// presenting a stale cookie on the next request.
//
// Returns 403 for requests that fail the same-origin CSRF guard. Otherwise
// always returns 204 — even on errors we want the parent's logout flow to
// continue uninterrupted. If the cookie clear fails for some reason, the
// next API call's revoked-outcome path (Fix D) will catch it.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
  const ctx = await getRequestLogContext();

  // Entry log — this is the single most-diagnostic line for confirming the
  // logout broadcast made it across the cross-TLD boundary. If this fires,
  // we know: parent dispatched → both iframe listeners forwarded →
  // postMessage delivered → PBE accepted the origin → fetch reached us.
  // If it DOESN'T fire after a parent logout, the bug is on the
  // rdash-web/postMessage side, not on PBE.
  console.info("[auth/logout] received", ctx);

  // CSRF guard: the session cookie is SameSite=None (required inside the
  // rDash iframe), so a third-party page could otherwise POST here and log
  // the user out. Only PBE's own same-origin listener may call this.
  const guard = checkSameOriginRequest(request.headers, "logout", process.env.APP_URL);
  if (!guard.ok) {
    console.warn("[auth/logout] rejected", { reason: guard.reason, ...ctx });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let userId: string | undefined;
  try {
    const payload = await readAuthCookieFromRequest(request);
    userId = payload?.userId;
  } catch {
    // Best-effort — proceed to clear cookie even if cookie can't be decrypted.
  }

  if (!userId) {
    // No cookie / decryption failed: the user is effectively already logged
    // out from PBE's perspective. Still set Max-Age=0 (idempotent) so a
    // partially-stale cookie definitely goes away.
    console.info("[auth/logout] no cookie to clear, returning 204", ctx);
    const response = new NextResponse(null, { status: 204 });
    clearAuthCookie(response);
    return response;
  }

  let cacheCleared = false;
  try {
    await clearSessionCache(userId);
    cacheCleared = true;
  } catch (err) {
    console.error("[auth/logout] clearSessionCache failed", { userId, err, ...ctx });
    // Continue — cookie clear is the user-visible part.
  }

  const response = new NextResponse(null, { status: 204 });
  clearAuthCookie(response);

  // Exit log — confirms both halves (DB cache + Set-Cookie) executed and
  // gives total latency. Together with the entry log above, you get a
  // bracket per logout that tells you "this user's PBE session was torn
  // down at T, from this referer, took Xms".
  console.info("[auth/logout] cleared session, returning 204", {
    userId,
    cacheCleared,
    durationMs: Date.now() - startedAt,
    ...ctx,
  });

  return response;
}
