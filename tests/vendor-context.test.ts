import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { jwtDecrypt } from "jose";
import Hashids from "hashids";
import { setAuthEnv, makeSessionCookie, TEST_COOKIE_SECRET, TEST_SALT } from "./helpers";
import {
  buildSessionUrl,
  mergeContextIntoTarget,
  vendorIdFromTarget,
  contextParams,
} from "@/lib/embedded-bootstrap-url";
import { GET as sessionGET } from "@/app/api/session/route";
import { GET as meGET } from "@/app/api/auth/me/route";
import { middleware } from "@/middleware";

// The handover consume and the session-cache DB writes are stubbed; everything
// else in /api/session (decode, org check, vendor verification, cookie) is real.
const { consumeHandoverCode, seedSessionCache, clearSessionCache, refreshAuthForRequest } = vi.hoisted(() => ({
  consumeHandoverCode: vi.fn(),
  seedSessionCache: vi.fn(async () => {}),
  clearSessionCache: vi.fn(async () => {}),
  refreshAuthForRequest: vi.fn(),
}));
vi.mock("@/lib/server/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/auth")>();
  return {
    ...actual,
    consumeHandoverCode: (code: string) => consumeHandoverCode(code),
    seedSessionCache: (...a: unknown[]) => seedSessionCache(...(a as [])),
    clearSessionCache: (...a: unknown[]) => clearSessionCache(...(a as [])),
    refreshAuthForRequest: () => refreshAuthForRequest(),
    getRequestLogContext: async () => ({}),
    getOutboundContextHeaders: async () => ({}),
  };
});

const h = new Hashids(TEST_SALT, 16);
const enc = (n: number) => h.encode(n);
const APP = "https://pbe.example.com";
const API = "https://rdash-api.example.com";

let codeSeq = 0;
const nextCode = () => `code-${++codeSeq}`;

function handoverResult(orgId: number, tabCode: string | null = "pbe") {
  return {
    accessToken: "new-access",
    refreshToken: "new-refresh",
    expiresIn: 900,
    refreshExpiresIn: 3600,
    user: { id: enc(7), display_name: "Test User", email: "t@example.com" },
    org: { id: enc(orgId), name: "Org", type: "x" },
    tabCode,
  };
}

