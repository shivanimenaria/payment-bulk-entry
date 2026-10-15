import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { config } from "@/middleware";

// Every route/page that trusts the internal fresh header (via getAuth,
// getAuthFromCookies or getSessionOrMock) must run behind middleware, which is
// the only thing that strips a client-supplied copy.
const APP_DIR = path.resolve(__dirname, "../src/app");
const AUTH_CALL = /\b(getAuth|getAuthFromCookies|getSessionOrMock)\s*\(/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

function urlPathFor(file: string): string {
  const rel = path.relative(APP_DIR, path.dirname(file)).split(path.sep);
  const segs = rel.filter((s) => s && !/^\(.*\)$/.test(s)); // drop route groups
  return "/" + segs.join("/");
}

// Supports the matcher forms used in middleware.ts: "/a/b" and "/a/:path*".
function matches(matcher: string, urlPath: string): boolean {
  if (matcher.endsWith("/:path*")) {
    const base = matcher.slice(0, -"/:path*".length);
    return urlPath === base || urlPath.startsWith(base + "/");
  }
  return urlPath === matcher;
}

describe("middleware matcher coverage", () => {
  const files = walk(APP_DIR).filter((f) => /\/(route|page)\.tsx?$/.test(f));
  const authed = files.filter((f) => AUTH_CALL.test(fs.readFileSync(f, "utf8")));

  it("finds the authenticated routes (sanity)", () => {
    expect(authed.map(urlPathFor)).toContain("/api/auth/me");
  });

  it.each(authed.map((f) => [urlPathFor(f)]))("%s is covered by the middleware matcher", (urlPath) => {
    const matchers = config.matcher as string[];
    expect(matchers.some((m) => matches(m, urlPath))).toBe(true);
  });

  it("covers the planned /api/rdash proxies and /payments pages", () => {
    const matchers = config.matcher as string[];
    for (const p of ["/api/rdash/vendors", "/api/rdash/payment-entries/bulk", "/payments", "/payments/new"]) {
      expect(matchers.some((m) => matches(m, p))).toBe(true);
    }
  });
});
