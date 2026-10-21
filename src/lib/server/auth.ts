import "server-only";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { EncryptJWT, jwtDecrypt, SignJWT, importPKCS8 } from "jose";
import { requireEnv } from "./env";
import { getDataSource } from "./rdash-source/mode";
import { devStaticTokenConfig, getCookieSecretKey, resolveAuthMode } from "@/lib/runtime-config";

const FRESH_HEADER = "x-pbe-auth-fresh";

// ── Config ──────────────────────────────────────────────────
// All config is read lazily via requireEnv so `next build` works without
// runtime secrets; a missing value throws on first use (never defaults).
const consumeUrl = () => `${requireEnv("RDASH_API_URL")}/api/v1/auth/embedded/handover/consume/`;
export const COOKIE_NAME = "pbe-auth";

// Shared with middleware.ts so both runtimes use the same validated key.
const getSecretKey = getCookieSecretKey;

const IS_DEV = process.env.NODE_ENV !== "production";

// ── Client assertion (private_key_jwt, RFC 7523) ────────────
type ClientPrivateKey = Awaited<ReturnType<typeof importPKCS8>>;

let cachedPrivateKey: ClientPrivateKey | null = null;

async function getClientPrivateKey(): Promise<ClientPrivateKey> {
  if (cachedPrivateKey) return cachedPrivateKey;
  // PEM may arrive with literal "\n" (e.g. from k8s secret env) — normalize.
  const pem = requireEnv("RDASH_CLIENT_PRIVATE_KEY_PEM").replace(/\\n/g, "\n");
  cachedPrivateKey = await importPKCS8(pem, requireEnv("RDASH_CLIENT_ALG"));
  return cachedPrivateKey;
}

async function buildClientAssertion(audience: string): Promise<string> {
  const key = await getClientPrivateKey();
  const clientId = requireEnv("RDASH_CLIENT_ID");
  return new SignJWT({})
    .setProtectedHeader({ alg: requireEnv("RDASH_CLIENT_ALG"), kid: requireEnv("RDASH_CLIENT_KID"), typ: "JWT" })
    .setIssuer(clientId)
    .setSubject(clientId)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("1m")
    .setJti(randomUUID())
    .sign(key);
}

const CLIENT_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

// ── Types ───────────────────────────────────────────────────
export interface AuthPayload {
  accessToken: string;
  // Access-token expiry (unix seconds). The cookie lives until then; there is
  // no refresh token — expiry means a fresh handover.
  expiresAt: number;
  orgId: string;
  projectId: string;
  userId: string;
  // rDash vendor the iframe was opened for (Manage Vendor → Vendor Payments).
  // From the iframe URL, verified against /v2/vendors in /api/session before
  // the cookie is set. Never rewritten from a URL afterwards.
  vendorId: string;
  displayName: string;
  // Optional in the handover response; null when rDash doesn't send it.
  email: string | null;
  tabCode: string | null;
  // Last in-app page the user was on, e.g. "/payments/new".
  // Server-only writer (middleware + /api/session). Carried across handovers
  // so iframe reloads can restore the user's location.
  lastPath?: string;
}

export interface AuthContext {
  accessToken: string;
  orgId: string;
  projectId: string;
  userId: string;
  // RULE (all vendor-scoped routes, incl. the future
  // api/rdash/payment-requests and api/rdash/payment-entries/bulk): the vendor
  // is ALWAYS auth.vendorId from the session. Any vendor id sent by the client
  // (query or body) is ignored — never read, never compared, never forwarded.
  // TODO: those routes don't exist yet; apply this when they are built.
  vendorId: string;
  displayName: string;
  email: string | null;
  tabCode: string | null;
  lastPath?: string;
}

