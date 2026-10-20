import { EncryptJWT } from "jose";
import { randomBytes } from "node:crypto";

// Throwaway per-run secret — never a real one.
export const TEST_COOKIE_SECRET = randomBytes(32).toString("hex");
export const TEST_SALT = "pbe-test-salt";

export function setAuthEnv() {
  process.env.COOKIE_SECRET = TEST_COOKIE_SECRET;
  process.env.EMBEDDED_APPS_HASH_ID_SALT_PBE = TEST_SALT;
}

export async function makeSessionCookie(overrides: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new EncryptJWT({
    accessToken: "test-access",
    expiresAt: now + 900,
    orgId: "11",
    projectId: "22",
    userId: "7",
    vendorId: "33",
    displayName: "Test User",
    email: "",
    tabCode: "pbe",
    ...overrides,
  })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .encrypt(new Uint8Array(Buffer.from(TEST_COOKIE_SECRET, "hex")));
}
