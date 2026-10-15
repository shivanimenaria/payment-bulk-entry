import "server-only";
import { randomUUID } from "crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { EncryptJWT, jwtDecrypt, SignJWT, importPKCS8 } from "jose";
import { decodeRdashIdSafe } from "./rdash-id";
import { requireEnv } from "./env";
import { getDataSource } from "./rdash-source";
import { getCookieSecretKey } from "@/lib/runtime-config";

const FRESH_HEADER = "x-pbe-auth-fresh";

// ── Config ──────────────────────────────────────────────────
// All config is read lazily via requireEnv so `next build` works without
// runtime secrets; a missing value throws on first use (never defaults).
const consumeUrl = () => `${requireEnv("RDASH_API_URL")}/api/v1/auth/embedded/handover/consume/`;
const tokenUrl = () => `${requireEnv("RDASH_API_URL")}/api/v1/auth/token/`;
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
  refreshToken: string;
  expiresAt: number;       // unix seconds
  refreshExpiresAt: number;
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
  cookieHeader?: string; // non-null when refresh occurred — caller must set on response
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
// host) so log lines on the 401-refresh and revoked-cookie paths carry
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

// Defensive: an older cookie issued before the rDash-ID-decode rollout may
// still carry hashid strings for orgId/projectId/userId. Detect the hashid
// shape (non-numeric) and decode in place so downstream writes (created_by,
// activity_log.actor_id, etc.) always land in the DB as integer-strings.
function normalizePayloadIds(p: AuthPayload): AuthPayload {
  const fix = (v: string | undefined): string | undefined => {
    if (!v) return v;
    if (/^\d+$/.test(v)) return v;
    return decodeRdashIdSafe(v) ?? v;
  };
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
// variants in lockstep so a logout (or any refresh) clears/refreshes BOTH.
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

export function setAuthCookie(response: NextResponse, payload: AuthPayload): void {
  const maxAge = Math.max(0, payload.refreshExpiresAt - Math.floor(Date.now() / 1000));
  // Fire-and-forget — encrypt is async but the response is typically still
  // being assembled. Pre-existing behavior; setAuthCookieAsync is the awaited
  // variant for callers that need ordering guarantees.
  encrypt(payload).then((encrypted) => {
    writeAuthCookieHeaders(response, encrypted, maxAge);
  });
}

export async function setAuthCookieAsync(response: NextResponse, payload: AuthPayload): Promise<void> {
  const maxAge = Math.max(0, payload.refreshExpiresAt - Math.floor(Date.now() / 1000));
  const encrypted = await encrypt(payload);
  writeAuthCookieHeaders(response, encrypted, maxAge);
}

export function clearAuthCookie(response: NextResponse): void {
  writeAuthCookieHeaders(response, "", 0);
}

// Standard 401 response builder for route handlers that catch AuthError. Bakes
// in the dual-emit cookie clear so a revoked-refresh loop can't survive past
// one round-trip: without this, route handlers used to return a bare 401 while
// the stale unpartitioned cookie variant lived on in the browser jar, got sent
// on the next request, and triggered the same "Token has been revoked" →
// refresh → revoked cycle indefinitely. The dual-emit happens at the response
// boundary (raw NextResponse.headers.append), never via cookies().
// The client only ever sees a fixed message; the specific reason (mismatch,
// expired, missing vendor, …) goes to the server log.
export const AUTH_ERROR_CLIENT_MESSAGE = "Not authenticated";
export function authErrorResponse(err: AuthError, status: number = 401): NextResponse {
  console.error("[auth] request rejected", { status, reason: err.message });
  const response = NextResponse.json({ error: AUTH_ERROR_CLIENT_MESSAGE }, { status });
  clearAuthCookie(response);
  return response;
}

// ── Refresh cookie sink (dual-emit after a lazy refresh) ────
// Next's cookies().set() keeps ONE cookie per name, and when a route returns,
// Next re-parses the response's Set-Cookie headers by name if cookies() was
// mutated (appendMutableCookies) — collapsing any dual-emit. So the refresh
// path never touches cookies(); it queues the new value here and
// withAuthCookies writes it onto the route's response with
// writeAuthCookieHeaders (Partitioned + unpartitioned in prod, single Lax in
// dev). Every route that can trigger a refresh (anything calling apiFetch /
// paginateRdash / rdashFetchWithRetry / refreshAuthForRequest) MUST be
// wrapped — enforced by tests/auth-cookie-sink-coverage.test.ts.
type AuthCookieSink = { pending?: { value: string; maxAge: number } };
const authCookieSink = new AsyncLocalStorage<AuthCookieSink>();

function queueAuthCookie(value: string, maxAge: number): void {
  const sink = authCookieSink.getStore();
  if (!sink) {
    // Server component (can't set cookies) or an unwrapped route. Logged
    // loudly: an unwrapped route would leave the browser on a rotated
    // refresh token.
    console.error("[auth] refreshed cookie not written: caller is not wrapped in withAuthCookies");
    return;
  }
  sink.pending = { value, maxAge };
}

export function withAuthCookies<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const sink: AuthCookieSink = {};
    const res = await authCookieSink.run(sink, () => handler(...args));
    if (!sink.pending) return res;
    const out = res instanceof NextResponse ? res : new NextResponse(res.body, res);
    // Drop any single-emit copy so the browser gets exactly the pair.
    const others = out.headers.getSetCookie().filter((c) => !c.startsWith(`${COOKIE_NAME}=`));
    out.headers.delete("Set-Cookie");
    for (const c of others) out.headers.append("Set-Cookie", c);
    writeAuthCookieHeaders(out, sink.pending.value, sink.pending.maxAge);
    return out;
  };
}