// Allow-list validator for restoring lastPath. Only exact, known app routes
// with no query string are accepted, so a cookie-derived redirect target can
// never point anywhere unexpected. Must match RESTORABLE_PATHS in middleware.ts.
const RESTORABLE_PATHS = new Set(["/payments", "/payments/new"]);
export function isSafeRestorePath(path: string | undefined | null): path is string {
  if (!path) return false;
  if (typeof path !== "string") return false;
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  let url: URL;
  try {
    url = new URL(path, "http://placeholder");
  } catch {
    return false;
  }
  if (url.search || url.hash) return false;
  return RESTORABLE_PATHS.has(url.pathname);
}

interface GetAuthResult {
  auth: AuthContext;
}

// ── Cookie encrypt / decrypt ────────────────────────────────
async function encrypt(payload: AuthPayload): Promise<string> {
  return new EncryptJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .encrypt(getSecretKey());
}

async function decrypt(token: string): Promise<AuthPayload> {
  const { payload } = await jwtDecrypt(token, getSecretKey());
  return payload as unknown as AuthPayload;
}

// Identity + origin context for diagnostic logs. Reads cookie (for
// userId/orgId) and request headers (for referer / origin / user-agent /
// host) so log lines on the session-expired and handover paths carry
// enough RCA context to answer "which user, on which device, looking at
// which page, triggered this?" — the questions that come up first whenever
// auth flakes in prod. Callers that already have a decrypted `payload` in
// scope should pass it to skip the cookie re-decrypt.
//
// Safe to call outside a request scope: every read is wrapped so that
// helper-level failures never break the calling log line.
export type LogContext = {
  userId?: string;
  orgId?: string;
  projectId?: string;
  vendorId?: string;
  referer?: string;
  origin?: string;
  ua?: string;
  host?: string;
};

export async function getRequestLogContext(payload?: AuthPayload): Promise<LogContext> {
  const ctx: LogContext = {};

  if (payload) {
    ctx.userId = payload.userId || undefined;
    ctx.orgId = payload.orgId || undefined;
    ctx.projectId = payload.projectId || undefined;
    ctx.vendorId = payload.vendorId || undefined;
  } else {
    try {
      const cookieStore = await cookies();
      const value = cookieStore.get(COOKIE_NAME)?.value;
      if (value) {
        const p = await decrypt(value).catch(() => null);
        if (p) {
          const np = normalizePayloadIds(p);
          ctx.userId = np.userId || undefined;
          ctx.orgId = np.orgId || undefined;
          ctx.projectId = np.projectId || undefined;
          ctx.vendorId = np.vendorId || undefined;
        }
      }
    } catch {
      // Outside request scope (e.g. background work). Identity simply omitted.
    }
  }

  try {
    const h = await headers();
    ctx.referer = h.get("referer") || undefined;
    ctx.origin = h.get("origin") || undefined;
    ctx.ua = h.get("user-agent") || undefined;
    ctx.host = h.get("host") || undefined;
  } catch {
    // Outside request scope — same swallow.
  }

  return ctx;
}

// Build outbound `X-Pbe-*` headers to attach on every PBE → rdash-api call.
// rdash-api already has user_id/org_id from the JWT, so we don't repeat
// those — what's only available here is the browser context (the referer
// page, the actual end-user UA, the client IP) that gets lost when an
// rdash-api log just sees a "node" UA and the PBE pod's internal IP. With
// these headers, rdash-api's structlog can bind them onto each request log
// for cross-service correlation. Treat them as untrusted on rdash-api —
// log only, never gate authorization on them.
//
// Safe to call outside a request scope: returns `{}` when `headers()`
// throws (background work, build time).
export async function getOutboundContextHeaders(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const h = await headers();
    const referer = h.get("referer");
    const origin = h.get("origin");
    const ua = h.get("user-agent");
    // Prefer the first hop in x-forwarded-for; fall back to x-real-ip.
    // Both come from our ingress; the first hop is the true client IP.
    const xff = h.get("x-forwarded-for");
    const clientIp = (xff?.split(",")[0]?.trim()) || h.get("x-real-ip") || undefined;

    if (referer) out["X-Pbe-Referer"] = referer;
    if (origin) out["X-Pbe-Origin"] = origin;
    if (ua) out["X-Pbe-User-Agent"] = ua;
    if (clientIp) out["X-Pbe-Client-Ip"] = clientIp;
  } catch {
    // Outside request scope. No context to forward.
  }
  return out;
}

