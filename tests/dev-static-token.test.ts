import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { setAuthEnv } from "./helpers";
import { resolveAuthMode, validateRuntimeConfig } from "@/lib/runtime-config";
import { GET as meGET } from "@/app/api/auth/me/route";
import { GET as requestsGET } from "@/app/api/rdash/payment-requests/route";
import { POST as bulkPOST } from "@/app/api/rdash/payment-entries/bulk/route";

// DEV-only RDASH_AUTH_MODE=static_token. The token below is a throwaway test
// value — never a real one.
const API = "https://rdash-api.example.com";
const APP = "https://pbe.example.com";
const TOKEN = "test-dev-token-not-real";
const VENDOR = "VNDrDashOwnHash1"; // rDash's own hashid — must pass through as-is
const DEV_ENV = {
  RDASH_AUTH_MODE: "static_token",
  RDASH_DATA_SOURCE: "real",
  RDASH_DEV_API_TOKEN: TOKEN,
  RDASH_DEV_AUTH_SCHEME: "Bearer",
  RDASH_DEV_VENDOR_ID: VENDOR,
  RDASH_API_URL: API,
};
const INR = { id: "c", name: "Indian National Rupee", symbol: "₹", code: "INR", locale: "en-IN" };
const ITEM = { payment_request_id: "PRhashRaw0000001", project_id: "PJhashRaw0000001", status: "approved", request_amount: "100.0000", paid_amount: "0", payment_due: "100.0000", currency: INR };
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, code: 200, message: "", errors: null, data }), { status: 200 });

describe("startup rules (runtime-config)", () => {
  const COOKIE_SECRET = "a".repeat(64);
  it("refused with NODE_ENV=production", () => {
    expect(() => validateRuntimeConfig({ ...DEV_ENV, COOKIE_SECRET, NODE_ENV: "production" })).toThrow(/dev-only/);
  });
  it.each(["RDASH_DEV_API_TOKEN", "RDASH_DEV_AUTH_SCHEME", "RDASH_DEV_VENDOR_ID", "RDASH_API_URL"])(
    "missing %s → startup error (no defaults)",
    (k) => {
      const env: Record<string, string | undefined> = { ...DEV_ENV, COOKIE_SECRET, NODE_ENV: "development" };
      delete env[k];
      expect(() => validateRuntimeConfig(env)).toThrow(new RegExp(k));
    },
  );
  it("requires RDASH_DATA_SOURCE=real; flag values are strict; RDASH_DEV_* without static mode → error", () => {
    expect(() => resolveAuthMode({ ...DEV_ENV, RDASH_DATA_SOURCE: "mock" })).toThrow(/RDASH_DATA_SOURCE=real/);
    expect(() => resolveAuthMode({ ...DEV_ENV, RDASH_DEV_ALLOW_WRITES: "yes" })).toThrow(/RDASH_DEV_ALLOW_WRITES/);
    expect(() => resolveAuthMode({ ...DEV_ENV, RDASH_AUTH_MODE: "token" })).toThrow(/RDASH_AUTH_MODE/);
    expect(() => resolveAuthMode({ RDASH_DEV_API_TOKEN: "x" })).toThrow(/must not be set/);
    expect(() => resolveAuthMode({ ...DEV_ENV, RDASH_DEV_AUTH_SCHEME: "Bearer x" })).toThrow(/single word/);
  });
  it("valid dev config starts; tab code / handover vars are not required", () => {
    expect(validateRuntimeConfig({ ...DEV_ENV, COOKIE_SECRET, NODE_ENV: "development" })).toBe("real");
    expect(resolveAuthMode({})).toBe("handover");
  });
});