// Token refresh is lazy: `apiFetch` / `paginateRdash` catch 401 from rDash
// and call `refreshAuthForRequest` (above) to rotate-and-retry. getAuth just
// surfaces whatever's in the cookie — the access token may technically be
// past its issued `expiresAt`, but rDash often accepts a small grace window
// and even when it doesn't, the very next rDash call triggers the refresh
// path. Never throwing "Session expired" purely on the cookie's clock means
// we don't kick a user back to handover on a token that still works.

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
  // access token to rdash-api and either misattribute writes or trigger a
  // 401→refresh→replay cascade that revokes the legitimate user's chain.
  // Mismatch surfaces as 401 to the caller; the iframe is expected to
  // recover by re-handovering through /api/session.
  const urlUserIdRaw =
    request.nextUrl.searchParams.get("userId") ||
    request.nextUrl.searchParams.get("user_id") ||
    "";
  if (urlUserIdRaw && payload.userId) {
    const urlUserId = /^\d+$/.test(urlUserIdRaw)
      ? urlUserIdRaw
      : (decodeRdashIdSafe(urlUserIdRaw) ?? urlUserIdRaw);
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
    const urlOrgId = /^\d+$/.test(urlOrgIdRaw)
      ? urlOrgIdRaw
      : (decodeRdashIdSafe(urlOrgIdRaw) ?? urlOrgIdRaw);
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

  const now = Math.floor(Date.now() / 1000);
  // Only the *refresh* token's expiry is a hard wall — past that we cannot
  // recover and the iframe must re-handover.
  if (payload.refreshExpiresAt <= now) {
    throw new AuthError("Session expired");
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
  const urlVendorId = /^\d+$/.test(urlVendorIdRaw)
    ? urlVendorIdRaw
    : (decodeRdashIdSafe(urlVendorIdRaw) ?? urlVendorIdRaw);
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
// clears the cookie in that case). The encrypted accessToken / refreshToken
// always come from the cookie (URL params can never grant access on their own).
export async function getAuthFromCookies(searchParams?: Record<string, string | string[] | undefined>): Promise<AuthContext> {
  const cookieStore = await cookies();
  // Middleware refreshed tokens for this request and forwarded the fresh
  // payload via a request header (cookies() propagation through
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
  // URL params arrive as rDash hashids when rDash navigates between projects
  // mid-session; decode to integer-string form to match the cookie payload.
  // Already-decoded values (from our own redirects) are passed through.
  const decodeMaybe = (v: string | undefined) => {
    if (!v) return v;
    if (/^\d+$/.test(v)) return v;
    return decodeRdashIdSafe(v) ?? v;
  };
  const urlProjectId = decodeMaybe(pickStr(searchParams?.projectId) || pickStr(searchParams?.project_id));
  const urlOrgId = decodeMaybe(pickStr(searchParams?.orgId) || pickStr(searchParams?.org_id));
  const urlUserId = decodeMaybe(pickStr(searchParams?.userId) || pickStr(searchParams?.user_id));
  const urlVendorIdRaw = pickStr(searchParams?.vendorId) || pickStr(searchParams?.vendor_id) || "";

  // Cross-user cookie guard (Fix B, server-component side). Same rationale
  // as the check in getAuth above. The server component can't trigger a
  // refresh, so its only safe response is to throw and let the page render
  // an error/redirect to /api/session. Without this guard a stale cookie
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

  // For server components, we can't refresh (no response to set cookie on).
  // If token is expired, the client will hit /api/auth/me which triggers refresh.
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

// ── Lazy refresh on 401 ───────────────────────────────────────────────────
// Called from `apiFetch`/`paginateRdash` after rDash returns 401. Coordinates
// concurrent refresh attempts so we never re-use a refresh token rDash has
// already rotated (the "replay detected" event that revokes the whole
// session). Two-level serialization:
//   1. In-process single-flight by userId. Two concurrent rDash calls inside
//      one Node pod share the same refresh attempt.
//   2. Postgres advisory lock + cached `pbe_user_sessions` row. Cross-pod and
//      cross-restart: if another flow already refreshed and persisted, every
//      subsequent caller just reads the cached row instead of calling rDash.
// After the refresh the new cookie is queued (queueAuthCookie) and written by
// withAuthCookies onto the route's response, dual-emitted. Server components
// have no response to write to; the DB cache still keeps the rest of the flow
// coherent there.
import { query, withTransaction, queryWithClient } from "./db";
import type { PoolClient } from "pg";

const refreshInFlight = new Map<string, Promise<RefreshOutcome>>();

export type RefreshOutcome =
  | { kind: "ok"; payload: AuthPayload }
  | { kind: "revoked" }
  | { kind: "transient" };

interface SessionCacheRow {
  access_token: string;
  refresh_token: string;
  expires_at: string;            // BIGINT → string from pg
  refresh_expires_at: string;
}

// Hash a userId to the 32-bit signed-int domain pg_advisory_lock expects.
// `hashtext` in pg returns INT4 (signed 32-bit); we mirror that range so
// callers never see "out of range" when the userId is a long decimal string.
function lockKey(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = ((h << 5) - h + userId.charCodeAt(i)) | 0;
  }
  return h;
}

type RdashRefreshResult =
  | { kind: "ok"; access: string; refresh: string; expiresIn: number; refreshExpiresIn: number }
  | { kind: "revoked" }
  | { kind: "transient" }
  // 2xx but missing refresh_token / expires_in / refresh_token_expires_in.
  // rDash has likely already rotated the old refresh token, so it must never
  // be reused and lifetimes are never defaulted → AuthError (re-handover).
  | { kind: "invalid"; missing: string[] };

// A positive number of seconds, or null (never a default).
function positiveSeconds(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

// Diagnostic-only JWT claim peek. Decodes the access token's payload (NO
// signature check — never use this for auth decisions). Logged after every
// fresh issuance so we can see when rDash drops/restores `is_admin`,
// `roles`, etc. on a refresh. RCA: admin user occasionally gets 403s
// because the access token rDash returned does NOT carry the admin claims
// even though their account is admin; this catches the drift.
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

async function callRdashRefresh(refreshToken: string): Promise<RdashRefreshResult> {
  const assertion = await buildClientAssertion(tokenUrl());
  // Bound the rDash call. The caller holds a PG advisory lock for the whole
  // refresh; an unbounded fetch could pin a pool connection forever if rDash
  // hangs and starve every other DB operation in this pod (`pool.max = 5`).
  // 4 s is enough for a healthy rDash (~300 ms typical) without keeping the
  // user staring at a spinner. If the token endpoint is truly slow, the
  // caller's helper surfaces this as AuthError → iframe re-handovers, which
  // is faster than waiting 10 s for a hang that probably won't resolve.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const res = await fetch(tokenUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(await getOutboundContextHeaders()),
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_assertion_type: CLIENT_ASSERTION_TYPE,
        client_assertion: assertion,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        "[auth/refresh] rDash refresh failed:",
        res.status,
        body.slice(0, 300),
        await getRequestLogContext(),
      );
      const lower = body.toLowerCase();
      const looksRevoked =
        res.status === 401 ||
        (res.status === 400 && (lower.includes("replay") || lower.includes("revoked") || lower.includes("invalid")));
      return { kind: looksRevoked ? "revoked" : "transient" };
    }
    const json = await res.json();
    const data = json.data || json;
    if (!data.access_token) {
      console.error("[auth/refresh] missing access_token in rDash response:", JSON.stringify(json).slice(0, 200));
      return { kind: "transient" };
    }
    // Drift check: log the JWT claims rDash just issued. If `is_admin` or
    // `roles` flip between refreshes for the same user, the intermittent
    // 403s on admin accounts come from rDash side (different auth-service
    // instances returning different claim sets).
    console.log(
      "[auth/refresh] fresh access token claims",
      summariseClaims(peekAccessTokenClaims(data.access_token as string)),
      await getRequestLogContext(),
    );
    // TODO(verify): refresh always returns refresh_token + both lifetimes
    // (docs/api-notes.md → #6). Missing → "invalid" → AuthError.
    const refresh = typeof data.refresh_token === "string" && data.refresh_token ? data.refresh_token : null;
    const expiresIn = positiveSeconds(data.expires_in);
    const refreshExpiresIn = positiveSeconds(data.refresh_token_expires_in);
    if (!refresh || expiresIn === null || refreshExpiresIn === null) {
      const missing = [
        !refresh && "refresh_token",
        expiresIn === null && "expires_in",
        refreshExpiresIn === null && "refresh_token_expires_in",
      ].filter(Boolean) as string[];
      console.error("[auth/refresh] incomplete rDash refresh response", { missing });
      return { kind: "invalid", missing };
    }
    return { kind: "ok", access: data.access_token as string, refresh, expiresIn, refreshExpiresIn };
  } catch (err) {
    console.error("[auth/refresh] threw:", err, await getRequestLogContext());
    return { kind: "transient" };
  } finally {
    clearTimeout(timer);
  }
}

