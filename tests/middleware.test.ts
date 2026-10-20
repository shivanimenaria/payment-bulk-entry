import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { jwtDecrypt } from "jose";
import { middleware } from "@/middleware";
import { setAuthEnv, makeSessionCookie, TEST_COOKIE_SECRET } from "./helpers";

const FRESH = "x-pbe-auth-fresh";

// NextResponse.next({ request: { headers } }) encodes the headers forwarded to
// the route as x-middleware-override-headers + x-middleware-request-<name>.
function forwarded(res: NextResponse): Headers | null {
  const names = res.headers.get("x-middleware-override-headers");
  if (names === null) return null;
  const out = new Headers();
  for (const n of names.split(",").filter(Boolean)) {
    const v = res.headers.get(`x-middleware-request-${n}`);
    if (v !== null) out.set(n, v);
  }
  return out;
}

function req(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, "http://localhost:3000"), { headers });
}

beforeAll(() => setAuthEnv());

describe("middleware: internal fresh header", () => {
  it("strips a client-supplied header when there is no cookie", async () => {
    const res = await middleware(req("/api/auth/me", { [FRESH]: "spoofed" }));
    const fwd = forwarded(res);
    expect(fwd).not.toBeNull();
    expect(fwd!.has(FRESH)).toBe(false);
  });

  it("strips it on the unchanged-cookie fast path", async () => {
    const cookie = await makeSessionCookie();
    const res = await middleware(req("/api/auth/me", { cookie: `pbe-auth=${cookie}`, [FRESH]: "spoofed" }));
    const fwd = forwarded(res)!;
    expect(fwd.has(FRESH)).toBe(false);
    expect(fwd.get("cookie")).toContain(cookie); // valid cookie still forwarded
  });

  it("replaces a spoofed value with the middleware's own payload on a workspace switch", async () => {
    const cookie = await makeSessionCookie();
    const res = await middleware(
      req("/payments?projectId=99", { cookie: `pbe-auth=${cookie}`, [FRESH]: "spoofed" }),
    );
    const fresh = forwarded(res)!.get(FRESH)!;
    expect(fresh).not.toBe("spoofed");
    const { payload } = await jwtDecrypt(fresh, new Uint8Array(Buffer.from(TEST_COOKIE_SECRET, "hex")));
    expect(payload.projectId).toBe("99");
    expect(payload.userId).toBe("7");
    expect(res.headers.get("set-cookie")).toContain("pbe-auth=");
  });
});

describe("middleware: rejected cookies are not forwarded", () => {
  it("undecryptable cookie: cleared in response, removed from forwarded request, other cookies kept", async () => {
    const res = await middleware(
      req("/api/auth/me", { cookie: "pbe-auth=garbage; other=1", [FRESH]: "spoofed" }),
    );
    expect(res.headers.get("set-cookie")).toMatch(/pbe-auth=; Path=\/; Max-Age=0/);
    const fwd = forwarded(res)!;
    expect(fwd.get("cookie")).toBe("other=1");
    expect(fwd.has(FRESH)).toBe(false);
  });

  it("userId mismatch: cookie cleared and not forwarded", async () => {
    const cookie = await makeSessionCookie({ userId: "7" });
    const res = await middleware(req("/api/auth/me?userId=8", { cookie: `pbe-auth=${cookie}` }));
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect(forwarded(res)!.has("cookie")).toBe(false);
  });

  it("expired access token on a page: cookie cleared and not forwarded", async () => {
    const cookie = await makeSessionCookie({ expiresAt: Math.floor(Date.now() / 1000) - 1 });
    const res = await middleware(req("/payments", { cookie: `pbe-auth=${cookie}` }));
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect(forwarded(res)!.has("cookie")).toBe(false);
  });

  it("expired access token on an API route: 401 session_expired + cookie cleared, handler not reached", async () => {
    const cookie = await makeSessionCookie({ expiresAt: Math.floor(Date.now() / 1000) - 1 });
    const res = await middleware(req("/api/rdash/payment-requests", { cookie: `pbe-auth=${cookie}` }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "session_expired" });
    expect(res.headers.get("set-cookie")).toMatch(/pbe-auth=; Path=\/; Max-Age=0/);
    expect(forwarded(res)).toBeNull();
  });

  it("cookie without expiresAt (old shape) counts as expired", async () => {
    const cookie = await makeSessionCookie({ expiresAt: undefined });
    const res = await middleware(req("/api/auth/me", { cookie: `pbe-auth=${cookie}` }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "session_expired" });
  });

  it("re-issued cookie (project sync) lives until the access token expires", async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const cookie = await makeSessionCookie({ expiresAt: exp, projectId: "22" });
    const res = await middleware(req("/payments?projectId=23", { cookie: `pbe-auth=${cookie}` }));
    const maxAge = Number(/Max-Age=(\d+)/.exec(res.headers.get("set-cookie") || "")?.[1]);
    expect(maxAge).toBeGreaterThan(595);
    expect(maxAge).toBeLessThanOrEqual(600);
  });
});

describe("middleware: COOKIE_SECRET", () => {
  it("throws (no fallback key) when the secret is missing and a cookie is present", async () => {
    const saved = process.env.COOKIE_SECRET;
    delete process.env.COOKIE_SECRET;
    try {
      await expect(middleware(req("/payments", { cookie: "pbe-auth=x" }))).rejects.toThrow(/COOKIE_SECRET/);
    } finally {
      process.env.COOKIE_SECRET = saved;
    }
  });
});