describe("routes in static-token mode", () => {
  const saved: Record<string, string | undefined> = {};
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeAll(() => {
    setAuthEnv();
    for (const k of [...Object.keys(DEV_ENV), "RDASH_DEV_ALLOW_WRITES"]) saved[k] = process.env[k];
  });
  beforeEach(() => {
    Object.assign(process.env, DEV_ENV);
    delete process.env.RDASH_DEV_ALLOW_WRITES;
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const m of ["log", "warn", "error", "info"] as const) vi.spyOn(console, m).mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const req = (path: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`${APP}${path}`, init);

  it("no cookie needed; /api/auth/me returns the dev vendor as given + authMode, never the token", async () => {
    const res = await meGET(req("/api/auth/me"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ vendorId: VENDOR, dataSource: "real", authMode: "static_token" });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("ids pass through unchanged; static token + scheme in the Authorization header", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const u = new URL(url);
      if (u.pathname === "/v2/vendor-payment-requests/config/") return ok({ count: 1, next: null, previous: null, results: [ITEM] });
      if (u.pathname === "/v2/projects") return ok([{ id: ITEM.project_id, job_id: "J", name: "Tower", created_at: "", is_archived: false, is_deleted: false }]);
      return ok({ id: ITEM.payment_request_id, requested_by: { id: "u", name: "A" } });
    });
    const res = await requestsGET(req("/api/rdash/payment-requests"));
    expect(res.status).toBe(200);
    const urls = fetchMock.mock.calls.map((c) => new URL(c[0]));
    const config = urls.find((u) => u.pathname === "/v2/vendor-payment-requests/config/")!;
    expect(config.searchParams.get("vendor_id")).toBe(VENDOR); // NOT PBE-salt encoded
    expect(urls.some((u) => u.pathname === `/v2/projects/${ITEM.project_id}/vendor-payment-requests/${ITEM.payment_request_id}`)).toBe(true);
    for (const c of fetchMock.mock.calls) expect(c[1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("uses RDASH_DEV_AUTH_SCHEME as given", async () => {
    process.env.RDASH_DEV_AUTH_SCHEME = "Token";
    fetchMock.mockResolvedValue(ok({ count: 0, next: null, previous: null, results: [] }));
    await requestsGET(req("/api/rdash/payment-requests"));
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Token ${TOKEN}`);
  });

  it("rDash 401 → no refresh, one call only, 'dev token' error (not a 401 that would start a handover); token not logged", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 401 }));
    const res = await requestsGET(req("/api/rdash/payment-requests"));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/Dev token rejected/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify([...vi.mocked(console.warn).mock.calls, ...vi.mocked(console.error).mock.calls]);
    expect(logged).not.toContain(TOKEN);
  });

  const bulkBody = JSON.stringify({
    header: { amountPaid: "100", paymentDate: "2026-10-16", paymentMode: "upi", reference: "", remark: "" },
    rows: [{ payment_request_id: ITEM.payment_request_id, amount: "100", remark: null }],
  });

  it("writes blocked without RDASH_DEV_ALLOW_WRITES → 403, rDash never called", async () => {
    const res = await bulkPOST(req("/api/rdash/payment-entries/bulk", { method: "POST", body: bulkBody }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Writes disabled in dev static-token mode" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("with RDASH_DEV_ALLOW_WRITES=true the bulk call goes out with the raw ids", async () => {
    process.env.RDASH_DEV_ALLOW_WRITES = "true";
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      if (u.pathname === "/v2/vendor-payment-requests/config/") return ok({ count: 1, next: null, previous: null, results: [ITEM] });
      if (init?.method === "POST") return ok({ count: 1, created: [{ id: "E1", payment_request_id: ITEM.payment_request_id }], failed: [] });
      return new Response("unexpected", { status: 404 });
    });
    const res = await bulkPOST(req("/api/rdash/payment-entries/bulk", { method: "POST", body: bulkBody }));
    expect(res.status).toBe(200);
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST")!;
    expect(JSON.parse(post[1].body).entries[0]).toMatchObject({ payment_request_id: ITEM.payment_request_id, amount: 100 });
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("vendor_id")).toBe(VENDOR);
  });
});