// Core locked-refresh. Run inside a transaction so the advisory lock is held
// for the duration of the rDash call + the UPSERT.
//
// Cookie is the canonical source of "which session is the user on right now"
// — after a re-handover the cookie carries the fresh tokens, the DB cache
// still has the prior session's stale tokens. To avoid using a stale cache
// row from before a re-handover (which would re-trigger rDash's revoke), we
// only trust the cache when its refresh_token CHAIN includes the cookie's
// refresh_token (i.e. cache was produced by rotating the cookie's R, so
// cache.access_token is the live access token for this session).
async function refreshTokensLocked(payload: AuthPayload): Promise<RefreshOutcome> {
  const now = Math.floor(Date.now() / 1000);
  return withTransaction(async (client: PoolClient) => {
    await queryWithClient(client, "SELECT pg_advisory_xact_lock($1)", [lockKey(payload.userId)]);

    const rows = await queryWithClient<SessionCacheRow & { prior_refresh_token: string | null }>(
      client,
      "SELECT access_token, refresh_token, expires_at, refresh_expires_at, prior_refresh_token FROM pbe_user_sessions WHERE user_id = $1",
      [payload.userId]
    );
    const cached = rows[0];

    // Cache hit only when:
    //   - cache row exists, AND
    //   - it was produced by rotating the cookie's refresh token (so its
    //     access_token belongs to the SAME session the user is on now), AND
    //   - access token still has >30 s of life left.
    // A stale cache row from a prior session fails the prior_refresh_token
    // check and falls through to a fresh rDash call.
    const cacheBelongsToCookieSession =
      !!cached && cached.prior_refresh_token === payload.refreshToken;
    if (cached && cacheBelongsToCookieSession && Number(cached.expires_at) > now + 30) {
      return {
        kind: "ok",
        payload: {
          ...payload,
          accessToken: cached.access_token,
          refreshToken: cached.refresh_token,
          expiresAt: Number(cached.expires_at),
          refreshExpiresAt: Number(cached.refresh_expires_at),
        },
      };
    }

    // Always refresh using the COOKIE's refresh_token. The cookie reflects
    // the user's latest known session; the cache might hold a token rDash has
    // already rotated, which would trip "Refresh token replay detected".
    const refreshTokenToUse = payload.refreshToken;
    if (!refreshTokenToUse) {
      return { kind: "revoked" };
    }

    const outcome = await callRdashRefresh(refreshTokenToUse);
    if (outcome.kind === "revoked") {
      // rDash says this session is dead — drop the cache row so we don't keep
      // trying. Caller will surface the 401 and the iframe re-handovers.
      await queryWithClient(client, "DELETE FROM pbe_user_sessions WHERE user_id = $1", [payload.userId]);
      return { kind: "revoked" };
    }
    if (outcome.kind === "transient") {
      return { kind: "transient" };
    }
    if (outcome.kind === "invalid") {
      // Throwing rolls back the transaction (cache row untouched). The
      // caller clears the cookie and surfaces AuthError.
      throw new AuthError(`Refresh response missing ${outcome.missing.join(", ")}`);
    }

    const newExpires = now + outcome.expiresIn;
    const newRefreshExpires = now + outcome.refreshExpiresIn;
    await queryWithClient(
      client,
      `INSERT INTO pbe_user_sessions (user_id, access_token, refresh_token, expires_at, refresh_expires_at, prior_refresh_token, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         refresh_expires_at = EXCLUDED.refresh_expires_at,
         prior_refresh_token = EXCLUDED.prior_refresh_token,
         updated_at = NOW()`,
      [payload.userId, outcome.access, outcome.refresh, newExpires, newRefreshExpires, refreshTokenToUse]
    );

    return {
      kind: "ok",
      payload: {
        ...payload,
        accessToken: outcome.access,
        refreshToken: outcome.refresh,
        expiresAt: newExpires,
        refreshExpiresAt: newRefreshExpires,
      },
    };
  });
}

