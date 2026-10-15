import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { NextResponse } from "next/server";
import { jwtDecrypt, generateKeyPair, exportPKCS8 } from "jose";
import { setAuthEnv, makeSessionCookie, TEST_COOKIE_SECRET } from "./helpers";

// Request scope (cookies()/headers()) and the session-cache DB are faked; the
// refresh logic, cookie sink and rDash response handling are real.
const { reqCookies, dbQueries } = vi.hoisted(() => ({
  reqCookies: new Map<string, string>(),
  dbQueries: [] as string[],
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (reqCookies.has(name) ? { name, value: reqCookies.get(name)! } : undefined),
    set: () => {
      throw new Error("cookies().set must not be used by the refresh path");
    },
  }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/server/db", () => ({
  withTransaction: async (fn: (c: unknown) => unknown) => fn({}),
  queryWithClient: async (_c: unknown, sql: string) => {
    dbQueries.push(sql);
    return [];
  },
  query: async () => [],
}));

const API = "https://rdash-api.example.com";
const key = () => new Uint8Array(Buffer.from(TEST_COOKIE_SECRET, "hex"));

function tokenResponse(fields: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify({ data: fields }), { status, headers: { "Content-Type": "application/json" } });
}
const FULL = { access_token: "A2", refresh_token: "R2", expires_in: 900, refresh_token_expires_in: 3600 };

let seq = 0;
let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  setAuthEnv();
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  Object.assign(process.env, {
    RDASH_API_URL: API,
    RDASH_CLIENT_ID: "test-client",
    RDASH_CLIENT_KID: "test-kid",
    RDASH_CLIENT_ALG: "RS256",
    RDASH_CLIENT_PRIVATE_KEY_PEM: await exportPKCS8(privateKey), // throwaway, per run
    RDASH_DATA_SOURCE: "real",
  });
});