// /v2/vendors stub: one page in rDash's nested envelope, hashid ids.
function vendorsResponse(ids: number[], status = 200) {
  const body =
    status === 200
      ? { success: true, data: { data: ids.map((id) => ({ id: enc(id), name: `V${id}`, code: `C${id}` })) } }
      : { success: false, message: "nope" };
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function sessionReq(params: Record<string, string>, cookie?: string) {
  const qs = new URLSearchParams(params).toString();
  return new NextRequest(`${APP}/api/session?${qs}`, cookie ? { headers: { cookie } } : undefined);
}

function pbeCookie(res: Response): string | null {
  const sc = res.headers.get("set-cookie") || "";
  const m = /pbe-auth=([^;]*)/.exec(sc);
  return m && m[1] ? m[1] : null;
}

async function decryptCookie(value: string) {
  const { payload } = await jwtDecrypt(value, new Uint8Array(Buffer.from(TEST_COOKIE_SECRET, "hex")));
  return payload as Record<string, unknown>;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(() => {
  setAuthEnv();
  Object.assign(process.env, {
    APP_URL: APP,
    RDASH_API_URL: API,
    RDASH_CLIENT_ID: "test-client",
    RDASH_CLIENT_KID: "test-kid",
    RDASH_CLIENT_ALG: "RS256",
    RDASH_CLIENT_PRIVATE_KEY_PEM: "unused-consume-is-stubbed",
    RDASH_DATA_SOURCE: "real",
    RDASH_PBE_TAB_CODE: "pbe",
  });
});

beforeEach(() => {
  process.env.RDASH_DATA_SOURCE = "real";
  consumeHandoverCode.mockReset();
  seedSessionCache.mockClear();
  clearSessionCache.mockClear();
  refreshAuthForRequest.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bootstrap URL → /api/session", () => {
  it("forwards vendor_id from the rDash iframe URL to /api/session and the target", () => {
    const params = new URLSearchParams(`vendor_id=${enc(33)}&org_id=${enc(11)}&user_id=${enc(7)}`);
    const target = mergeContextIntoTarget(null, params);
    const vendor = vendorIdFromTarget(target);
    expect(vendor).toBe(enc(33));
    const url = new URL(buildSessionUrl("abc", target, params, vendor), APP);
    expect(url.pathname).toBe("/api/session");
    expect(url.searchParams.get("vendor_id")).toBe(enc(33));
    expect(url.searchParams.get("org_id")).toBe(enc(11));
    expect(new URL(url.searchParams.get("next")!, APP).searchParams.get("vendor_id")).toBe(enc(33));
  });

  it("merges vendor_id into an explicit next", () => {
    const params = new URLSearchParams(`vendor_id=${enc(33)}&next=/payments/new`);
    const target = mergeContextIntoTarget("/payments/new", params);
    expect(target).toBe(`/payments/new?vendor_id=${enc(33)}`);
  });

  it("401 recovery (force=1): vendor comes from next's camelCase vendorId", () => {
    const next = `/payments?orgId=${enc(11)}&userId=${enc(7)}&vendorId=${enc(33)}`;
    const params = new URLSearchParams({ force: "1", next });
    expect(vendorIdFromTarget(mergeContextIntoTarget(next, params))).toBe(enc(33));
  });

  it("no vendor anywhere → empty (page shows missing_vendor)", () => {
    const params = new URLSearchParams(`org_id=${enc(11)}`);
    expect(vendorIdFromTarget(mergeContextIntoTarget(null, params))).toBe("");
  });

  it("the /api/auth/me probe carries org/user/vendor so middleware can compare", () => {
    const p = contextParams(new URLSearchParams(`orgId=a&user_id=b&vendor_id=c&x=1`));
    expect(p.toString()).toBe("org_id=a&user_id=b&vendor_id=c");
  });
});

describe("/api/session: vendor + org verification", () => {
  it("valid vendor: cookie stores decoded vendorId, /api/auth/me returns it encoded", async () => {
    consumeHandoverCode.mockResolvedValue(handoverResult(11));
    fetchMock.mockResolvedValue(vendorsResponse([5, 33]));

    const res = await sessionGET(
      sessionReq({ handover: nextCode(), vendor_id: enc(33), org_id: enc(11), project_id: enc(22) }),
    );
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/payments");
    expect(location.searchParams.get("vendorId")).toBe(enc(33));
    expect(location.searchParams.get("orgId")).toBe(enc(11));

    // Verified with the NEW token against /v2/vendors.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(new RegExp(`^${API}/v2/vendors\\?limit=200&offset=0$`));
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer new-access" });

    const cookie = pbeCookie(res)!;
    expect(cookie).toBeTruthy();
    const payload = await decryptCookie(cookie);
    expect(payload).toMatchObject({ vendorId: "33", orgId: "11", projectId: "22", userId: "7" });
    expect(seedSessionCache).toHaveBeenCalledTimes(1);

    const me = await meGET(new NextRequest(`${APP}/api/auth/me`, { headers: { cookie: `pbe-auth=${cookie}` } }));
    expect(me.status).toBe(200);
    const body = await me.json();
    expect(body.vendorId).toBe(enc(33));
    expect(JSON.stringify(body)).not.toContain("new-access");
    expect(JSON.stringify(body)).not.toContain("new-refresh");
  });

  it("org_id absent from the URL: orgId taken from the handover", async () => {
    consumeHandoverCode.mockResolvedValue(handoverResult(11));
    fetchMock.mockResolvedValue(vendorsResponse([33]));
    const res = await sessionGET(sessionReq({ handover: nextCode(), vendor_id: enc(33) }));
    expect((await decryptCookie(pbeCookie(res)!)).orgId).toBe("11");
  });

  it("missing vendor_id → error=missing_vendor, no cookie, handover not consumed", async () => {
    const res = await sessionGET(sessionReq({ handover: nextCode(), org_id: enc(11) }));
    expect(res.headers.get("location")).toBe(`${APP}/embedded/bootstrap?error=missing_vendor`);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(consumeHandoverCode).not.toHaveBeenCalled();
  });

  it("vendor not in org → error=vendor_not_found, no cookie, no session seeded", async () => {
    consumeHandoverCode.mockResolvedValue(handoverResult(11));
    fetchMock.mockResolvedValue(vendorsResponse([5, 6]));
    const res = await sessionGET(sessionReq({ handover: nextCode(), vendor_id: enc(33), org_id: enc(11) }));
    expect(res.headers.get("location")).toBe(`${APP}/embedded/bootstrap?error=vendor_not_found`);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(seedSessionCache).not.toHaveBeenCalled();
  });

  it("undecodable vendor_id → error=vendor_not_found before consuming", async () => {
    const res = await sessionGET(sessionReq({ handover: nextCode(), vendor_id: "not-a-hashid!" }));
    expect(res.headers.get("location")).toBe(`${APP}/embedded/bootstrap?error=vendor_not_found`);
    expect(consumeHandoverCode).not.toHaveBeenCalled();
  });

  it("rDash 403 on /v2/vendors → vendor_forbidden (permission error, not 'not found')", async () => {
    consumeHandoverCode.mockResolvedValue(handoverResult(11));
    fetchMock.mockResolvedValue(vendorsResponse([], 403));
    const res = await sessionGET(sessionReq({ handover: nextCode(), vendor_id: enc(33) }));
    expect(res.headers.get("location")).toBe(`${APP}/embedded/bootstrap?error=vendor_forbidden`);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rDash 401 on /v2/vendors → session_error, never refreshes the previous cookie's session", async () => {
    consumeHandoverCode.mockResolvedValue(handoverResult(11));
    fetchMock.mockResolvedValue(vendorsResponse([], 401));
    const oldCookie = await makeSessionCookie({ userId: "8" });
    const res = await sessionGET(
      sessionReq({ handover: nextCode(), vendor_id: enc(33) }, `pbe-auth=${oldCookie}`),
    );
    expect(res.headers.get("location")).toBe(`${APP}/embedded/bootstrap?error=session_error`);
    expect(refreshAuthForRequest).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("URL org_id ≠ handover org.id → error=org_mismatch, no cookie, vendor not checked", async () => {
    consumeHandoverCode.mockResolvedValue(handoverResult(11));
    const res = await sessionGET(sessionReq({ handover: nextCode(), vendor_id: enc(33), org_id: enc(12) }));
    expect(res.headers.get("location")).toBe(`${APP}/embedded/bootstrap?error=org_mismatch`);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lastPath is preserved only when the vendor is unchanged", async () => {
    consumeHandoverCode.mockResolvedValue(handoverResult(11));
    fetchMock.mockImplementation(async () => vendorsResponse([33, 34]));
    const old = await makeSessionCookie({ orgId: "11", projectId: "", vendorId: "33", lastPath: "/payments/new" });

    const same = await sessionGET(sessionReq({ handover: nextCode(), vendor_id: enc(33) }, `pbe-auth=${old}`));
    expect((await decryptCookie(pbeCookie(same)!)).lastPath).toBe("/payments/new");

    const other = await sessionGET(sessionReq({ handover: nextCode(), vendor_id: enc(34) }, `pbe-auth=${old}`));
    expect((await decryptCookie(pbeCookie(other)!)).lastPath).toBeUndefined();
  });
});

describe("/api/session: app_slug, response shape, id decoding", () => {
  it.each([
    ["different", "other-app"],
    ["missing", null],
  ])("real mode: %s app_slug → session_error, no cookie, vendor not checked", async (_l, slug) => {
    consumeHandoverCode.mockResolvedValue(handoverResult(11, slug));
    const res = await sessionGET(sessionReq({ handover: nextCode(), vendor_id: enc(33) }));
    expect(res.headers.get("location")).toBe(`${APP}/embedded/bootstrap?error=session_error`);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("real mode: RDASH_PBE_TAB_CODE unset → config error (500), handover not consumed", async () => {
    const saved = process.env.RDASH_PBE_TAB_CODE;
    delete process.env.RDASH_PBE_TAB_CODE;
    try {
      const res = await sessionGET(sessionReq({ handover: nextCode(), vendor_id: enc(33) }));
      expect(res.status).toBe(500);
      expect(consumeHandoverCode).not.toHaveBeenCalled();
    } finally {
      process.env.RDASH_PBE_TAB_CODE = saved;
    }
  });

  it("mock mode: app_slug check skipped", async () => {
    process.env.RDASH_DATA_SOURCE = "mock";
    consumeHandoverCode.mockResolvedValue(handoverResult(11, null));
    fetchMock.mockResolvedValue(vendorsResponse([33]));
    const res = await sessionGET(sessionReq({ handover: nextCode(), vendor_id: enc(33) }));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/payments");
    expect(pbeCookie(res)).toBeTruthy();
  });

  it("email absent from the handover → stored as null, no error", async () => {
    const r = handoverResult(11);
    consumeHandoverCode.mockResolvedValue({ ...r, user: { ...r.user, email: null } });
    fetchMock.mockResolvedValue(vendorsResponse([33]));
    const res = await sessionGET(sessionReq({ handover: nextCode(), vendor_id: enc(33) }));
    expect((await decryptCookie(pbeCookie(res)!)).email).toBeNull();
  });

  it("unexpected /v2/vendors shape → session_error, not vendor_not_found", async () => {
    consumeHandoverCode.mockResolvedValue(handoverResult(11));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { items: [{ id: enc(33) }] } }), { status: 200 }),
    );
    const res = await sessionGET(sessionReq({ handover: nextCode(), vendor_id: enc(33) }));
    expect(res.headers.get("location")).toBe(`${APP}/embedded/bootstrap?error=session_error`);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("undecodable vendor id in /v2/vendors → session_error (raw id never kept)", async () => {
    consumeHandoverCode.mockResolvedValue(handoverResult(11));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: [{ id: "33", name: "V", code: "C" }] }), { status: 200 }),
    );
    const res = await sessionGET(sessionReq({ handover: nextCode(), vendor_id: enc(33) }));
    expect(res.headers.get("location")).toBe(`${APP}/embedded/bootstrap?error=session_error`);
  });
});

