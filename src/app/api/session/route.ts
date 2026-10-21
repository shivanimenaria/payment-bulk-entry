import { NextRequest, NextResponse } from "next/server";
import {
  consumeHandoverCode,
  setAuthCookieAsync,
  readAuthCookieFromRequest,
  isSafeRestorePath,
  getRequestLogContext,
  type AuthPayload,
} from "@/lib/server/auth";
import { assertVendorInOrg, VendorNotFoundError, RdashPermissionError } from "@/lib/server/api";
import { getDataSource } from "@/lib/server/rdash-source";

// Session-dependent: always render per request, never prerender at build.
export const dynamic = "force-dynamic";

// Env required to complete a handover. Checked up front so a misconfigured
// deployment fails with a clear server log instead of a half-set session.
const REQUIRED_ENV = [
  "APP_URL",
  "RDASH_API_URL",
  "RDASH_CLIENT_ID",
  "RDASH_CLIENT_KID",
  "RDASH_CLIENT_ALG",
  "RDASH_CLIENT_PRIVATE_KEY_PEM",
  "COOKIE_SECRET",
] as const;

// In-memory cache of consumed handovers (code+next → redirect URL). The
// browser can replay the same /api/session URL (e.g. double navigation); the
// code is single-use on rDash, so a replay must not consume it again.
const sessionCache = new Map<string, string>();