beforeEach(() => {
  reqCookies.clear();
  dbQueries.length = 0;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  for (const m of ["log", "warn", "error", "info"] as const) vi.spyOn(console, m).mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

// Fresh module graph per test so IS_DEV (read at import) follows NODE_ENV.
async function load(nodeEnv: "production" | "development") {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.resetModules();
  return import("@/lib/server/auth");
}

async function withSessionCookie() {
  // Unique refresh token per test → no in-flight dedupe across tests.
  reqCookies.set("pbe-auth", await makeSessionCookie({ refreshToken: `R1-${++seq}` }));
}

function pbeSetCookies(res: Response): string[] {
  return res.headers.getSetCookie().filter((c) => c.startsWith("pbe-auth="));
}

describe("refresh: cookie is dual-emitted through withAuthCookies", () => {
  it("prod: rotated cookie written Partitioned AND unpartitioned with identical value/attributes", async () => {
    const auth = await load("production");
    await withSessionCookie();
    fetchMock.mockResolvedValue(tokenResponse(FULL));
    const route = auth.withAuthCookies(async () => {
      const outcome = await auth.refreshAuthForRequest();
      expect(outcome.kind).toBe("ok");
      return NextResponse.json({ ok: true });
    });
    const res = await route();
    const cookies = pbeSetCookies(res);
    expect(cookies).toHaveLength(2);
    expect(cookies.filter((c) => /; Partitioned$/.test(c))).toHaveLength(1);
    for (const c of cookies) expect(c).toMatch(/; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=None/);
    const values = cookies.map((c) => /^pbe-auth=([^;]+)/.exec(c)![1]);
    expect(values[0]).toBe(values[1]);
    const { payload } = await jwtDecrypt(values[0], key());
    expect(payload).toMatchObject({ accessToken: "A2", refreshToken: "R2" });
  });

  it("dev: single SameSite=Lax cookie", async () => {
    const auth = await load("development");
    await withSessionCookie();
    fetchMock.mockResolvedValue(tokenResponse(FULL));
    const res = await auth.withAuthCookies(async () => {
      await auth.refreshAuthForRequest();
      return NextResponse.json({});
    })();
    const cookies = pbeSetCookies(res);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(/; HttpOnly; SameSite=Lax$/);
  });

  it("prod: revoked refresh clears both variants", async () => {
    const auth = await load("production");
    await withSessionCookie();
    fetchMock.mockResolvedValue(tokenResponse({}, 401));
    const res = await auth.withAuthCookies(async () => {
      expect((await auth.refreshAuthForRequest()).kind).toBe("revoked");
      return NextResponse.json({});
    })();
    const cookies = pbeSetCookies(res);
    expect(cookies).toHaveLength(2);
    for (const c of cookies) expect(c).toMatch(/^pbe-auth=; Path=\/; Max-Age=0;/);
  });

  it("a route's own single pbe-auth Set-Cookie is replaced by the pair", async () => {
    const auth = await load("production");
    await withSessionCookie();
    fetchMock.mockResolvedValue(tokenResponse(FULL));
    const res = await auth.withAuthCookies(async () => {
      await auth.refreshAuthForRequest();
      const r = NextResponse.json({});
      r.headers.append("Set-Cookie", "pbe-auth=stale; Path=/");
      r.headers.append("Set-Cookie", "other=1; Path=/");
      return r;
    })();
    expect(pbeSetCookies(res)).toHaveLength(2);
    expect(pbeSetCookies(res).some((c) => c.includes("stale"))).toBe(false);
    expect(res.headers.getSetCookie()).toContain("other=1; Path=/");
  });
});

describe("refresh: incomplete rDash response → AuthError, never reuse/default", () => {
  it.each([
    ["refresh_token", { ...FULL, refresh_token: undefined }],
    ["expires_in", { ...FULL, expires_in: undefined }],
    ["refresh_token_expires_in", { ...FULL, refresh_token_expires_in: 0 }],
  ])("missing %s → AuthError, cookie cleared, cache not written", async (_f, body) => {
    const auth = await load("production");
    await withSessionCookie();
    fetchMock.mockResolvedValue(tokenResponse(body));
    let thrown: unknown;
    const res = await auth.withAuthCookies(async () => {
      try {
        await auth.refreshAuthForRequest();
      } catch (err) {
        thrown = err;
      }
      return NextResponse.json({});
    })();
    expect(thrown).toBeInstanceOf(auth.AuthError);
    expect(dbQueries.some((q) => q.includes("INSERT INTO pbe_user_sessions"))).toBe(false);
    const cookies = pbeSetCookies(res);
    expect(cookies).toHaveLength(2);
    for (const c of cookies) expect(c).toMatch(/Max-Age=0/);
  });
});

describe("consumeHandoverCode", () => {
  const handover = (data: Record<string, unknown>) =>
    tokenResponse({
      access_token: "A1",
      refresh_token: "R1",
      expires_in: 900,
      refresh_token_expires_in: 3600,
      user: { id: "u", display_name: "U", email: "u@example.com" },
      org: { id: "o", name: "O", type: "t" },
      app_slug: "pbe",
      ...data,
    });

  it.each(["expires_in", "refresh_token_expires_in"])("missing %s → AuthError", async (field) => {
    const auth = await load("production");
    fetchMock.mockResolvedValue(handover({ [field]: undefined }));
    await expect(auth.consumeHandoverCode("c")).rejects.toBeInstanceOf(auth.AuthError);
  });

  it("missing email → null; missing app_slug → null (no defaults)", async () => {
    const auth = await load("production");
    fetchMock.mockResolvedValue(handover({ user: { id: "u", display_name: "U" }, app_slug: undefined }));
    const r = await auth.consumeHandoverCode("c");
    expect(r.user.email).toBeNull();
    expect(r.tabCode).toBeNull();
    expect(r.expiresIn).toBe(900);
  });
});

describe("generic client errors", () => {
  it("authErrorResponse sends a fixed message; the reason only goes to console.error", async () => {
    const auth = await load("production");
    const res = auth.authErrorResponse(new auth.AuthError("Session vendor mismatch"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not authenticated" });
    expect(vi.mocked(console.error).mock.calls.flat().some((a) => JSON.stringify(a).includes("vendor mismatch"))).toBe(
      true,
    );
  });

  it("rDash error bodies never become the thrown message", async () => {
    vi.resetModules();
    const api = await import("@/lib/server/api");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "internal detail: db host x" }), { status: 500 }),
    );
    const err = (await api.apiFetch("/v2/x", "tok").catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(api.RdashUpstreamError);
    expect(err.message).toBe("rDash request failed");

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: false, message: "detail" }), { status: 200 }));
    const err2 = (await api.apiFetch("/v2/x", "tok").catch((e: unknown) => e)) as Error;
    expect(err2.message).toBe("rDash request failed");
  });
});
