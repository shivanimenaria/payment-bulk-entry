import { NextRequest, NextResponse } from "next/server";
import { EncryptJWT, jwtDecrypt } from "jose";
import Hashids from "hashids";
import { getCookieSecretKey } from "@/lib/runtime-config";

// Edge runtime — no Node-only imports.
//
// PBE never refreshes rDash tokens (no refresh token is kept): when the access
// token expires, the iframe gets a fresh handover code from rDash.
//
// What middleware does:
//   1. Decrypt the auth cookie so we can detect URL-vs-cookie project drift
//      when rDash switches projects without re-handing-over, and clear it on
//      an org / vendor / user mismatch.
//   2. Clear an expired session: `/api/*` gets 401 { error: "session_expired" }
//      (the browser saves the form and re-handovers); pages pass through
//      without the cookie.
//   3. Maintain `lastPath` (the user's last in-app page) so iframe reloads
//      land where they left off.

// Must match COOKIE_NAME / FRESH_HEADER / SESSION_EXPIRED in
// src/lib/server/auth.ts (Edge runtime can't import server-only modules).
const COOKIE_NAME = "pbe-auth";
const FRESH_HEADER = "x-pbe-auth-fresh";
const SESSION_EXPIRED = "session_expired";
// Same validated key as src/lib/server/auth.ts (shared Edge-safe module).
// Also checked at server startup in src/instrumentation.ts.
const getSecretKey = getCookieSecretKey;
const IS_DEV = process.env.NODE_ENV !== "production";

// rDash hashid decoder — middleware sees URL params (project_id/org_id/user_id/vendor_id)
// in rDash's hashid form when rDash navigates between projects without a
// fresh handover. Decode before comparing to the cookie's decoded values.
// Inlined here because middleware runs on Edge runtime and can't import
// `server-only` modules. Same salt as src/lib/server/rdash-id.ts.
let rdashHashids: Hashids | null = null;
function getHashids(): Hashids {
  if (rdashHashids) return rdashHashids;
  const salt = process.env.EMBEDDED_APPS_HASH_ID_SALT_PBE;
  if (!salt) throw new Error("EMBEDDED_APPS_HASH_ID_SALT_PBE is not set");
  rdashHashids = new Hashids(salt, 16);
  return rdashHashids;
}
function decodeRdashIdMaybe(hash: string): string {
  // Pass through values that are already integer-string (e.g. when our own
  // app redirected back with decoded form). Only attempt rDash decode for
  // values that don't look like decimal ints.
  if (!hash) return "";
  if (/^\d+$/.test(hash)) return hash;
  const h = getHashids();
  try {
    const decoded = h.decode(hash);
    return decoded.length === 1 ? String(decoded[0]) : hash;
  } catch {
    // Characters outside the hashid alphabet — not a valid rDash id.
    return hash;
  }
}

interface AuthPayload {
  accessToken: string;
  expiresAt: number;
  orgId: string;
  projectId: string;
  userId: string;
  vendorId: string;
  displayName: string;
  email: string | null;
  tabCode: string | null;
  lastPath?: string;
}

// Restorable in-app pages. Must match RESTORABLE_PATHS in
// src/lib/server/auth.ts (Edge runtime can't import server-only modules).
const RESTORABLE_PATHS = new Set(["/payments", "/payments/new"]);

// Build the path we'd save into the cookie for the current request. Returns
// null when the request isn't a restorable page — in that case we leave the
// existing lastPath untouched. Query strings (workspace selectors etc.) are
// dropped since they vary per handover.
function buildRestorePath(req: NextRequest): string | null {
  return RESTORABLE_PATHS.has(req.nextUrl.pathname) ? req.nextUrl.pathname : null;
}

async function decrypt(token: string): Promise<AuthPayload | null> {
  const key = getSecretKey();
  try {
    const { payload } = await jwtDecrypt(token, key);
    return payload as unknown as AuthPayload;
  } catch {
    return null;
  }
}

async function encrypt(payload: AuthPayload): Promise<string> {
  return new EncryptJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .encrypt(getSecretKey());
}

// Mirrors writeAuthCookieHeaders in src/lib/server/auth.ts: in prod emit the
// cookie both Partitioned and unpartitioned (CHIPS) so both jar entries stay
// in lockstep; dev uses a single Lax cookie (no Secure on http://localhost).
function appendAuthCookie(response: NextResponse, value: string, maxAge: number): void {
  const base = `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly`;
  if (IS_DEV) {
    response.headers.append("Set-Cookie", `${base}; SameSite=Lax`);
    return;
  }
  response.headers.append("Set-Cookie", `${base}; Secure; SameSite=None; Partitioned`);
  response.headers.append("Set-Cookie", `${base}; Secure; SameSite=None`);
}

