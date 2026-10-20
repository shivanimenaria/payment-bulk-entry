import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { exportPKCS8, generateKeyPair } from "jose";
import { setAuthEnv, makeSessionCookie } from "./helpers";
import { GET as requestsGET } from "@/app/api/rdash/payment-requests/route";
import { GET as projectsGET } from "@/app/api/rdash/projects/route";
import { POST as bulkPOST } from "@/app/api/rdash/payment-entries/bulk/route";
import { GET as meGET } from "@/app/api/auth/me/route";
import { consumeHandoverCode, AuthError } from "@/lib/server/auth";
import { clearProjectsCache } from "@/lib/server/rdash-source/real";
import { validateRuntimeConfig } from "@/lib/runtime-config";

// Session expiry without refresh (option A): an expired access token or an
// rDash 401 ends the session → 401 { error: "session_expired" } + cookie
// cleared; the browser re-handovers. Nothing is ever refreshed or retried.

const APP = "https://pbe.example.com";
const API = "https://rdash-api.example.com";
const CONFIG_PATH = "/v2/vendor-payment-requests/config/";
const BULK_PATH = "/v2/vendor-payment-requests/payment-entries/bulk/";
const TOKEN_PATH = "/api/v1/auth/token/";

const INR = { id: "c1", name: "Indian National Rupee", symbol: "₹", code: "INR", locale: "en-IN" };
const CONFIG = [
  { payment_request_id: "PR1", status: "approved", request_amount: "1000", paid_amount: "0", payment_due: "1000", currency: INR, project_id: "PJ1" },
];
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 });
const unauthorized = () => new Response(JSON.stringify({ detail: "Token has expired" }), { status: 401 });

let fetchMock: ReturnType<typeof vi.fn>;
const paths = () => fetchMock.mock.calls.map((c) => new URL(String(c[0])).pathname);

async function cookieHeader(overrides: Record<string, unknown> = {}) {
  return `pbe-auth=${await makeSessionCookie({ vendorId: "33", ...overrides })}`;
}
const expired = () => cookieHeader({ expiresAt: Math.floor(Date.now() / 1000) - 5 });

function get(handler: (r: NextRequest) => Promise<Response>, p: string, cookie: string) {
  return handler(new NextRequest(`${APP}${p}`, { headers: { cookie } }));
}
function postBulk(cookie: string) {
  return bulkPOST(
    new NextRequest(`${APP}/api/rdash/payment-entries/bulk`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        header: { amountPaid: "100", paymentDate: "2026-10-15", paymentMode: "bank_transfer", reference: "UTR-1", remark: "" },
        rows: [{ payment_request_id: "PR1", amount: "100", remark: "" }],
      }),
    }),
  );
}

async function expectSessionExpired(res: Response) {
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "session_expired" });
  expect(res.headers.get("set-cookie")).toMatch(/pbe-auth=; Path=\/; Max-Age=0/);
}

beforeAll(() => {
  setAuthEnv();
  process.env.RDASH_API_URL = API;
});

