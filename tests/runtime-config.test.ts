import { describe, it, expect, afterEach } from "vitest";
import {
  parseCookieSecret,
  getCookieSecretKey,
  resolveDataSource,
  resolveTempProjectId,
  validateRuntimeConfig,
} from "@/lib/runtime-config";

const VALID = "ab".repeat(32);

describe("COOKIE_SECRET", () => {
  const original = process.env.COOKIE_SECRET;
  afterEach(() => {
    process.env.COOKIE_SECRET = original;
  });

  it("rejects missing, short, long and non-hex secrets (no fallback key)", () => {
    for (const bad of [undefined, "", "abc", "0".repeat(63), "0".repeat(65), "z".repeat(64)]) {
      expect(() => parseCookieSecret(bad)).toThrow(/COOKIE_SECRET/);
    }
  });

  it("parses a valid 64-hex secret into 32 bytes", () => {
    const key = parseCookieSecret(VALID);
    expect(key).toHaveLength(32);
    expect(Array.from(key).every((b) => b === 0xab)).toBe(true);
  });

  it("getCookieSecretKey reads env, throws when unset, and follows env changes", () => {
    delete process.env.COOKIE_SECRET;
    expect(() => getCookieSecretKey()).toThrow(/COOKIE_SECRET/);
    process.env.COOKIE_SECRET = VALID;
    expect(getCookieSecretKey()[0]).toBe(0xab);
    process.env.COOKIE_SECRET = "cd".repeat(32);
    expect(getCookieSecretKey()[0]).toBe(0xcd);
  });

  it("error messages never include the secret value", () => {
    try {
      parseCookieSecret("deadbeef");
    } catch (e) {
      expect(String(e)).not.toContain("deadbeef");
    }
  });
});

describe("resolveDataSource (mock auth + mock data switch)", () => {
  it("requires an explicit valid value", () => {
    expect(() => resolveDataSource({})).toThrow(/RDASH_DATA_SOURCE/);
    expect(() => resolveDataSource({ RDASH_DATA_SOURCE: "Mock" })).toThrow(/RDASH_DATA_SOURCE/);
  });

  it("real is always allowed", () => {
    expect(resolveDataSource({ RDASH_DATA_SOURCE: "real", NODE_ENV: "production" })).toBe("real");
  });

  it("mock is allowed outside production", () => {
    expect(resolveDataSource({ RDASH_DATA_SOURCE: "mock", NODE_ENV: "development" })).toBe("mock");
    expect(resolveDataSource({ RDASH_DATA_SOURCE: "mock", NODE_ENV: "test" })).toBe("mock");
  });

  it("mock in production requires the explicit opt-in", () => {
    expect(() => resolveDataSource({ RDASH_DATA_SOURCE: "mock", NODE_ENV: "production" })).toThrow(
      /PBE_ALLOW_MOCK_IN_PRODUCTION/,
    );
    expect(
      resolveDataSource({ RDASH_DATA_SOURCE: "mock", NODE_ENV: "production", PBE_ALLOW_MOCK_IN_PRODUCTION: "true" }),
    ).toBe("mock");
  });

  it("fails closed on unintended combinations", () => {
    expect(() =>
      resolveDataSource({ RDASH_DATA_SOURCE: "mock", NODE_ENV: "production", PBE_ALLOW_MOCK_IN_PRODUCTION: "1" }),
    ).toThrow(/PBE_ALLOW_MOCK_IN_PRODUCTION/);
    expect(() => resolveDataSource({ RDASH_DATA_SOURCE: "real", PBE_ALLOW_MOCK_IN_PRODUCTION: "true" })).toThrow(
      /must not be set/,
    );
    expect(() => resolveDataSource({ RDASH_DATA_SOURCE: "real", MOCK_FAIL_IDS: "abc" })).toThrow(/MOCK_FAIL_IDS/);
  });

  it("treats empty optional values (as in .env.example) as unset", () => {
    expect(resolveDataSource({ RDASH_DATA_SOURCE: "real", PBE_ALLOW_MOCK_IN_PRODUCTION: "", MOCK_FAIL_IDS: "" })).toBe("real");
    expect(() =>
      resolveDataSource({ RDASH_DATA_SOURCE: "mock", NODE_ENV: "production", PBE_ALLOW_MOCK_IN_PRODUCTION: "" }),
    ).toThrow(/PBE_ALLOW_MOCK_IN_PRODUCTION/);
  });

  it("validateRuntimeConfig checks the secret and the data source", () => {
    expect(() => validateRuntimeConfig({ RDASH_DATA_SOURCE: "real" })).toThrow(/COOKIE_SECRET/);
    expect(
      validateRuntimeConfig({ RDASH_DATA_SOURCE: "real", COOKIE_SECRET: VALID, RDASH_PBE_TAB_CODE: "pbe" }),
    ).toBe("real");
  });

  it("RDASH_PBE_TAB_CODE is required in real mode only", () => {
    expect(() => validateRuntimeConfig({ RDASH_DATA_SOURCE: "real", COOKIE_SECRET: VALID })).toThrow(
      /RDASH_PBE_TAB_CODE/,
    );
    expect(validateRuntimeConfig({ RDASH_DATA_SOURCE: "mock", COOKIE_SECRET: VALID, NODE_ENV: "development" })).toBe(
      "mock",
    );
  });

  describe("RDASH_TEMP_PROJECT_ID (TODO(remove-temp-project-id))", () => {
    const base = { RDASH_DATA_SOURCE: "real", COOKIE_SECRET: VALID, RDASH_PBE_TAB_CODE: "pbe" };

    it("unset → off", () => {
      expect(resolveTempProjectId({})).toBeNull();
    });

    it("allowed outside production", () => {
      expect(resolveTempProjectId({ RDASH_TEMP_PROJECT_ID: "pHASH", NODE_ENV: "development" })).toBe("pHASH");
    });

    it("production without ALLOW_TEMP_PROJECT_ID=true → startup error", () => {
      expect(() => validateRuntimeConfig({ ...base, NODE_ENV: "production", RDASH_TEMP_PROJECT_ID: "pHASH" })).toThrow(
        /RDASH_TEMP_PROJECT_ID is not allowed with NODE_ENV=production/,
      );
      expect(
        validateRuntimeConfig({ ...base, NODE_ENV: "production", RDASH_TEMP_PROJECT_ID: "pHASH", ALLOW_TEMP_PROJECT_ID: "true" }),
      ).toBe("real");
    });

    it("bad flag value or flag without the id → error", () => {
      expect(() => resolveTempProjectId({ RDASH_TEMP_PROJECT_ID: "p", ALLOW_TEMP_PROJECT_ID: "1" })).toThrow(/must be "true"/);
      expect(() => resolveTempProjectId({ ALLOW_TEMP_PROJECT_ID: "true" })).toThrow(/without RDASH_TEMP_PROJECT_ID/);
    });
  });
});
