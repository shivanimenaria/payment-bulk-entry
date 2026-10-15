import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { setAuthEnv, makeSessionCookie } from "./helpers";
import { GET as meGET } from "@/app/api/auth/me/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";

beforeAll(() => setAuthEnv());

describe("/api/auth/me and getSessionOrMock", () => {
  beforeEach(() => {
    delete process.env.MOCK_FAIL_IDS;
    delete process.env.PBE_ALLOW_MOCK_IN_PRODUCTION;
  });

  it("mock mode: returns the mock session and logs the bypass", async () => {
    process.env.RDASH_DATA_SOURCE = "mock";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await meGET(new NextRequest("http://localhost/api/auth/me"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ userId: "mock-user", dataSource: "mock" });
    expect(warn.mock.calls.some((c) => c[0] === "[mock] auth bypassed")).toBe(true);
    warn.mockRestore();
  });

  it("real mode: a failed auth is a 401, never the mock session", async () => {
    process.env.RDASH_DATA_SOURCE = "real";
    for (const headers of [{}, { cookie: "pbe-auth=garbage" }] as Record<string, string>[]) {
      const res = await meGET(new NextRequest("http://localhost/api/auth/me", { headers }));
      expect(res.status).toBe(401);
      expect(JSON.stringify(await res.json())).not.toContain("mock");
    }
  });

  it("invalid data-source config: generic 500 without config details", async () => {
    process.env.RDASH_DATA_SOURCE = "real";
    process.env.MOCK_FAIL_IDS = "x";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await meGET(new NextRequest("http://localhost/api/auth/me"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Auth check failed" });
    vi.restoreAllMocks();
  });

  it("dedupe cache does not bypass the userId guard", async () => {
    process.env.RDASH_DATA_SOURCE = "real";
    const cookie = await makeSessionCookie({ userId: "7" });
    const ok = await meGET(new NextRequest("http://localhost/api/auth/me", { headers: { cookie: `pbe-auth=${cookie}` } }));
    expect(ok.status).toBe(200);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mismatch = await meGET(
      new NextRequest("http://localhost/api/auth/me?userId=8", { headers: { cookie: `pbe-auth=${cookie}` } }),
    );
    expect(mismatch.status).toBe(401);
    vi.restoreAllMocks();
  });
});

describe("POST /api/auth/logout CSRF guard", () => {
  beforeAll(() => {
    process.env.APP_URL = "https://pbe.example.com";
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  const post = (headers: Record<string, string>) =>
    logoutPOST(new NextRequest("https://pbe.example.com/api/auth/logout", { method: "POST", headers }));

  it("rejects a cross-site POST without touching the cookie", async () => {
    const res = await post({ "sec-fetch-site": "cross-site", origin: "https://evil.example", cookie: "pbe-auth=x" });
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects a same-origin POST that lacks the PBE request header", async () => {
    const res = await post({ "sec-fetch-site": "same-origin" });
    expect(res.status).toBe(403);
  });

  it("accepts the iframe listener's request and clears both cookie variants", async () => {
    const res = await post({ "sec-fetch-site": "same-origin", "x-pbe-request": "logout" });
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toMatch(/pbe-auth=; Path=\/; Max-Age=0/);
  });
});