// Force-drop the cached session for a user. Called by /api/session on handover
// to discard any tokens that belong to the user's prior session — without
// this the next 401 path would happily hand back the prior session's now-dead
// tokens from the cache.
//
// Two cleanup steps:
//   1. DB row in pbe_user_sessions — the persistent cache.
//   2. In-process `refreshInFlight` entries for this user — these hold
//      already-resolved outcomes from the PRIOR session's refresh attempts
//      (often `revoked` from a replay detection event). Without this sweep
//      they'd linger for 5 s and could be returned to the NEW session's
//      first refresh-on-401, instantly killing the just-handed-over tokens.
export async function clearSessionCache(userId: string): Promise<void> {
  if (!userId) return;
  // Drop any in-flight dedup entries belonging to this user, regardless of
  // which refresh_token they were keyed against. New post-handover requests
  // will start their own fresh entry.
  let inFlightCleared = 0;
  for (const k of Array.from(refreshInFlight.keys())) {
    if (k.startsWith(`${userId}:`)) {
      refreshInFlight.delete(k);
      inFlightCleared++;
    }
  }
  let dbCleared = 0;
  try {
    // pg returns rowCount on the result; reusing `query` returns rows array
    // so we just count via a SELECT first to keep the log honest. Skipped to
    // avoid the extra round-trip — best-effort log only.
    await query("DELETE FROM pbe_user_sessions WHERE user_id = $1", [userId]);
    dbCleared = 1; // 0 or 1 (PK is user_id)
  } catch (err) {
    console.error("[auth/clearSessionCache] failed", { userId, err, ...(await getRequestLogContext()) });
    return;
  }
  console.info("[auth/clearSessionCache] cleared", {
    userId,
    inFlightCleared,
    ...(await getRequestLogContext()),
    dbCleared,
  });
}