// Headers forwarded to the route handler. The internal FRESH_HEADER is ALWAYS
// removed: it is trusted by getAuth/getAuthFromCookies, so only this
// middleware may set it (after decrypting/validating the cookie) — a
// client-supplied copy must never reach a handler. When the cookie is being
// cleared, it is also removed from the forwarded Cookie header so the handler
// can't authenticate with the session we just rejected.
function forwardedHeaders(request: NextRequest, opts?: { dropAuthCookie?: boolean }): Headers {
  const headers = new Headers(request.headers);
  headers.delete(FRESH_HEADER);
  if (opts?.dropAuthCookie) {
    const rest = request.cookies
      .getAll()
      .filter((c) => c.name !== COOKIE_NAME)
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    if (rest) headers.set("cookie", rest);
    else headers.delete("cookie");
  }
  return headers;
}

function passThrough(request: NextRequest): NextResponse {
  return NextResponse.next({ request: { headers: forwardedHeaders(request) } });
}

// Expired session on an API route: answer here (the handler would only see
// "no cookie"), so the browser knows to save the form and re-handover.
function sessionExpiredResponse(): NextResponse {
  const response = NextResponse.json({ error: SESSION_EXPIRED }, { status: 401 });
  appendAuthCookie(response, "", 0);
  return response;
}

function clearAuthCookieResponse(request: NextRequest): NextResponse {
  const response = NextResponse.next({
    request: { headers: forwardedHeaders(request, { dropAuthCookie: true }) },
  });
  appendAuthCookie(response, "", 0);
  return response;
}

