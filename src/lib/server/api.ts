import "server-only";
import { SessionExpiredError, getRequestLogContext, getOutboundContextHeaders } from "./auth";
import { requireEnv } from "./env";
import { devStaticTokenConfig, resolveAuthMode } from "@/lib/runtime-config";
import type { ApiResponse, RdashVendor } from "@/types/rdash";

/** DEV static-token mode: rDash rejected the static token (401). There is
 *  no handover in this mode — the dev token must be replaced. */
export class DevTokenInvalidError extends Error {
  constructor() {
    super("dev token invalid");
    this.name = "DevTokenInvalidError";
  }
}

const isStaticTokenMode = () => resolveAuthMode(process.env) === "static_token";

/** Authorization header value: `Bearer <token>` normally; in DEV static-token
 *  mode `<RDASH_DEV_AUTH_SCHEME> <token>`. The token is never logged. */
export function rdashAuthHeader(token: string): string {
  if (isStaticTokenMode()) return `${devStaticTokenConfig(process.env).scheme} ${token}`;
  return `Bearer ${token}`;
}

/** rDash answered 401. Never refreshed, never retried with another token:
 *  DEV static-token mode → DevTokenInvalidError; otherwise the session is over
 *  → SessionExpiredError (route → 401 session_expired, cookie cleared, the
 *  browser re-handovers). */
async function failOn401(where: string, path: string, res: Response): Promise<never> {
  if (isStaticTokenMode()) {
    console.warn(`[${where}] rDash 401 in dev static-token mode (dev token invalid)`, { path });
    throw new DevTokenInvalidError();
  }
  const peek = await res.clone().text().catch(() => "");
  console.warn(`[${where}] rDash 401 — session expired, re-handover required`, path, peek.slice(0, 200), await getRequestLogContext());
  throw new SessionExpiredError(`rDash 401 on ${path}`);
}

/** An rDash list row without a usable `id` string. */
export class RdashIdDecodeError extends Error {
  constructor(path?: string) {
    super(`Missing rDash id${path ? ` in ${path}` : ""}`);
    this.name = "RdashIdDecodeError";
  }
}

/** An rDash list response that is neither `{data: [...]}` nor `{data: {data: [...]}}`. */
export class RdashResponseShapeError extends Error {
  constructor(path: string) {
    super(`Unexpected rDash response shape for ${path}`);
    this.name = "RdashResponseShapeError";
  }
}

/** Non-2xx (other than 401/403) or `success: false` from rDash. The message
 *  is fixed; status and body are logged with console.error where thrown. */
export class RdashUpstreamError extends Error {
  constructor(public readonly status: number) {
    super("rDash request failed");
    this.name = "RdashUpstreamError";
  }
}

// Each row's top-level rDash `id` is kept exactly as rDash sent it (an
// opaque hashid string — no decode, no salt). A missing / empty id throws —
// never guessed.
function decodeIdField<T extends { id?: unknown }>(row: T): T {
  if (typeof row?.id !== "string" || row.id.trim() === "") {
    console.error("[api] missing rDash id", { type: typeof row?.id });
    throw new RdashIdDecodeError();
  }
  return row;
}
function decodeIdFields<T extends { id?: unknown }>(rows: T[]): T[] {
  return rows.map(decodeIdField);
}
/**
 * Thrown when an rDash call returns 403. Route handlers should catch this and
 * surface a friendly "You do not have access to perform this action" to the
 * client (with the same status code) so the UI can toast it.
 */
export class RdashPermissionError extends Error {
  status = 403 as const;
  constructor(message?: string) {
    super(message || "You do not have access to perform this action");
    this.name = "RdashPermissionError";
  }
}

/** Inspect an rDash response and throw `RdashPermissionError` on 403. */
export async function assertRdashOk(res: Response, path?: string): Promise<void> {
  if (res.ok) return;
  if (res.status === 403) {
    const body = await res.clone().text().catch(() => "");
    console.error("[rDash 403]", path || res.url, body.slice(0, 300));
    throw new RdashPermissionError();
  }
}