// Ids are rDash's own opaque strings, kept exactly as rDash sent them.
function normalizePayloadIds(p: AuthPayload): AuthPayload {
  const fix = (v: string | undefined): string | undefined => v;
  return {
    ...p,
    orgId: fix(p.orgId) || "",
    projectId: fix(p.projectId) || "",
    userId: fix(p.userId) || "",
    vendorId: fix(p.vendorId) || "",
  };
}

// ── Set / clear cookie ──────────────────────────────────────
// In prod we emit TWO Set-Cookie headers per write: one with Partitioned and
// one without. Background: CHIPS keys cookies by (name, domain, path,
// partitionKey), so the partitioned cookie (set in iframe context with
// partitionKey=https://rdash.dev) and any legacy/unpartitioned variant left
// over from a top-level visit to the app origin or pre-CHIPS code live as two
// separate entries in the jar. A single Set-Cookie matches only one of them;
// the other ghosts on forever, gets sent on the next request from the wrong
// context, and decrypts back into a dead session. Dual-emit keeps both
// variants in lockstep so a logout (or an expiry) clears BOTH.
// Dev mode skips the dual because SameSite=None+Secure isn't available on
// http://localhost — a single Lax cookie covers it.
function writeAuthCookieHeaders(response: NextResponse, value: string, maxAge: number): void {
  const base = `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly`;
  if (IS_DEV) {
    response.headers.append("Set-Cookie", `${base}; SameSite=Lax`);
    return;
  }
  response.headers.append("Set-Cookie", `${base}; Secure; SameSite=None; Partitioned`);
  response.headers.append("Set-Cookie", `${base}; Secure; SameSite=None`);
}

// Max-Age = until the access token expires (no refresh token to outlive it).
function cookieMaxAge(payload: AuthPayload): number {
  return Math.max(0, payload.expiresAt - Math.floor(Date.now() / 1000));
}

export function setAuthCookie(response: NextResponse, payload: AuthPayload): void {
  const maxAge = cookieMaxAge(payload);
  // Fire-and-forget — encrypt is async but the response is typically still
  // being assembled. Pre-existing behavior; setAuthCookieAsync is the awaited
  // variant for callers that need ordering guarantees.
  encrypt(payload).then((encrypted) => {
    writeAuthCookieHeaders(response, encrypted, maxAge);
  });
}

export async function setAuthCookieAsync(response: NextResponse, payload: AuthPayload): Promise<void> {
  const maxAge = cookieMaxAge(payload);
  const encrypted = await encrypt(payload);
  writeAuthCookieHeaders(response, encrypted, maxAge);
}

export function clearAuthCookie(response: NextResponse): void {
  writeAuthCookieHeaders(response, "", 0);
}

// Standard 401 response builder for route handlers that catch AuthError. Bakes
// in the dual-emit cookie clear so a dead session can't survive past one
// round-trip: without it the stale unpartitioned cookie variant would live on
// in the browser jar and be sent again on the next request. The dual-emit
// happens at the response boundary (raw NextResponse.headers.append), never
// via cookies().
// The client only ever sees a fixed message: SESSION_EXPIRED for an expired
// access token / rDash 401 (the browser re-handovers and restores the form),
// AUTH_ERROR_CLIENT_MESSAGE for everything else. The specific reason
// (mismatch, missing vendor, …) goes to the server log.
export const AUTH_ERROR_CLIENT_MESSAGE = "Not authenticated";
export const SESSION_EXPIRED = "session_expired";
export function authErrorResponse(err: AuthError, status: number = 401): NextResponse {
  console.error("[auth] request rejected", { status, reason: err.message });
  const error = err instanceof SessionExpiredError ? SESSION_EXPIRED : AUTH_ERROR_CLIENT_MESSAGE;
  const response = NextResponse.json({ error }, { status });
  clearAuthCookie(response);
  return response;
}