describe("middleware: org / vendor from the URL are never trusted", () => {
  const mw = (path: string, cookie: string) =>
    middleware(new NextRequest(new URL(path, "http://localhost:3000"), { headers: { cookie: `pbe-auth=${cookie}` } }));

  it.each([
    ["orgId (hashid)", () => `/payments?orgId=${enc(12)}`],
    ["org_id (integer)", () => `/api/auth/me?org_id=12`],
    ["vendorId (hashid)", () => `/payments?vendorId=${enc(34)}`],
    ["vendor_id (hashid)", () => `/api/rdash/x?vendor_id=${enc(34)}`],
  ])("%s differing from the cookie clears it", async (_label, path) => {
    const cookie = await makeSessionCookie({ orgId: "11", vendorId: "33" });
    const res = await mw(path(), cookie);
    expect(res.headers.get("set-cookie")).toMatch(/pbe-auth=; Path=\/; Max-Age=0/);
    expect(res.headers.get("x-middleware-request-cookie")).toBeNull();
  });

  it("a pre-vendor cookie opened with a vendor is cleared", async () => {
    const cookie = await makeSessionCookie({ vendorId: undefined });
    const res = await mw(`/payments?vendor_id=${enc(33)}`, cookie);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });

  it("matching org + vendor keeps the cookie untouched", async () => {
    const cookie = await makeSessionCookie({ orgId: "11", vendorId: "33", projectId: "22" });
    const res = await mw(`/api/auth/me?orgId=${enc(11)}&vendorId=${enc(33)}&projectId=${enc(22)}`, cookie);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("project switch still rewrites projectId only", async () => {
    const cookie = await makeSessionCookie({ orgId: "11", vendorId: "33", projectId: "22" });
    const res = await mw(`/api/auth/me?orgId=${enc(11)}&vendorId=${enc(33)}&projectId=${enc(99)}`, cookie);
    const set = /pbe-auth=([^;]+)/.exec(res.headers.get("set-cookie") || "")![1];
    expect(await decryptCookie(set)).toMatchObject({ projectId: "99", orgId: "11", vendorId: "33" });
  });
});

describe("getAuth: vendor bound to the session", () => {
  const me = (path: string, cookie: string) =>
    meGET(new NextRequest(`${APP}${path}`, { headers: { cookie: `pbe-auth=${cookie}` } }));

  it("URL vendor differing from the session → 401", async () => {
    const cookie = await makeSessionCookie({ vendorId: "33" });
    expect((await me(`/api/auth/me?vendor_id=${enc(34)}`, cookie)).status).toBe(401);
  });

  it.each([
    ["orgId (hashid)", () => `/api/auth/me?orgId=${enc(12)}`],
    ["org_id (integer)", () => `/api/auth/me?org_id=12`],
  ])("URL %s differing from the session → 401 with a fixed message", async (_l, path) => {
    const cookie = await makeSessionCookie({ orgId: "11", vendorId: "33" });
    const res = await me(path(), cookie);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not authenticated" });
  });

  it("matching URL org → 200", async () => {
    const cookie = await makeSessionCookie({ orgId: "11", vendorId: "33" });
    expect((await me(`/api/auth/me?orgId=${enc(11)}`, cookie)).status).toBe(200);
  });

  it("session without a vendor → 401 (re-handover), no default vendor", async () => {
    const cookie = await makeSessionCookie({ vendorId: undefined });
    expect((await me(`/api/auth/me`, cookie)).status).toBe(401);
  });
});