beforeEach(() => {
  process.env.RDASH_DATA_SOURCE = "real";
  clearProjectsCache();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("expired access token (cookie clock)", () => {
  it.each([
    ["GET /api/rdash/payment-requests", (c: string) => get(requestsGET, "/api/rdash/payment-requests", c)],
    ["GET /api/rdash/projects", (c: string) => get(projectsGET, "/api/rdash/projects", c)],
    ["POST /api/rdash/payment-entries/bulk", (c: string) => postBulk(c)],
    ["GET /api/auth/me", (c: string) => get(meGET, "/api/auth/me", c)],
  ])("%s → 401 session_expired, cookie cleared, no rDash call", async (_name, call) => {
    await expectSessionExpired(await call(await expired()));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("rDash 401 → session_expired, never retried, never refreshed", () => {
  it("config 401 on the table load: one rDash call, no retry", async () => {
    fetchMock.mockImplementation(async () => unauthorized());
    await expectSessionExpired(await get(requestsGET, "/api/rdash/payment-requests", await cookieHeader()));
    expect(paths()).toEqual([CONFIG_PATH]);
  });

  it("projects 401: one rDash call, no retry", async () => {
    fetchMock.mockImplementation(async () => unauthorized());
    await expectSessionExpired(await get(projectsGET, "/api/rdash/projects", await cookieHeader()));
    expect(paths()).toEqual(["/v2/projects"]);
  });

  it("bulk: config 401 → the bulk API is never called", async () => {
    fetchMock.mockImplementation(async () => unauthorized());
    await expectSessionExpired(await postBulk(await cookieHeader()));
    expect(paths()).toEqual([CONFIG_PATH]);
  });

  it("bulk POST 401 → session_expired; the POST is sent exactly once (not re-sent)", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const p = new URL(url).pathname;
      if (p === CONFIG_PATH) return ok({ count: CONFIG.length, next: null, previous: null, results: CONFIG });
      return unauthorized();
    });
    await expectSessionExpired(await postBulk(await cookieHeader()));
    expect(paths().filter((p) => p === BULK_PATH)).toHaveLength(1);
  });

  it("the refresh endpoint is never called", async () => {
    fetchMock.mockImplementation(async () => unauthorized());
    const c = await cookieHeader();
    await get(requestsGET, "/api/rdash/payment-requests", c);
    await get(projectsGET, "/api/rdash/projects", c);
    await postBulk(c);
    expect(fetchMock).toHaveBeenCalled();
    expect(paths()).not.toContain(TOKEN_PATH);
  });

  it("a non-expiry auth failure keeps the generic message", async () => {
    const res = await get(requestsGET, "/api/rdash/payment-requests", "other=1");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not authenticated" });
  });
});

describe("handover consume (no refresh token)", () => {
  beforeAll(async () => {
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    Object.assign(process.env, {
      RDASH_CLIENT_ID: "test-client",
      RDASH_CLIENT_KID: "test-kid",
      RDASH_CLIENT_ALG: "RS256",
      RDASH_CLIENT_PRIVATE_KEY_PEM: await exportPKCS8(privateKey),
    });
  });
  const consumeBody = (extra: Record<string, unknown>) =>
    new Response(
      JSON.stringify({
        access_token: "A1",
        user: { id: "u", display_name: "U" },
        org: { id: "o", name: "O", type: "t" },
        app_slug: "pbe",
        ...extra,
      }),
      { status: 200 },
    );

  it("succeeds without refresh_token / refresh_token_expires_in and returns no refresh token", async () => {
    fetchMock.mockResolvedValue(consumeBody({ expires_in: 900 }));
    const r = await consumeHandoverCode("code-1");
    expect(r).toMatchObject({ accessToken: "A1", expiresIn: 900 });
    expect(r).not.toHaveProperty("refreshToken");
  });

  it("missing expires_in → AuthError (lifetime never defaulted)", async () => {
    fetchMock.mockResolvedValue(consumeBody({ refresh_token: "R1", refresh_token_expires_in: 3600 }));
    await expect(consumeHandoverCode("code-2")).rejects.toBeInstanceOf(AuthError);
  });
});

describe("no database", () => {
  const SRC = path.resolve(__dirname, "../src");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
    });

  it("real mode starts without DATABASE_URL", () => {
    const env = {
      NODE_ENV: "production",
      COOKIE_SECRET: process.env.COOKIE_SECRET,
      RDASH_DATA_SOURCE: "real",
      RDASH_PBE_TAB_CODE: "pbe",
    };
    expect(validateRuntimeConfig(env)).toBe("real");
  });

  it("no source references a database, pg, or the refresh endpoint", () => {
    for (const f of files(SRC)) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/DATABASE_URL|from "pg"|\/api\/v1\/auth\/token\/|refreshAuthForRequest|refreshToken/);
    }
  });

  it("package.json has no pg dependency", () => {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty("pg");
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty("@types/pg");
  });
});