// GET /api/session?handover=xxx&next=/payments  (embedded app flow only)
export async function GET(request: NextRequest) {
  const handoverCode = request.nextUrl.searchParams.get("handover");
  const nextParam = sanitizeNext(request.nextUrl.searchParams.get("next"));

  console.log("[session] GET", {
    hasHandover: Boolean(handoverCode),
    next: nextParam,
    // Evidence for the login-CSRF review: our bootstrap navigates here
    // same-origin. Logged only — not enforced until the rDash contract
    // confirms rDash never navigates the iframe here directly.
    secFetchSite: request.headers.get("sec-fetch-site"),
    ...(await getRequestLogContext()),
  });

  if (!handoverCode) {
    return NextResponse.json({ error: "Missing handover" }, { status: 400 });
  }

  // Real mode also requires the tab slug (compared with the handover's
  // app_slug). Mock mode skips that check. Also validated at startup.
  const isReal = getDataSource() === "real";
  const required: readonly string[] = isReal ? [...REQUIRED_ENV, "RDASH_PBE_TAB_CODE"] : REQUIRED_ENV;
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error("[session] Missing env vars:", missing.join(", "));
    return NextResponse.json({ error: "Session could not be established" }, { status: 500 });
  }
  const appUrl = process.env.APP_URL as string;

  const cacheKey = `${handoverCode}::${nextParam || ""}`;
  const cached = sessionCache.get(cacheKey);
  if (cached) {
    return NextResponse.redirect(cached);
  }

  // Error redirects carry only a fixed error code (shown by the bootstrap
  // page); details go to the server log. The cookie is never set on these.
  const failWith = (code: string) => {
    const url = `${appUrl}/embedded/bootstrap?error=${code}`;
    // Cache the failure too: a replayed URL must not re-consume the code.
    sessionCache.set(cacheKey, url);
    setTimeout(() => sessionCache.delete(cacheKey), 5 * 60 * 1000);
    return NextResponse.redirect(url);
  };

  // rDash ids (user.id / org.id / project_id / vendor_id) are opaque
  // strings, already encoded by rDash for this app: stored and compared
  // as-is, sent back to rDash unchanged (no decode / re-encode, no salt).
  const toIntString = (raw: string): string => raw.trim();

  // vendor_id is required: PBE is opened from a vendor's Vendor Payments
  // page. Checked before consuming the handover so a bad URL doesn't burn
  // the code. A present-but-undecodable value is treated as unknown vendor.
  const rawVendorId = request.nextUrl.searchParams.get("vendor_id") || "";
  if (!rawVendorId) {
    console.warn("[session] missing vendor_id");
    return failWith("missing_vendor");
  }
  const vendorId = toIntString(rawVendorId);
  if (!vendorId) {
    console.warn("[session] undecodable vendor_id");
    return failWith("vendor_not_found");
  }

  try {
    // Read the prior cookie BEFORE consuming the handover so we can carry
    // forward the user's last location across iframe reloads.
    const oldAuth = await readAuthCookieFromRequest(request);

    const result = await consumeHandoverCode(handoverCode);
    // The handover must be for THIS app's tab (real mode only).
    // TODO(verify): app_slug == the configured tab slug (docs/api-notes.md → #5).
    if (isReal && result.tabCode !== process.env.RDASH_PBE_TAB_CODE) {
      console.error("[session] handover app_slug does not match RDASH_PBE_TAB_CODE", {
        appSlug: result.tabCode,
      });
      return failWith("session_error");
    }
    const userId = toIntString(String(result.user?.id ?? ""));
    // orgId comes ONLY from the handover response (rDash-authenticated). The
    // URL org_id is untrusted: if present it must match, otherwise reject.
    const orgId = toIntString(String(result.org?.id ?? ""));
    if (!orgId) {
      console.error("[session] handover response has no usable org.id");
      return failWith("session_error");
    }
    const rawUrlOrgId = request.nextUrl.searchParams.get("org_id") || "";
    if (rawUrlOrgId && toIntString(rawUrlOrgId) !== orgId) {
      console.warn("[session] URL org_id does not match handover org", {
        urlOrgId: toIntString(rawUrlOrgId) || "(undecodable)",
        handoverOrgId: orgId,
        userId,
      });
      return failWith("org_mismatch");
    }
    const projectId = toIntString(request.nextUrl.searchParams.get("project_id") || "");

    // vendor_id from the URL is untrusted until rDash confirms it is in this
    // org, using the NEW access token (the user's own permissions apply).
    try {
      await assertVendorInOrg(result.accessToken, vendorId);
    } catch (err) {
      if (err instanceof VendorNotFoundError) {
        console.warn("[session] vendor not in org", { vendorId, orgId, userId });
        return failWith("vendor_not_found");
      }
      if (err instanceof RdashPermissionError) {
        console.warn("[session] no permission to list vendors", { vendorId, orgId, userId });
        return failWith("vendor_forbidden");
      }
      throw err;
    }

    // Ids are rDash's own strings — passed through unchanged.
    const encodeOrEmpty = (id: string) => id;
    const defaultRedirect = `${appUrl}/payments?orgId=${encodeOrEmpty(orgId)}&projectId=${encodeOrEmpty(projectId)}&userId=${encodeOrEmpty(userId)}&vendorId=${encodeOrEmpty(vendorId)}`;
    const redirectUrl = nextParam ? `${appUrl}${nextParam}` : defaultRedirect;
    const response = NextResponse.redirect(redirectUrl);

    // Carry the prior `lastPath` forward only if it passes the allow-list
    // and the workspace identity didn't change.
    const preservedLastPath =
      oldAuth &&
      isSafeRestorePath(oldAuth.lastPath) &&
      oldAuth.orgId === orgId &&
      oldAuth.projectId === projectId &&
      oldAuth.userId === userId &&
      oldAuth.vendorId === vendorId
        ? oldAuth.lastPath
        : undefined;

    if (oldAuth?.userId && oldAuth.userId !== userId) {
      console.warn("[session] user changed across handover", {
        oldUserId: oldAuth.userId,
        newUserId: userId,
      });
    }

    // Access token only — no refresh token is kept; the cookie lives until
    // the access token expires, then the iframe re-handovers.
    const now = Math.floor(Date.now() / 1000);
    const authPayload: AuthPayload = {
      accessToken: result.accessToken,
      expiresAt: now + result.expiresIn,
      orgId,
      projectId,
      userId,
      vendorId,
      displayName: result.user?.display_name || "",
      email: result.user?.email ?? null,
      // Verified equal to RDASH_PBE_TAB_CODE above in real mode.
      tabCode: result.tabCode,
      lastPath: preservedLastPath,
    };
    await setAuthCookieAsync(response, authPayload);
    console.log("[session] cookie set, redirecting", {
      redirectUrl,
      userId,
      orgId,
      vendorId,
      ...(await getRequestLogContext()),
    });

    sessionCache.set(cacheKey, redirectUrl);
    setTimeout(() => sessionCache.delete(cacheKey), 5 * 60 * 1000);

    return response;
  } catch (err) {
    // Detailed log server-side; generic message to the browser.
    console.error("[session] Error:", err);
    // Not cached (unchanged behaviour): the failure may have happened before
    // rDash consumed the code.
    return NextResponse.redirect(`${appUrl}/embedded/bootstrap?error=session_error`);
  }
}

// Reject anything that isn't a same-origin path — protects against open-redirect
// abuse via the `next` query param.
function sanitizeNext(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  return value;
}