export async function middleware(request: NextRequest) {
  const cookieValue = request.cookies.get(COOKIE_NAME)?.value;
  if (!cookieValue) return passThrough(request);

  const payload = await decrypt(cookieValue);
  if (!payload) {
    // Cookie present but undecodable. Either tampered, or COOKIE_SECRET was
    // rotated between the set and now. Rare; log so we can correlate spikes
    // with deploys.
    console.warn("[middleware/auth] cookie decrypt failed, clearing", {
      path: request.nextUrl.pathname,
    });
    return clearAuthCookieResponse(request);
  }

  const now = Math.floor(Date.now() / 1000);

  // ── 1. Project sync / org + vendor + user guard from URL ─────
  // rDash navigates between projects without always doing a fresh handover —
  // the iframe URL carries the new projectId but the cookie still holds the
  // old value. Whenever the URL projectId contradicts the cookie we re-issue
  // the cookie with it so every downstream caller sees the right project.
  // The encrypted access token is NOT touched.
  // org, vendor and user are NOT synced from the URL: orgId comes only from
  // the handover, vendorId only from a server-verified handover. A URL value
  // that differs from the cookie clears the cookie, forcing a fresh handover
  // through /api/session (which verifies org and vendor).
  // rDash sends snake_case (project_id/org_id/user_id/vendor_id) via the
  // handover `next=` param; our own redirects use camelCase. Accept both.
  const sp = request.nextUrl.searchParams;
  const urlOrgId = decodeRdashIdMaybe(sp.get("orgId") || sp.get("org_id") || "");
  const urlProjectId = decodeRdashIdMaybe(sp.get("projectId") || sp.get("project_id") || "");
  const urlUserId = decodeRdashIdMaybe(sp.get("userId") || sp.get("user_id") || "");
  const urlVendorId = decodeRdashIdMaybe(sp.get("vendorId") || sp.get("vendor_id") || "");

  // Fix B (Layer 1): userId mismatch ≠ project/org mismatch and cannot be
  // recovered by rewriting the cookie. Project/org are workspace selectors
  // that rdash-api re-derives per request — a same-user navigation between
  // projects can safely reuse the access token. The userId, by contrast, IS
  // the access token's identity (rdash-api derives user_id from the JWT
  // claims, not from anything we send alongside). If they diverge, the
  // cookie's tokens belong to a DIFFERENT user from the one rdash-web thinks
  // owns this iframe — usually because a stale partitioned cookie survived
  // an rdash-web logout/login on the same browser. Rewriting userId while
  // keeping the tokens (the old behavior) produced exactly the cross-user
  // contamination we saw in production: rdash-api logged user_id=30646 on
  // /v2/* calls while the iframe claimed user 963 was active.
  //
  // Right response: clear the cookie. The next request lands at /api/session
  // via the iframe's normal handover entry, which mints a fresh cookie for
  // the correct user. No silent token reuse, no replay-cascade risk.
  if (urlUserId && urlUserId !== payload.userId) {
    // Critical RCA log. If this is firing frequently on a given user-pair,
    // we have someone repeatedly hitting the cross-user contamination path
    // (typical cause: parent-side logout/login on the same browser). Keep
    // userIds in integer-string form for greppability against rdash-api logs.
    console.warn("[middleware/auth] userId mismatch, clearing cookie", {
      path: request.nextUrl.pathname,
      urlUserId,
      cookieUserId: payload.userId,
      urlOrgId: urlOrgId || undefined,
      urlProjectId: urlProjectId || undefined,
    });
    return clearAuthCookieResponse(request);
  }

  // Org switch: the cookie's tokens were issued for the cookie's org. Never
  // relabel them with a URL org — clear and re-handover instead.
  if (urlOrgId && urlOrgId !== payload.orgId) {
    console.warn("[middleware/auth] orgId mismatch, clearing cookie", {
      path: request.nextUrl.pathname,
      urlOrgId,
      cookieOrgId: payload.orgId,
      userId: payload.userId,
    });
    return clearAuthCookieResponse(request);
  }

  // Vendor switch (or a pre-vendor cookie opened with a vendor): the new
  // vendor must go through /api/session's verification against /v2/vendors.
  if (urlVendorId && urlVendorId !== payload.vendorId) {
    console.warn("[middleware/auth] vendorId mismatch, clearing cookie", {
      path: request.nextUrl.pathname,
      urlVendorId,
      cookieVendorId: payload.vendorId || undefined,
      userId: payload.userId,
    });
    return clearAuthCookieResponse(request);
  }

  const projectMismatch = Boolean(urlProjectId) && urlProjectId !== payload.projectId;
  // ── 1b. lastPath sync (single-writer) ───────────────────────
  // Save the user's current restorable page so a later iframe reload (which
  // always goes through /api/session?handover=) can restore it. Only writes
  // on GET requests to restorable pages; other paths leave the cookie alone.
  let nextLastPath: string | undefined = payload.lastPath;
  let lastPathChanged = false;
  // A workspace switch makes the cached lastPath stale. Clear it.
  const projectActuallyChanged =
    Boolean(urlProjectId) && urlProjectId !== payload.projectId;
  if (projectActuallyChanged && payload.lastPath !== undefined) {
    nextLastPath = undefined;
    lastPathChanged = true;
  }
  if (request.method === "GET" && !projectActuallyChanged) {
    const restore = buildRestorePath(request);
    if (restore !== null && restore !== payload.lastPath) {
      nextLastPath = restore;
      lastPathChanged = true;
    }
  }

  // ── 2. Access-token expiry ───────────────────────────────────
  // No refresh exists: an expired access token ends the session. Clear the
  // cookie; API calls get 401 session_expired so the browser re-handovers.
  // A missing/invalid expiresAt (older cookie shape) counts as expired.
  if (typeof payload.expiresAt !== "number" || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= now) {
    console.info("[middleware/auth] access token expired, clearing cookie", {
      path: request.nextUrl.pathname,
      userId: payload.userId,
      expiresAt: payload.expiresAt,
      now,
    });
    if (request.nextUrl.pathname.startsWith("/api/")) return sessionExpiredResponse();
    return clearAuthCookieResponse(request);
  }

  // If nothing else changed, fast-path out.
  if (!projectMismatch && !lastPathChanged) return passThrough(request);

  let nextPayload: AuthPayload = payload;

  if (projectMismatch) {
    // Only projectId is rewritten. userId / orgId / vendorId mismatches are
    // caught above and clear the cookie instead.
    nextPayload = { ...nextPayload, projectId: urlProjectId };
  }

  if (lastPathChanged) {
    nextPayload = { ...nextPayload, lastPath: nextLastPath };
  }

  const encrypted = await encrypt(nextPayload);
  const maxAge = Math.max(0, nextPayload.expiresAt - now);

  // Mutate the inbound request so the server component sees the fresh cookie
  // value when it calls cookies()
  const requestHeaders = forwardedHeaders(request);
  const cookies = request.cookies;
  cookies.set(COOKIE_NAME, encrypted);
  // Rebuild Cookie header to include the new value for downstream
  const rebuilt = Array.from(cookies.getAll()).map((c) => `${c.name}=${c.value}`).join("; ");
  requestHeaders.set("cookie", rebuilt);
  // Belt-and-braces: also forward the fresh encrypted payload via a request
  // header. cookies() propagation through `NextResponse.next({ request })` is
  // unreliable across Next.js versions; headers() always works. getAuth* reads
  // this first and falls back to the cookie. This is the ONLY place the
  // header is set, and only with a payload this middleware just encrypted.
  requestHeaders.set(FRESH_HEADER, encrypted);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  appendAuthCookie(response, encrypted, maxAge);
  return response;
}

export const config = {
  // Run on app pages and internal rDash proxy routes. /api/session is skipped
  // (the handover flow sets the cookie itself); /api/auth/me is included so
  // the session probe sees the URL-synced workspace.
  // INVARIANT: every route/page that calls getAuth, getAuthFromCookies or
  // getSessionOrMock (which trust FRESH_HEADER) MUST be matched here, so the
  // header is stripped. Enforced by tests/middleware-coverage.test.ts.
  matcher: [
    "/payments/:path*",
    "/api/rdash/:path*",
    "/api/auth/me",
  ],
};
