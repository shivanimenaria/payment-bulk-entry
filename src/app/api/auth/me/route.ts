import { NextRequest, NextResponse } from "next/server";
import { getSessionOrMock, AuthError, authErrorResponse, COOKIE_NAME } from "@/lib/server/auth";
import { encodeRdashId } from "@/lib/server/rdash-id";
import { safeJson } from "@/lib/server/respond-safe";
import { getDataSource } from "@/lib/server/rdash-source";
import { DedupeCache } from "@/lib/server/dedupe-cache";

// Session-dependent: always render per request, never prerender at build.
export const dynamic = "force-dynamic";

const IS_DEV = process.env.NODE_ENV !== "production";

// In-process dedupe: clients sometimes hammer /api/auth/me (multiple panels,
// visibility-change races, parent-frame nudges). Cache the encoded response
// for 2 s, real mode only. The key is cookie value + URL query, so:
//   - a rotated cookie is a new key (never served the old body), and
//   - a request whose URL carries different workspace/user params (e.g. a
//     userId that doesn't match the cookie) misses the cache and goes through
//     getAuth's checks instead of reusing another request's 200.
// Bounded: expired entries are dropped and the cache is capped.
const DEDUPE_TTL_MS = 2_000;
const DEDUPE_MAX_ENTRIES = 500;
const cache = new DedupeCache<string>(DEDUPE_TTL_MS, DEDUPE_MAX_ENTRIES);

export async function GET(request: NextRequest) {
  try {
    const dataSource = getDataSource();

    const cookieValue = dataSource === "real" ? request.cookies.get(COOKIE_NAME)?.value || "" : "";
    const cacheKey = cookieValue ? `${cookieValue}\n${request.nextUrl.search}` : "";
    if (cacheKey) {
      const body = cache.get(cacheKey);
      if (body !== undefined) {
        return new NextResponse(body, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    const { auth, cookieHeader, mock } = await getSessionOrMock(request);
    // Internal storage form is the decoded integer-string ("498"); the browser
    // only ever sees rDash hashids. Mock IDs are not real rDash IDs, so they
    // are returned as-is.
    const encode = (id: string) => (!id ? "" : mock ? id : encodeRdashId(id));
    const payload = {
      orgId: encode(auth.orgId),
      projectId: encode(auth.projectId),
      userId: encode(auth.userId),
      vendorId: encode(auth.vendorId),
      displayName: auth.displayName,
      dataSource,
    };
    const response = safeJson(payload, { route: "GET /api/auth/me" });
    if (cookieHeader) response.headers.set("Set-Cookie", cookieHeader);
    if (!cookieHeader && cacheKey) {
      cache.set(cacheKey, JSON.stringify(payload));
    }
    return response;
  } catch (err) {
    if (err instanceof AuthError) {
      if (IS_DEV) console.log("[auth-me] 401", { message: err.message });
      return authErrorResponse(err);
    }
    console.error("[auth-me] 500", err);
    return NextResponse.json({ error: "Auth check failed" }, { status: 500 });
  }
}