// One rDash request. Wrapped by `apiFetch` below.
async function rdashFetchOnce(path: string, token: string, options?: RequestInit): Promise<Response> {
  return fetch(`${requireEnv("RDASH_API_URL")}${path}`, {
    ...options,
    headers: {
      Authorization: rdashAuthHeader(token),
      "Content-Type": "application/json",
      ...(await getOutboundContextHeaders()),
      ...options?.headers,
    },
  });
}

// Generic fetch with auth. A 401 is final (failOn401): the call is never
// retried — not even a POST — and the browser gets a fresh handover.
export async function apiFetch<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  const res = await rdashFetchOnce(path, token, options);

  if (res.status === 401) await failOn401("apiFetch", path, res);

  if (!res.ok) {
    if (res.status === 403) {
      const body = await res.clone().text().catch(() => "");
      console.error("[apiFetch 403]", path, body.slice(0, 300));
      throw new RdashPermissionError();
    }
    const errorText = await res.text().catch(() => "");
    console.error("[apiFetch] failed:", path, "status:", res.status, "body:", errorText.slice(0, 500));
    throw new RdashUpstreamError(res.status);
  }

  const json: ApiResponse<T> = await res.json();
  if (!json.success) {
    console.error("[apiFetch] success=false:", path, "message:", json.message);
    throw new RdashUpstreamError(res.status);
  }

  return json.data;
}

// ============ Pagination helper ============

// Fetches every page of an rDash list endpoint. Pages with limit/offset until a
// short page returns. Handles both envelope shapes used by rDash:
//   { success, data: [...] }                 (flat)
//   { success, data: { data: [...], ... } }  (nested, e.g. /v2/vendors)
//
// DRF-paginated endpoints (`{ count, next, previous, results }`, e.g. the
// payment-request config) use paginateRdashDrf below instead.
// 401 on any page → SessionExpiredError (failOn401); never refreshed.
export async function paginateRdash<T>(path: string, token: string): Promise<T[]> {
  const PAGE = 200;
  // Hard cap on requests per call. Reaching it without a normal stop throws
  // RdashResponseShapeError — never a silently truncated list.
  const MAX_PAGES = 200;
  const out: T[] = [];
  // ID dedup across pages — see the "rDash ignores pagination" comment below.
  const seen = new Set<string>();
  let offset = 0;
  const sep = path.includes("?") ? "&" : "?";
  // Snapshot once — all page fetches in this paginated call share the same
  // browser-context headers (one user, one referer, one device).
  const ctxHeaders = await getOutboundContextHeaders();
  for (let i = 0; i < MAX_PAGES; i++) {
    const url = `${requireEnv("RDASH_API_URL")}${path}${sep}limit=${PAGE}&offset=${offset}`;
    const res = await fetch(url, { headers: { Authorization: rdashAuthHeader(token), ...ctxHeaders } });

    if (res.status === 401) await failOn401("paginateRdash", path, res);

    if (!res.ok) {
      if (res.status === 403) {
        const body = await res.clone().text().catch(() => "");
        console.error("[paginateRdash 403]", path, body.slice(0, 300));
        throw new RdashPermissionError();
      }
      const body = await res.text().catch(() => "");
      console.error("[paginateRdash] failed:", path, res.status, body.slice(0, 300));
      throw new RdashUpstreamError(res.status);
    }
    const json = await res.json();
    const root = json?.data;
    // DRF page (`{ count, next, previous, results }` — e.g. /v2/projects and
    // the config, confirmed from real responses): hand the already-fetched
    // first page to the DRF paginator (follow `next`, total = count, strict).
    if (i === 0 && isDrfPage(root)) {
      return drfFollow<T>(path, url, json, token);
    }
    // Legacy envelopes `{ data: [...] }` / `{ data: { data: [...] } }`
    // (TODO(verify), docs/api-notes.md → #2). Anything else throws — never [].
    let page: T[];
    if (Array.isArray(root)) page = root;
    else if (root && Array.isArray(root.data)) page = root.data;
    else {
      console.error("[paginateRdash] unexpected response shape", {
        path,
        offset,
        topKeys: json && typeof json === "object" ? Object.keys(json) : typeof json,
        dataType: Array.isArray(root) ? "array" : typeof root,
      });
      throw new RdashResponseShapeError(path);
    }
    // Defensive dedup: some rDash list endpoints ignore `limit`/`offset` and
    // return the full set on every call. Without this, the loop pushes the
    // same items up to 200 times and downstream callers see 75k "elements"
    // for a 380-element order. Track item IDs across pages and stop once a
    // page brings no new IDs — that's the signature of pagination being
    // silently ignored. Falls back to length-based stop for shapes without
    // an `id` field (which all current rDash list responses do have).
    let addedThisPage = 0;
    for (const item of page) {
      const id = (item as { id?: string | number } | null)?.id;
      if (id != null) {
        const key = String(id);
        if (seen.has(key)) continue;
        seen.add(key);
      }
      out.push(item);
      addedThisPage++;
    }
    // Normal stop: a short page is the last page.
    if (page.length < PAGE) return out;
    // rDash returned a "full" page but none of it was new → pagination is
    // being ignored. Stop here rather than loop 199 more times.
    if (addedThisPage === 0) {
      console.warn("[paginateRdash] no new items in page — likely ignored pagination, stopping", { path, offset, pageLen: page.length, accumulated: out.length });
      return out;
    }
    offset += PAGE;
  }
  // Only reachable when MAX_PAGES requests never hit a normal stop: the list
  // is incomplete → error, never a partial list.
  console.error("[paginateRdash] page cap hit before the list ended", { path, maxPages: MAX_PAGES, collected: out.length });
  throw new RdashResponseShapeError(path);
}