// No token refresh. rDash refresh tokens are single-use, and concurrent
// refreshes revoke the whole session ("replay"), so PBE never keeps or uses
// one. When the access token expires (cookie clock) or rDash answers 401, the
// request fails with SessionExpiredError → 401 { error: "session_expired" }
// + cookie cleared, and the iframe gets a fresh handover code from rDash
// (src/lib/api-fetch.ts → /embedded/bootstrap?force=1).
function isAccessTokenExpired(payload: AuthPayload): boolean {
  const exp = payload.expiresAt;
  return typeof exp !== "number" || !Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000);
}

// ── getAuth (for API routes) ────────────────────────────────
export async function getAuth(request: NextRequest): Promise<GetAuthResult> {
  const cookieValue = request.headers.get(FRESH_HEADER) || request.cookies.get(COOKIE_NAME)?.value;

  if (!cookieValue) {
    throw new AuthError("Not authenticated");
  }

  let payload: AuthPayload;
  try {
    payload = await decrypt(cookieValue);
  } catch (err) {
    console.warn("[auth] decrypt failed", err);
    throw new AuthError("Invalid session");
  }
  payload = normalizePayloadIds(payload);

  // Cross-user cookie guard (Fix B). When the caller supplies a user_id in
  // the URL (rdash-web does this on iframe entry and on workspace switches),
  // refuse to use a cookie whose decrypted userId doesn't match. Without
  // this, a stale partitioned cookie left over from a prior user — common
  // when a different rdash user logs into the same browser — would hand its
  // access token to rdash-api and misattribute writes.
  // Mismatch surfaces as 401 to the caller; the iframe is expected to
  // recover by re-handovering through /api/session.
  const urlUserIdRaw =
    request.nextUrl.searchParams.get("userId") ||
    request.nextUrl.searchParams.get("user_id") ||
    "";
  if (urlUserIdRaw && payload.userId) {
    const urlUserId = urlUserIdRaw;
    if (urlUserId !== payload.userId) {
      // RCA: this means middleware didn't run for this path (matcher gap) or
      // the cookie changed between middleware and this handler. Either way,
      // we refuse to proceed.
      console.warn("[auth/getAuth] userId mismatch, refusing request", {
        path: request.nextUrl.pathname,
        urlUserId,
        cookieUserId: payload.userId,
      });
      throw new AuthError("Session user mismatch");
    }
  }

  // Org guard. orgId comes only from the handover; a URL naming a different
  // org is refused (middleware clears the cookie in that case, this covers
  // any caller that reaches here regardless). Same check as
  // getAuthFromCookies.
  const urlOrgIdRaw =
    request.nextUrl.searchParams.get("orgId") ||
    request.nextUrl.searchParams.get("org_id") ||
    "";
  if (urlOrgIdRaw && payload.orgId) {
    const urlOrgId = urlOrgIdRaw;
    if (urlOrgId !== payload.orgId) {
      console.warn("[auth/getAuth] orgId mismatch, refusing request", {
        path: request.nextUrl.pathname,
        urlOrgId,
        cookieOrgId: payload.orgId,
        userId: payload.userId,
      });
      throw new AuthError("Session org mismatch");
    }
  }

  // Vendor guard. The session is bound to the vendor verified at handover;
  // a cookie without one (pre-vendor cookie) or a URL naming a different
  // vendor is refused so the iframe re-handovers and /api/session verifies
  // the new vendor. Middleware already clears the cookie on a URL mismatch;
  // this covers any caller that reaches here regardless.
  assertSessionVendor(
    payload,
    request.nextUrl.searchParams.get("vendorId") || request.nextUrl.searchParams.get("vendor_id") || "",
    "getAuth",
  );

  // Expired access token: never sent to rDash (it would only 401).
  if (isAccessTokenExpired(payload)) {
    throw new SessionExpiredError("Access token expired (cookie clock)");
  }

  return {
    auth: {
      accessToken: payload.accessToken,
      orgId: payload.orgId,
      projectId: payload.projectId,
      userId: payload.userId,
      vendorId: payload.vendorId,
      displayName: payload.displayName,
      email: payload.email ?? null,
      tabCode: payload.tabCode ?? null,
      lastPath: payload.lastPath,
    },
  };
}

