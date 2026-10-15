"use client";

// Debounce window so a burst of in-flight requests that all 401 only trigger
// one recovery navigation. Also blocks runaway loops if recovery itself
// somehow lands back on a 401-returning page.
const RECOVERY_DEBOUNCE_MS = 8_000;
let lastRecoveryAt = 0;

/**
 * Wrapper around fetch for all /api/ calls in client components.
 * Sends the request as-is (no ids appended — the server uses the session's
 * org/vendor and ignores client-sent ones).
 * - Detects 401 from server routes and force-redirects through the embedded
 *   bootstrap so rDash hands the iframe a fresh handover code. The server
 *   only returns 401 now when rDash itself has revoked the session beyond
 *   repair (the lazy refresh in api.ts handles the normal expired-access
 *   case); the only recovery is a new handover.
 */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, credentials: "include" }).then((res) => {
    if (res.status === 401 && typeof window !== "undefined") {
      const now = Date.now();
      if (now - lastRecoveryAt > RECOVERY_DEBOUNCE_MS) {
        lastRecoveryAt = now;
        // Bootstrap will skip the auth.me check and immediately ask the
        // rDash parent for a fresh handover code. After consume, the iframe
        // lands back on the page the user was on.
        const next = window.location.pathname + window.location.search;
        const target = `/embedded/bootstrap?force=1&next=${encodeURIComponent(next)}`;
        console.warn("[apiFetch] 401 from", input, "— redirecting to fresh-handover bootstrap");
        window.location.replace(target);
      }
    }
    return res;
  });
}