// ============ DRF pagination (config) ============

// Fetches every page of a DRF-paginated rDash list. Real shape (captured from
// production, tests/fixtures/real-config-page.json):
//   { success, data: { count, next, previous, results: [...] } }
// The first request asks for limit=200&offset=0; after that `next` is
// followed exactly as rDash returns it, until it is null. Fail closed — any of
// these throws RdashResponseShapeError (never a partial or guessed list):
//   - missing/invalid `count`, `results` not an array, `next` not string|null
//   - `count` changing between pages
//   - `next` on a different origin or path than RDASH_API_URL + `path`
//     (the user's token is never sent anywhere else)
//   - an empty page while `next` is still set, or the page cap reached
//   - total collected ≠ `count` when `next` becomes null
// 401 → SessionExpiredError (failOn401), never refreshed. 403 →
// RdashPermissionError.
export async function paginateRdashDrf<T>(path: string, token: string): Promise<T[]> {
  const base = requireEnv("RDASH_API_URL");
  const sep = path.includes("?") ? "&" : "?";
  return drfFollow<T>(path, `${base}${path}${sep}limit=${DRF_PAGE}&offset=0`, null, token);
}

const DRF_PAGE = 200;

/** A DRF page root: `{ count: number, next, results: [] }`. */
function isDrfPage(root: unknown): boolean {
  return (
    !!root &&
    typeof root === "object" &&
    !Array.isArray(root) &&
    Array.isArray((root as { results?: unknown }).results) &&
    "count" in (root as object) &&
    "next" in (root as object)
  );
}