// Throws AuthError when the session has no vendor, or when a vendor id in the
// URL (hashid or integer-string) doesn't match the session's verified vendor.
function assertSessionVendor(payload: AuthPayload, urlVendorIdRaw: string, where: string): void {
  if (!payload.vendorId) {
    console.warn(`[auth/${where}] session has no vendorId, refusing request`, { userId: payload.userId });
    throw new AuthError("Session has no vendor");
  }
  if (!urlVendorIdRaw) return;
  const urlVendorId = urlVendorIdRaw;
  if (urlVendorId !== payload.vendorId) {
    console.warn(`[auth/${where}] vendorId mismatch, refusing request`, {
      urlVendorId,
      cookieVendorId: payload.vendorId,
      userId: payload.userId,
    });
    throw new AuthError("Session vendor mismatch");
  }
}

// ── getAuthFromCookies (for server components) ──────────────
// Accepts optional searchParams. When rDash switches projects without a fresh
// handover, the iframe URL still carries the new projectId — we prefer it
// over the cookie's stale value so each request sees the current project.
// orgId and vendorId are NEVER taken from the URL: orgId comes only from the
// handover and vendorId only from the server-verified handover redirect. A
// URL org/vendor/user that differs from the cookie is refused (middleware
// clears the cookie in that case). The encrypted accessToken always comes
// from the cookie (URL params can never grant access on their own).
export async function getAuthFromCookies(searchParams?: Record<string, string | string[] | undefined>): Promise<AuthContext> {
  const cookieStore = await cookies();
  // Middleware re-issued the cookie for this request (project / lastPath
  // sync) and forwarded the fresh payload via a request header (cookies() propagation through
  // NextResponse.next({ request }) is unreliable). Prefer it.
  let cookieValue: string | undefined;
  try {
    const headerStore = await headers();
    cookieValue = headerStore.get(FRESH_HEADER) || undefined;
  } catch {}
  if (!cookieValue) cookieValue = cookieStore.get(COOKIE_NAME)?.value;

  if (!cookieValue) throw new AuthError("Not authenticated");

  let payload: AuthPayload;
  try {
    payload = await decrypt(cookieValue);
  } catch {
    throw new AuthError("Invalid session");
  }
  payload = normalizePayloadIds(payload);

  const pickStr = (v: string | string[] | undefined): string | undefined =>
    typeof v === "string" && v.trim().length > 0 ? v : undefined;
  // rDash hands off via snake_case (project_id/org_id/user_id) but our own
  // redirects use camelCase. Accept either.
  // URL ids are rDash's opaque strings — compared with the cookie as-is.
  const decodeMaybe = (v: string | undefined) => v;
  const urlProjectId = decodeMaybe(pickStr(searchParams?.projectId) || pickStr(searchParams?.project_id));
  const urlOrgId = decodeMaybe(pickStr(searchParams?.orgId) || pickStr(searchParams?.org_id));
  const urlUserId = decodeMaybe(pickStr(searchParams?.userId) || pickStr(searchParams?.user_id));
  const urlVendorIdRaw = pickStr(searchParams?.vendorId) || pickStr(searchParams?.vendor_id) || "";

  // Cross-user cookie guard (Fix B, server-component side). Same rationale
  // as the check in getAuth above. The only safe response is to throw and
  // let the page render an error/redirect to /api/session. Without this guard a stale cookie
  // would yield a page that does SSR fetches with the prior user's access
  // token, then 401s the moment any data call fires.
  if (urlUserId && payload.userId && urlUserId !== payload.userId) {
    console.warn("[auth/getAuthFromCookies] userId mismatch, refusing SSR", {
      urlUserId,
      cookieUserId: payload.userId,
      urlProjectId: urlProjectId || undefined,
      urlOrgId: urlOrgId || undefined,
    });
    throw new AuthError("Session user mismatch");
  }
  if (urlOrgId && payload.orgId && urlOrgId !== payload.orgId) {
    console.warn("[auth/getAuthFromCookies] orgId mismatch, refusing SSR", {
      urlOrgId,
      cookieOrgId: payload.orgId,
      userId: payload.userId,
    });
    throw new AuthError("Session org mismatch");
  }
  assertSessionVendor(payload, urlVendorIdRaw, "getAuthFromCookies");

  if (isAccessTokenExpired(payload)) {
    throw new SessionExpiredError("Access token expired (cookie clock)");
  }

  return {
    accessToken: payload.accessToken,
    orgId: payload.orgId,
    projectId: urlProjectId || payload.projectId,
    userId: payload.userId,
    vendorId: payload.vendorId,
    displayName: payload.displayName,
    email: payload.email ?? null,
    tabCode: payload.tabCode ?? null,
    lastPath: payload.lastPath,
  };
}

