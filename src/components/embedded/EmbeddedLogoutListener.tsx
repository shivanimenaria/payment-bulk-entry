"use client";

import { useEffect } from "react";
import { isParentOriginAllowed } from "@/lib/embedded-parent-origin";

// Mirrors the rdash-web side enum `EMBEDDED_APP_MESSAGE_TYPE.LOGOUT`.
// Kept as a literal so a typo on one side fails loudly instead of silently
// falling through to "unknown message, ignored".
const LOGOUT_MESSAGE_TYPE = "rdash_logout";

// Listens for the parent rdash app's logout broadcast and tears down PBE's
// own session state.
//
// Why this is needed even though rdash-api already revokes the embedded
// tokens on logout: the BROWSER doesn't know that. The `pbe-auth` cookie on
// the PBE origin is on a different site from rdash's cookies, so rdash's
// logout can't reach into PBE's cookie jar. Without this listener, the
// next time the user does anything in PBE the stale cookie
// gets sent → 401 from rdash-api → 401 session_expired clears the cookie.
// That recovery path works, but it costs one round-trip the
// user sees as a transient error / re-handover. Pre-clearing here short-
// circuits all of that.
//
// Security: we ONLY accept the LOGOUT message from a parent origin in our
// allowlist (NEXT_PUBLIC_RDASH_UI_ORIGIN). An attacker page that frames us
// can't trigger an unwanted logout because they can't post messages with a
// trusted origin.
export function EmbeddedLogoutListener() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Not embedded — top-level pages don't need this.
    if (window.parent === window) {
      console.info("[EmbeddedLogoutListener] not embedded (top-level page), skipping mount");
      return;
    }

    console.info("[EmbeddedLogoutListener] mounted, listening for parent logout", {
      location: window.location.href,
    });

    const handler = (event: MessageEvent) => {
      if (event.data?.type !== LOGOUT_MESSAGE_TYPE) return;

      // Once we see our message type, log every step — these few lines
      // are the proof-of-delivery breadcrumbs you want when "rdash logged
      // out but PBE still has the cookie" recurs.
      console.info("[EmbeddedLogoutListener] received logout message", {
        origin: event.origin,
        type: event.data?.type,
      });

      if (!isParentOriginAllowed(event.origin)) {
        console.warn("[EmbeddedLogoutListener] ignoring logout from untrusted origin", {
          origin: event.origin,
        });
        return;
      }

      console.info("[EmbeddedLogoutListener] origin trusted, calling /api/auth/logout", {
        origin: event.origin,
      });

      // Intentional exception to "apiFetch for client API calls" (CLAUDE.md):
      // apiFetch's 401 handler would start a fresh handover during logout.
      // Fire-and-forget; we don't block iframe teardown on the response.
      // The 204 (or any error) lands after the parent has already torn
      // down its own session — the cookie clear is what matters for
      // future requests.
      fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        keepalive: true,
        // Required by the route's CSRF guard (see request-guards.ts).
        headers: { "x-pbe-request": "logout" },
      })
        .then((res) => {
          console.info("[EmbeddedLogoutListener] /api/auth/logout returned", { status: res.status });
        })
        .catch((err) => {
          console.warn("[EmbeddedLogoutListener] /api/auth/logout failed", err);
        });
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  return null;
}