// DRF core. `prefetched` = the already-fetched JSON of `firstUrl` (when
// paginateRdash detected a DRF page), so page 1 isn't requested twice.
async function drfFollow<T>(
  path: string,
  firstUrl: string,
  prefetched: unknown,
  token: string,
): Promise<T[]> {
  const MAX_PAGES = 200;
  const first = new URL(firstUrl);
  const ctxHeaders = await getOutboundContextHeaders();
  let count: number | null = null;
  const out: T[] = [];
  let url: string | null = first.toString();
  let pending: unknown = prefetched;

  const shapeError = (detail: Record<string, unknown>): never => {
    console.error("[paginateRdashDrf] unexpected response", { path, ...detail });
    throw new RdashResponseShapeError(path);
  };

  for (let i = 0; url; i++) {
    if (i >= MAX_PAGES) shapeError({ reason: "page cap reached", collected: out.length, count });
    const pageUrl: string = url;
    let json: { success?: unknown; data?: unknown } | null;
    if (pending !== null && pending !== undefined) {
      json = pending as typeof json;
      pending = null;
    } else {
      json = await fetchDrfPage(pageUrl);
    }
    if (!json || json.success === false) shapeError({ reason: "success=false or not JSON", page: i });
    const root = (json as { data?: unknown }).data as { count?: unknown; results?: unknown; next?: unknown } | undefined;
    const pageCount = root?.count as number;
    const results = root?.results;
    const next = root?.next;
    if (!Number.isInteger(pageCount) || pageCount < 0) shapeError({ reason: "invalid count", page: i });
    if (!Array.isArray(results)) shapeError({ reason: "results not an array", page: i, keys: root && typeof root === "object" ? Object.keys(root) : typeof root });
    if (next !== null && typeof next !== "string") shapeError({ reason: "invalid next", page: i });
    if (count === null) count = pageCount;
    else if (pageCount !== count) shapeError({ reason: "count changed between pages", page: i, count, pageCount });
    for (const item of results as T[]) out.push(item);
    if (next) {
      if ((results as T[]).length === 0) shapeError({ reason: "empty page with next", page: i });
      let nextUrl: URL;
      try {
        nextUrl = new URL(next as string);
      } catch {
        return shapeError({ reason: "next is not a URL", page: i });
      }
      if (nextUrl.origin !== first.origin || nextUrl.pathname !== first.pathname) {
        shapeError({ reason: "next points outside RDASH_API_URL/path", page: i, nextOrigin: nextUrl.origin });
      }
      url = nextUrl.toString();
    } else {
      url = null;
    }
  }
  if (out.length !== count) shapeError({ reason: "total does not match count", collected: out.length, count });
  return out;

  async function fetchDrfPage(pageUrl: string): Promise<{ success?: unknown; data?: unknown } | null> {
    const res = await fetch(pageUrl, { headers: { Authorization: rdashAuthHeader(token), ...ctxHeaders } });
    if (res.status === 401) await failOn401("paginateRdashDrf", path, res);
    if (!res.ok) {
      if (res.status === 403) {
        const body = await res.clone().text().catch(() => "");
        console.error("[paginateRdashDrf 403]", path, body.slice(0, 300));
        throw new RdashPermissionError();
      }
      const body = await res.text().catch(() => "");
      console.error("[paginateRdashDrf] failed:", path, res.status, body.slice(0, 300));
      throw new RdashUpstreamError(res.status);
    }
    return res.json().catch(() => null);
  }
}

// ============ Vendors (org-level) ============

// Full org vendor list. Every page is fetched — never single-page.
export async function listAllVendors(token: string): Promise<RdashVendor[]> {
  const rows = await paginateRdash<RdashVendor>(`/v2/vendors`, token);
  return decodeIdFields(rows);
}

// Vendor search using rDash's `name` filter (/v2/vendors supports `name`,
// `code`, `limit`, `offset`). Paginated like every other list call so a
// broad search never silently truncates.
export async function searchVendors(token: string, query: string): Promise<RdashVendor[]> {
  const trimmed = (query || "").trim();
  if (!trimmed) return listAllVendors(token);
  const rows = await paginateRdash<RdashVendor>(`/v2/vendors?name=${encodeURIComponent(trimmed)}`, token);
  return decodeIdFields(rows);
}

/** The vendor id is not in the org's /v2/vendors list for this token. */
export class VendorNotFoundError extends Error {
  constructor(vendorId: string) {
    super(`Vendor ${vendorId} not found in org`);
    this.name = "VendorNotFoundError";
  }
}

// Verify a vendor belongs to the token's org. /v2/vendors is org-scoped by the
// token and has no id filter (Swagger: name, code, limit, offset), so every
// page is fetched and the decoded ids are compared.
// TODO(verify): /v2/vendors is scoped to the token's org, returns PBE-salt
// hashid ids, and the required permission (docs/api-notes.md → "/v2/vendors"). `vendorId` is the decoded
// integer-string. 403 → RdashPermissionError (from paginateRdash), never
// "not found". Used by /api/session with the just-issued handover token; a
// 401 there is a session error (no refresh exists).
export async function assertVendorInOrg(token: string, vendorId: string): Promise<RdashVendor> {
  if (!vendorId) throw new VendorNotFoundError(vendorId);
  const rows = decodeIdFields(await paginateRdash<RdashVendor>(`/v2/vendors`, token));
  const vendor = rows.find((v) => String(v.id) === vendorId);
  if (!vendor) throw new VendorNotFoundError(vendorId);
  return { id: String(vendor.id), name: vendor.name, code: vendor.code };
}