// Best-effort read of the existing auth cookie off a NextRequest. Used by
// /api/session to recover the prior payload (specifically `lastPath`) before
// overwriting it with the post-handover cookie. Returns null on missing or
// invalid cookies — the caller treats that as "no prior path to preserve".
export async function readAuthCookieFromRequest(request: NextRequest): Promise<AuthPayload | null> {
  const value = request.cookies.get(COOKIE_NAME)?.value;
  if (!value) return null;
  try {
    const payload = await decrypt(value);
    // Normalize legacy hashid IDs so callers can compare against the
    // post-decode values written to new cookies without spurious mismatches.
    return normalizePayloadIds(payload);
  } catch {
    return null;
  }
}

// ── Consume handover code ───────────────────────────────────
// A positive number of seconds, or null (never a default).
function positiveSeconds(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

// Diagnostic-only JWT claim peek. Decodes the access token's payload (NO
// signature check — never use this for auth decisions). Logged after every
// handover so we can see when rDash drops/restores `is_admin`, `roles`, etc.
function peekAccessTokenClaims(accessToken: string): Record<string, unknown> | null {
  try {
    const parts = accessToken.split(".");
    if (parts.length !== 3) return null;
    // base64url → base64
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Pull the fields we actually care about for debugging admin/permission
// drift. Keep the surface small so logs don't balloon.
function summariseClaims(claims: Record<string, unknown> | null): Record<string, unknown> {
  if (!claims) return { decoded: false };
  return {
    decoded: true,
    sub: claims.sub ?? claims.user_id ?? null,
    is_admin: claims.is_admin ?? null,
    roles: claims.roles ?? null,
    permissions: Array.isArray(claims.permissions) ? (claims.permissions as unknown[]).length : (claims.permissions ?? null),
    scopes: claims.scopes ?? claims.scope ?? null,
    org_id: claims.org_id ?? claims.organisation_id ?? null,
    exp: claims.exp ?? null,
    iat: claims.iat ?? null,
  };
}

export async function consumeHandoverCode(code: string): Promise<{
  accessToken: string;
  expiresIn: number;
  user: { id: string; display_name: string; email: string | null };
  org: { id: string; name: string; type: string };
  // rDash `app_slug`; null when absent. /api/session compares it with
  // RDASH_PBE_TAB_CODE (real mode).
  tabCode: string | null;
}> {
  const url = consumeUrl();
  console.log("[auth] consume start", { url, codeLen: code.length, ...(await getRequestLogContext()) });
  const assertion = await buildClientAssertion(url);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(await getOutboundContextHeaders()),
    },
    body: new URLSearchParams({
      code,
      client_assertion_type: CLIENT_ASSERTION_TYPE,
      client_assertion: assertion,
    }),
  });
  console.log("[auth] consume response", { status: res.status, ...(await getRequestLogContext()) });

  if (!res.ok) {
    const error = await res.text().catch(() => "Handover failed");
    console.error("[auth] consume failed", { status: res.status, body: error.slice(0, 500) });
    throw new Error(`Handover consume failed: ${error}`);
  }

  const json = await res.json();
  const data = json.data || json;
  // Drift check: log claims on the access token rDash issued for this
  // session (diagnostic only).
  console.log(
    "[auth] consume access token claims",
    summariseClaims(peekAccessTokenClaims(data.access_token)),
    await getRequestLogContext(),
  );
  // The access-token lifetime is required — never defaulted (the cookie
  // lives exactly that long). The refresh token is ignored: PBE never
  // refreshes. Email is optional.
  // TODO(verify): consume always returns expires_in; its value (access token
  // lifetime) is still to be confirmed; user.email may be absent
  // (docs/api-notes.md → #6, #7).
  const expiresIn = positiveSeconds(data.expires_in);
  if (expiresIn === null) {
    console.error("[auth] consume response missing expires_in");
    throw new AuthError("Handover response missing expires_in");
  }
  if (typeof data.access_token !== "string" || !data.access_token) {
    console.error("[auth] consume response missing access_token");
    throw new AuthError("Handover response missing access_token");
  }
  return {
    accessToken: data.access_token,
    expiresIn,
    user: {
      ...data.user,
      email: typeof data.user?.email === "string" && data.user.email ? data.user.email : null,
    },
    org: data.org,
    tabCode: typeof data.app_slug === "string" && data.app_slug ? data.app_slug : null,
  };
}