// Seed `pbe_user_sessions` with the freshly-issued handover tokens. Without
// this, the row only exists for users whose access token expires *during*
// their visit (the lazy refresh path is the only other writer). Short
// sessions (under ~15 min) never trip a refresh, never get a row, so any
// "active sessions" audit / RCA query comes back partial.
//
// `prior_refresh_token` is NULL because no refresh produced this row — it
// came from a handover. That intentionally fails the cache-hit check in
// `refreshTokensLocked`, so the first real refresh attempt still goes to
// rDash (which is what we want — we have no proof yet that the cached row
// belongs to the cookie session). After that first refresh, the row gets
// rewritten with a non-null `prior_refresh_token` and cache hits work
// normally.
export async function seedSessionCache(params: {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshExpiresAt: number;
}): Promise<void> {
  const { userId, accessToken, refreshToken, expiresAt, refreshExpiresAt } = params;
  if (!userId) return;
  try {
    await query(
      `INSERT INTO pbe_user_sessions (user_id, access_token, refresh_token, expires_at, refresh_expires_at, prior_refresh_token, updated_at)
       VALUES ($1, $2, $3, $4, $5, NULL, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         refresh_expires_at = EXCLUDED.refresh_expires_at,
         prior_refresh_token = NULL,
         updated_at = NOW()`,
      [userId, accessToken, refreshToken, expiresAt, refreshExpiresAt]
    );
    console.info("[auth/seedSessionCache] seeded", { userId, expiresAt, refreshExpiresAt, ...(await getRequestLogContext()) });
  } catch (err) {
    // Best-effort. A DB write failure here shouldn't block the handover
    // (the cookie is still set and the user can still load the app).
    console.error("[auth/seedSessionCache] failed", { userId, err, ...(await getRequestLogContext()) });
  }
}

