// Runtime configuration rules shared by the Node server (auth.ts, rdash-source)
// and the Edge middleware. Must stay free of Node-only APIs and of the
// `server-only` guard so middleware and instrumentation can import it.
// Never import this from client components.

type Env = Record<string, string | undefined>;

// ── COOKIE_SECRET ───────────────────────────────────────────
// 32 bytes as 64 hex chars, unique to PBE. No default: a missing or malformed
// value throws, so the session cookie can never be encrypted with a guessable key.
const COOKIE_SECRET_RE = /^[0-9a-fA-F]{64}$/;

export function parseCookieSecret(hex: string | undefined): Uint8Array {
  if (!hex || !COOKIE_SECRET_RE.test(hex)) {
    throw new Error("COOKIE_SECRET must be set to 64 hex characters");
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

let cachedSecret: { hex: string; key: Uint8Array } | null = null;

/** The validated session-cookie key. Used by both auth.ts and middleware.ts. */
export function getCookieSecretKey(): Uint8Array {
  const hex = process.env.COOKIE_SECRET;
  if (cachedSecret && cachedSecret.hex === hex) return cachedSecret.key;
  const key = parseCookieSecret(hex);
  cachedSecret = { hex: hex as string, key };
  return key;
}

// ── RDASH_DATA_SOURCE (mock auth + mock data are one switch) ─
// mock mode selects BOTH the mock session (getSessionOrMock) and mock data
// (rdash-source). There is no separate switch for either, so they can never
// diverge, and there is no fallback from real to mock.
//
// Allowed combinations:
//   real                                   → always allowed
//   mock, NODE_ENV !== "production"        → allowed (local dev)
//   mock, NODE_ENV === "production"        → only with PBE_ALLOW_MOCK_IN_PRODUCTION=true
//                                            (explicit opt-in for a demo deployment)
// Everything else throws (fail closed):
//   - missing/invalid RDASH_DATA_SOURCE
//   - PBE_ALLOW_MOCK_IN_PRODUCTION set to anything but "true", or set in real mode
//   - MOCK_FAIL_IDS set in real mode
export type DataSource = "mock" | "real";

export function resolveDataSource(env: Env): DataSource {
  const raw = env.RDASH_DATA_SOURCE;
  if (raw !== "mock" && raw !== "real") {
    throw new Error(
      `RDASH_DATA_SOURCE must be "mock" or "real" (got ${raw === undefined ? "unset" : JSON.stringify(raw)})`,
    );
  }

  // Empty string (e.g. copied from .env.example) counts as unset.
  const allowFlag = env.PBE_ALLOW_MOCK_IN_PRODUCTION || undefined;
  if (allowFlag !== undefined && allowFlag !== "true") {
    throw new Error('PBE_ALLOW_MOCK_IN_PRODUCTION must be "true" or unset');
  }

  if (raw === "real") {
    if (allowFlag !== undefined) {
      throw new Error("PBE_ALLOW_MOCK_IN_PRODUCTION must not be set when RDASH_DATA_SOURCE=real");
    }
    if (env.MOCK_FAIL_IDS) {
      throw new Error("MOCK_FAIL_IDS must not be set when RDASH_DATA_SOURCE=real");
    }
    return "real";
  }

  if (env.NODE_ENV === "production" && allowFlag !== "true") {
    throw new Error(
      "RDASH_DATA_SOURCE=mock is not allowed with NODE_ENV=production unless PBE_ALLOW_MOCK_IN_PRODUCTION=true",
    );
  }
  return "mock";
}

// ── RDASH_TEMP_PROJECT_ID (TEMPORARY workaround) ────────────
// TODO(remove-temp-project-id): remove once the config response returns
// project_id (docs/api-notes.md → #15). Until then, config items without
// project_id use this project for the details call, flagged "temporary".
// Rules (fail closed, like PBE_ALLOW_MOCK_IN_PRODUCTION):
//   unset                                   → null (feature off)
//   set, NODE_ENV !== "production"          → allowed
//   set, NODE_ENV === "production"          → only with ALLOW_TEMP_PROJECT_ID=true
//   ALLOW_TEMP_PROJECT_ID ≠ "true", or set without RDASH_TEMP_PROJECT_ID → throws
export function resolveTempProjectId(env: Env): string | null {
  const id = env.RDASH_TEMP_PROJECT_ID?.trim() || undefined;
  const allow = env.ALLOW_TEMP_PROJECT_ID || undefined;
  if (allow !== undefined && allow !== "true") {
    throw new Error('ALLOW_TEMP_PROJECT_ID must be "true" or unset');
  }
  if (!id) {
    if (allow !== undefined) throw new Error("ALLOW_TEMP_PROJECT_ID must not be set without RDASH_TEMP_PROJECT_ID");
    return null;
  }
  if (env.NODE_ENV === "production" && allow !== "true") {
    throw new Error("RDASH_TEMP_PROJECT_ID is not allowed with NODE_ENV=production unless ALLOW_TEMP_PROJECT_ID=true");
  }
  return id;
}

// ── RDASH_AUTH_MODE (DEV-ONLY static token) ─────────────────
// "handover" (or unset) = the normal embedded handover flow.
// "static_token" = DEV ONLY, for testing against the real rDash API before the
// embedded app is registered: no handover, a fixed dev session whose vendor
// is RDASH_DEV_VENDOR_ID, every rDash call uses RDASH_DEV_API_TOKEN with
// RDASH_DEV_AUTH_SCHEME, NO token refresh, ids passed to rDash exactly as
// given (no PBE-salt decode/encode). Writes (bulk POST) are blocked unless
// RDASH_DEV_ALLOW_WRITES=true. Fail closed:
//   - NODE_ENV=production                    → error
//   - RDASH_DATA_SOURCE must be "real"
//   - RDASH_DEV_API_TOKEN / RDASH_DEV_AUTH_SCHEME / RDASH_DEV_VENDOR_ID /
//     RDASH_API_URL required (no defaults)
//   - RDASH_DEV_* set without static_token, or RDASH_DEV_ALLOW_WRITES ≠ "true" → error
export type AuthMode = "handover" | "static_token";

const DEV_VARS = ["RDASH_DEV_API_TOKEN", "RDASH_DEV_AUTH_SCHEME", "RDASH_DEV_VENDOR_ID", "RDASH_DEV_ALLOW_WRITES"] as const;

export function resolveAuthMode(env: Env): AuthMode {
  const raw = env.RDASH_AUTH_MODE || undefined;
  if (raw !== undefined && raw !== "handover" && raw !== "static_token") {
    throw new Error('RDASH_AUTH_MODE must be "handover", "static_token" or unset');
  }
  if (raw !== "static_token") {
    const stray = DEV_VARS.filter((k) => env[k]);
    if (stray.length) throw new Error(`${stray.join(", ")} must not be set unless RDASH_AUTH_MODE=static_token`);
    return "handover";
  }
  if (env.NODE_ENV === "production") {
    throw new Error("RDASH_AUTH_MODE=static_token is dev-only and not allowed with NODE_ENV=production");
  }
  if (env.RDASH_DATA_SOURCE !== "real") {
    throw new Error("RDASH_AUTH_MODE=static_token requires RDASH_DATA_SOURCE=real");
  }
  const missing = ["RDASH_DEV_API_TOKEN", "RDASH_DEV_AUTH_SCHEME", "RDASH_DEV_VENDOR_ID", "RDASH_API_URL"].filter((k) => !env[k]);
  if (missing.length) throw new Error(`RDASH_AUTH_MODE=static_token requires ${missing.join(", ")}`);
  if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(env.RDASH_DEV_AUTH_SCHEME as string)) {
    throw new Error("RDASH_DEV_AUTH_SCHEME must be a single word, e.g. Bearer");
  }
  const writes = env.RDASH_DEV_ALLOW_WRITES || undefined;
  if (writes !== undefined && writes !== "true") throw new Error('RDASH_DEV_ALLOW_WRITES must be "true" or unset');
  return "static_token";
}

/** Static-token dev settings. Only call when resolveAuthMode() is "static_token". */
export function devStaticTokenConfig(env: Env): { token: string; scheme: string; vendorId: string; allowWrites: boolean } {
  return {
    token: env.RDASH_DEV_API_TOKEN as string,
    scheme: env.RDASH_DEV_AUTH_SCHEME as string,
    vendorId: env.RDASH_DEV_VENDOR_ID as string,
    allowWrites: env.RDASH_DEV_ALLOW_WRITES === "true",
  };
}

/** Startup check (instrumentation.ts). Throws on any invalid configuration. */
export function validateRuntimeConfig(env: Env): DataSource {
  parseCookieSecret(env.COOKIE_SECRET);
  const source = resolveDataSource(env);
  const authMode = resolveAuthMode(env);
  // Real handover mode compares the handover's app_slug with this
  // (/api/session). Mock mode and dev static-token mode (no handover) skip it.
  if (source === "real" && authMode === "handover" && !env.RDASH_PBE_TAB_CODE) {
    throw new Error("RDASH_PBE_TAB_CODE must be set when RDASH_DATA_SOURCE=real");
  }
  resolveTempProjectId(env); // TODO(remove-temp-project-id)
  return source;
}