// ── getSessionOrMock (the ONLY mock-auth entry point) ───────
// RDASH_DATA_SOURCE=mock → fixed mock session, auth bypassed (logged).
// RDASH_DATA_SOURCE=real → normal cookie auth via getAuth; any AuthError
// propagates. There is never a fallback from real auth to the mock session.
// IDs are deliberately non-numeric: they are not rDash IDs, so any attempt to
// encode them for an outbound rDash call throws instead of hitting rDash.
const MOCK_AUTH: AuthContext = {
  accessToken: "mock-access-token",
  orgId: "mock-org",
  projectId: "",
  userId: "mock-user",
  vendorId: "mock-vendor",
  displayName: "Mock User",
  email: "mock.user@example.com",
  tabCode: "pbe",
};

// DEV static-token session (RDASH_AUTH_MODE=static_token, never production —
// runtime-config enforces it). No handover, no cookie. The vendor
// is RDASH_DEV_VENDOR_ID exactly as given (rDash's own hashid — no PBE-salt
// decode). The token is never logged.
function devStaticSession(): AuthContext {
  const dev = devStaticTokenConfig(process.env);
  return {
    accessToken: dev.token,
    orgId: "",
    projectId: "",
    userId: "",
    vendorId: dev.vendorId,
    displayName: "Dev (static token)",
    email: null,
    tabCode: null,
  };
}

export async function getSessionOrMock(
  request: NextRequest,
): Promise<GetAuthResult & { mock: boolean; dev: boolean }> {
  if (getDataSource() === "mock") {
    console.warn("[mock] auth bypassed", { path: request.nextUrl.pathname });
    return { auth: { ...MOCK_AUTH }, mock: true, dev: false };
  }
  if (resolveAuthMode(process.env) === "static_token") {
    console.warn("[dev] static-token session (real rDash data)", { path: request.nextUrl.pathname });
    return { auth: devStaticSession(), mock: false, dev: true };
  }
  const result = await getAuth(request);
  return { ...result, mock: false, dev: false };
}

// ── Auth error class ────────────────────────────────────────
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** The access token expired (cookie clock) or rDash answered 401. Mapped to
 *  401 { error: "session_expired" } + cookie cleared; the browser gets a
 *  fresh handover. The rDash call is never retried with another token. */
export class SessionExpiredError extends AuthError {
  constructor(reason: string) {
    super(reason);
    this.name = "SessionExpiredError";
  }
}
