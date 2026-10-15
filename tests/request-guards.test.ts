import { describe, it, expect } from "vitest";
import { checkSameOriginRequest } from "@/lib/server/request-guards";

const APP_URL = "https://pbe.example.com";
const h = (init: Record<string, string>) => new Headers(init);

describe("checkSameOriginRequest (logout CSRF guard)", () => {
  it("accepts the PBE iframe's same-origin fetch", () => {
    expect(checkSameOriginRequest(h({ "x-pbe-request": "logout", "sec-fetch-site": "same-origin" }), "logout", APP_URL)).toEqual({ ok: true });
  });

  it("accepts older browsers without Sec-Fetch-Site when Origin matches APP_URL", () => {
    expect(checkSameOriginRequest(h({ "x-pbe-request": "logout", origin: APP_URL }), "logout", APP_URL)).toEqual({ ok: true });
  });

  it("rejects requests without the custom header (e.g. cross-site form POST)", () => {
    expect(checkSameOriginRequest(h({ "sec-fetch-site": "same-origin" }), "logout", APP_URL).ok).toBe(false);
    expect(checkSameOriginRequest(h({ "x-pbe-request": "other", "sec-fetch-site": "same-origin" }), "logout", APP_URL).ok).toBe(false);
  });

  it("rejects cross-site and same-site requests even with the header", () => {
    for (const site of ["cross-site", "same-site", "none"]) {
      expect(checkSameOriginRequest(h({ "x-pbe-request": "logout", "sec-fetch-site": site }), "logout", APP_URL).ok).toBe(false);
    }
  });

  it("rejects a mismatched Origin, and fails closed without any provenance header or APP_URL", () => {
    expect(checkSameOriginRequest(h({ "x-pbe-request": "logout", origin: "https://evil.example" }), "logout", APP_URL).ok).toBe(false);
    expect(checkSameOriginRequest(h({ "x-pbe-request": "logout" }), "logout", APP_URL).ok).toBe(false);
    expect(checkSameOriginRequest(h({ "x-pbe-request": "logout", origin: APP_URL }), "logout", undefined).ok).toBe(false);
  });
});
