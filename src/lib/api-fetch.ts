"use client";

// Debounce window so a burst of in-flight requests that all 401 only trigger
// one recovery navigation from this page.
const RECOVERY_DEBOUNCE_MS = 8_000;
let lastRecoveryAt = 0;

// Loop guard across the re-handover navigation (sessionStorage survives it).
// Set when a re-handover starts, cleared by the first successful API call.
// A 401 while it is still set — within LOOP_WINDOW_MS — means the fresh
// session died immediately: stop and show an error instead of looping.
export const REHANDOVER_MARKER_KEY = "pbe:rehandover-at";
export const LOOP_WINDOW_MS = 60_000;
export const SESSION_RENEW_FAILED_URL = "/embedded/bootstrap?error=session_renew_failed";

// Pages with unsaved input register here (/payments/new saves its form).
// Run synchronously right before the iframe leaves the page.
type BeforeRehandover = () => void;
const beforeRehandover = new Set<BeforeRehandover>();

export function onBeforeRehandover(fn: BeforeRehandover): () => void {
  beforeRehandover.add(fn);
  return () => {
    beforeRehandover.delete(fn);
  };
}

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readMarker(): number | null {
  try {
    const v = Number(storage()?.getItem(REHANDOVER_MARKER_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeMarker(value: number | null): void {
  try {
    if (value === null) storage()?.removeItem(REHANDOVER_MARKER_KEY);
    else storage()?.setItem(REHANDOVER_MARKER_KEY, String(value));
  } catch {
    // Storage blocked: the in-page debounce still prevents a request storm.
  }
}

function saveUnsavedState(): void {
  for (const fn of Array.from(beforeRehandover)) {
    try {
      fn();
    } catch (err) {
      console.error("[apiFetch] saving state before re-handover failed", err);
    }
  }
}

function recoverFromUnauthorized(input: string): void {
  const now = Date.now();
  if (now - lastRecoveryAt <= RECOVERY_DEBOUNCE_MS) return;
  lastRecoveryAt = now;
  // Save first in every case — the error page's "reload the tab" also
  // restores it.
  saveUnsavedState();
  const marker = readMarker();
  if (marker !== null && now - marker < LOOP_WINDOW_MS) {
    console.error("[apiFetch] 401 right after a fresh handover — not retrying", { input });
    writeMarker(null);
    window.location.replace(SESSION_RENEW_FAILED_URL);
    return;
  }
  writeMarker(now);
  // Bootstrap skips the /api/auth/me probe and asks the rDash parent for a
  // fresh handover code; after /api/session the iframe returns to `next`.
  const next = window.location.pathname + window.location.search;
  console.warn("[apiFetch] 401 from", input, "— redirecting to fresh-handover bootstrap");
  window.location.replace(`/embedded/bootstrap?force=1&next=${encodeURIComponent(next)}`);
}

/**
 * Wrapper around fetch for all /api/ calls in client components.
 * Sends the request as-is (no ids appended — the server uses the session's
 * org/vendor and ignores client-sent ones). Never retries a request.
 * - 401 (`session_expired` = the access token expired or rDash answered 401;
 *   any other 401 = no usable session): save unsaved form state
 *   (onBeforeRehandover), then navigate to /embedded/bootstrap?force=1 so
 *   rDash hands the iframe a fresh handover code. PBE has no token refresh.
 *   The caller still receives the 401 response; a bulk submit is never
 *   re-sent automatically.
 * - A second 401 right after a re-handover → SESSION_RENEW_FAILED_URL.
 */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, credentials: "include" }).then((res) => {
    if (typeof window === "undefined") return res;
    if (res.status === 401) recoverFromUnauthorized(input);
    else if (res.ok && readMarker() !== null) writeMarker(null);
    return res;
  });
}
