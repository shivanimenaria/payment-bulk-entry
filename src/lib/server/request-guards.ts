import "server-only";

// Header the PBE client must send on state-changing internal calls (logout).
// Browsers cannot attach a custom header to a cross-origin request without a
// CORS preflight, which this app never approves — so its presence proves the
// request came from PBE's own origin (i.e. our iframe), not a third-party page.
export const PBE_REQUEST_HEADER = "x-pbe-request";

export type GuardResult = { ok: true } | { ok: false; reason: string };

/**
 * CSRF guard for POST /api/auth/logout. The only legitimate caller is
 * EmbeddedLogoutListener running inside the PBE iframe (same-origin fetch);
 * rDash never calls this route directly — it postMessages the iframe.
 *
 * Requires the custom header AND same-origin provenance:
 *   - Sec-Fetch-Site present → must be "same-origin".
 *   - Sec-Fetch-Site absent (older browsers) → Origin must equal APP_URL's origin.
 *   - Neither present → rejected (fail closed).
 */
export function checkSameOriginRequest(
  headers: Headers,
  expectedHeaderValue: string,
  appUrl: string | undefined,
): GuardResult {
  if (headers.get(PBE_REQUEST_HEADER) !== expectedHeaderValue) {
    return { ok: false, reason: "missing request header" };
  }

  const site = headers.get("sec-fetch-site");
  if (site !== null) {
    return site === "same-origin" ? { ok: true } : { ok: false, reason: `sec-fetch-site=${site}` };
  }

  const origin = headers.get("origin");
  if (origin === null) return { ok: false, reason: "no sec-fetch-site or origin" };

  let expected: string;
  try {
    expected = new URL(appUrl ?? "").origin;
  } catch {
    return { ok: false, reason: "APP_URL not configured" };
  }
  return origin === expected ? { ok: true } : { ok: false, reason: "origin mismatch" };
}
