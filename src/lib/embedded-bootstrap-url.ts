// Pure URL helpers for the embedded bootstrap page (/embedded/bootstrap).
// Kept free of React/DOM so the bootstrap → /api/session contract is unit
// tested (tests/vendor-context.test.ts).

// Fixed, user-facing messages for /api/session error codes. Unknown codes
// get the generic message.
export const BOOTSTRAP_ERROR_MESSAGES: Record<string, string> = {
  missing_vendor: "Please open Bulk Payment from a vendor's Vendor Payments page.",
  vendor_not_found: "This vendor could not be found in your organisation.",
  vendor_forbidden: "You do not have access to this vendor's payments.",
  org_mismatch: "This link belongs to a different organisation than your rDash session.",
  session_error: "Sign-in to this app failed.",
  // Set by api-fetch (not /api/session): a fresh handover ended in a 401
  // again right away — stop instead of looping.
  session_renew_failed: "Session could not be renewed — reload the tab.",
};

// org/user/vendor/project context from the bootstrap URL (either casing).
export function contextParams(params: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const [snake, camel] of [
    ["org_id", "orgId"],
    ["user_id", "userId"],
    ["vendor_id", "vendorId"],
    ["project_id", "projectId"],
  ]) {
    const v = params.get(snake) || params.get(camel);
    if (v) out.set(snake, v);
  }
  return out;
}

// vendor_id (or vendorId) from the resolved in-app target URL.
export function vendorIdFromTarget(target: string): string {
  try {
    const url = new URL(target, "http://placeholder");
    return url.searchParams.get("vendor_id") || url.searchParams.get("vendorId") || "";
  } catch {
    return "";
  }
}

export function sanitizeNext(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  return value;
}

function stripInternalParams(params: URLSearchParams): URLSearchParams {
  const clone = new URLSearchParams(params.toString());
  clone.delete("next");
  clone.delete("handover");
  return clone;
}

// Build the final in-app URL the iframe should navigate to. When `next` is
// set, parse it and merge project_id / org_id / user_id / vendor_id from the bootstrap
// URL if they're not already in `next`. When `next` is absent, fall back to
// `/payments?<stripped-params>`. The result always carries project context so
// the middleware can sync the cookie to the current rDash project.
export function mergeContextIntoTarget(next: string | null, params: URLSearchParams): string {
  if (!next) return `/payments?${stripInternalParams(params).toString()}`;
  const projectId = params.get("project_id") || params.get("projectId") || "";
  const orgId = params.get("org_id") || params.get("orgId") || "";
  const userId = params.get("user_id") || params.get("userId") || "";
  const vendorId = params.get("vendor_id") || params.get("vendorId") || "";
  try {
    const url = new URL(next, "http://placeholder");
    const has = (k: string) => url.searchParams.has(k);
    if (projectId && !has("project_id") && !has("projectId")) url.searchParams.set("project_id", projectId);
    if (orgId && !has("org_id") && !has("orgId")) url.searchParams.set("org_id", orgId);
    if (userId && !has("user_id") && !has("userId")) url.searchParams.set("user_id", userId);
    if (vendorId && !has("vendor_id") && !has("vendorId")) url.searchParams.set("vendor_id", vendorId);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return next;
  }
}

// /api/session URL for a handover code. Forwards the project/org context from
// the bootstrap URL as direct query params so the cookie's projectId gets
// populated (and the URL org_id cross-checked against the handover org)
// independently of `next`, plus the vendor id resolved from the target.
export function buildSessionUrl(
  code: string,
  targetUrl: string,
  params: URLSearchParams,
  vendorId: string,
): string {
  const handoverParams = new URLSearchParams();
  handoverParams.set("handover", code);
  handoverParams.set("next", targetUrl);
  const projectId = params.get("project_id") || "";
  const orgId = params.get("org_id") || "";
  if (projectId) handoverParams.set("project_id", projectId);
  if (orgId) handoverParams.set("org_id", orgId);
  handoverParams.set("vendor_id", vendorId);
  return `/api/session?${handoverParams.toString()}`;
}
