import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Any route handler that can trigger a lazy token refresh must be wrapped in
// withAuthCookies, otherwise the rotated cookie is never written (and the
// browser keeps a refresh token rDash has already rotated → replay).
// /api/session only calls assertVendorInOrg, which uses noRefresh.
const REFRESHING_CALLS = /\b(apiFetch|paginateRdash|rdashFetchWithRetry|refreshAuthForRequest|listAllVendors|searchVendors)\s*[(<]/;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return /^route\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("withAuthCookies coverage", () => {
  const files = routeFiles(path.resolve(__dirname, "../src/app"));

  it("finds route files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("every route that can refresh tokens is wrapped in withAuthCookies", () => {
    const unwrapped = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return REFRESHING_CALLS.test(src) && !/withAuthCookies\(/.test(src);
    });
    expect(unwrapped).toEqual([]);
  });
});