// Public entry point. Reads the current auth cookie, refreshes if needed,
// updates the cookie (best-effort), and returns the fresh payload. Returns
// `null` when there is no cookie at all (caller surfaces as 401). Returns
// `{ kind: "revoked" }` etc. so the caller can decide what to surface.
//
// `apiFetch` calls this after an rDash 401. Server components also benefit
// indirectly: even though they can't set cookies, the DB cache stores the new
// tokens, so the next route-handler request can pick them up.
export async function refreshAuthForRequest(): Promise<RefreshOutcome | { kind: "no_cookie" }> {
  let cookieStore: Awaited<ReturnType<typeof cookies>>;
  try {
    cookieStore = await cookies();
  } catch {
    return { kind: "no_cookie" };
  }
  const cookieValue = cookieStore.get(COOKIE_NAME)?.value;
  if (!cookieValue) return { kind: "no_cookie" };
  let payload: AuthPayload;
  try {
    payload = await decrypt(cookieValue);
  } catch {
    return { kind: "no_cookie" };
  }
  payload = normalizePayloadIds(payload);
  if (!payload.userId) return { kind: "revoked" };

  // Dedup key MUST include the refresh_token, not just userId. Two scenarios
  // require this:
  //   1. Handover (e.g. org switch) replaces the cookie's tokens but the
  //      userId stays the same. A previously cached outcome (revoked from
  //      the OLD refresh_token) would otherwise be returned for the NEW
  //      session's first refresh attempt, immediately killing it.
  //   2. Normal rotation — every successful refresh produces a new
  //      refresh_token, and we want the next refresh attempt to start fresh
  //      rather than re-using the (now-resolved) prior promise.
  // The map naturally orphans stale entries when the refresh_token changes;
  // they get cleaned by the 5 s sweep below.
  const key = `${payload.userId}:${payload.refreshToken}`;
  const existing = refreshInFlight.get(key);
  const outcomePromise = existing ?? refreshTokensLocked(payload).finally(() => {
    // Hold the dedup window slightly past the call so a flurry of 401s on
    // the SAME refresh_token collapse onto one outcome.
    setTimeout(() => refreshInFlight.delete(key), 5000);
  });
  if (!existing) refreshInFlight.set(key, outcomePromise);
  let outcome: RefreshOutcome;
  try {
    outcome = await outcomePromise;
  } catch (err) {
    if (err instanceof AuthError) {
      // Incomplete refresh response: the session can't continue. Clear the
      // cookie (both variants) so the iframe re-handovers.
      console.warn("[auth/refresh] refresh failed, clearing cookie", { reason: err.message });
      queueAuthCookie("", 0);
    }
    throw err;
  }

  if (outcome.kind === "ok") {
    // Queue the rotated cookie; withAuthCookies writes it to the route's
    // response both Partitioned and unpartitioned (same as setAuthCookie).
    // Server components have no response; the DB cache keeps the rest of the
    // flow coherent there.
    const encrypted = await encrypt(outcome.payload);
    const maxAge = Math.max(0, outcome.payload.refreshExpiresAt - Math.floor(Date.now() / 1000));
    queueAuthCookie(encrypted, maxAge);
  } else if (outcome.kind === "revoked") {
    // Fix D: clear the cookie when rDash tells us the session is dead.
    // Without this, every subsequent request from a stale tab (e.g. one
    // left open across a parent-side logout) loops through refresh →
    // revoked → refresh on the same dead refresh_token, racking up 4-second
    // rDash timeouts per call. Clearing the cookie ensures the *next*
    // request from that tab arrives with no cookie at all → fast 401 from
    // getAuth → the iframe knows to re-handover (or, for stale tabs, show
    // a session-expired error).
    //
    // Cleared through the same sink, so both partition variants go.
    console.warn("[auth/refresh] revoked outcome, clearing cookie", await getRequestLogContext(payload));
    queueAuthCookie("", 0);
  } else if (outcome.kind === "transient") {
    // Transient rDash failure (timeout, 5xx). Cookie is preserved; caller
    // surfaces the error and the next request retries. Log so we can spot
    // rDash outages by their PBE-side fingerprint.
    console.warn("[auth/refresh] transient outcome", await getRequestLogContext(payload));
  }
  return outcome;
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
export async function consumeHandoverCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
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
  // Drift check (handover side): log claims on the very first access token
  // rDash issues for this session. Pair this with the [auth/refresh] log to
  // see whether admin claims survive the refresh or get dropped.
  console.log(
    "[auth] consume access token claims",
    summariseClaims(peekAccessTokenClaims(data.access_token)),
    await getRequestLogContext(),
  );
  // Token lifetimes are required — never defaulted. Email is optional.
  // TODO(verify): consume always returns expires_in / refresh_token_expires_in;
  // user.email may be absent (docs/api-notes.md → #6, #7).
  const expiresIn = positiveSeconds(data.expires_in);
  const refreshExpiresIn = positiveSeconds(data.refresh_token_expires_in);
  if (expiresIn === null || refreshExpiresIn === null) {
    console.error("[auth] consume response missing token lifetimes", {
      expires_in: expiresIn !== null,
      refresh_token_expires_in: refreshExpiresIn !== null,
    });
    throw new AuthError("Handover response missing token lifetimes");
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn,
    refreshExpiresIn,
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

export async function getSessionOrMock(
  request: NextRequest,
): Promise<GetAuthResult & { mock: boolean }> {
  if (getDataSource() === "mock") {
    console.warn("[mock] auth bypassed", { path: request.nextUrl.pathname });
    return { auth: { ...MOCK_AUTH }, mock: true };
  }
  const result = await getAuth(request);
  return { ...result, mock: false };
}

// ── Auth error class ────────────────────────────────────────
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}
