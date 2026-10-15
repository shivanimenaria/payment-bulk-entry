"use client";

import { useEffect, useState } from "react";
import {
  ALLOWED_PARENT_ORIGIN_PATTERNS,
  detectParentOrigin,
  isParentOriginAllowed,
  rememberTrustedParentOrigin,
} from "@/lib/embedded-parent-origin";
import {
  BOOTSTRAP_ERROR_MESSAGES,
  buildSessionUrl,
  contextParams,
  mergeContextIntoTarget,
  sanitizeNext,
  vendorIdFromTarget,
} from "@/lib/embedded-bootstrap-url";

const HANDOVER_TIMEOUT_MS = 10_000;

type Phase = "checking" | "waiting_for_code" | "consuming" | "error";

export default function EmbeddedBootstrap() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    console.log("[handover-iframe] bootstrap mount", {
      href: window.location.href,
      allowedPatterns: ALLOWED_PARENT_ORIGIN_PATTERNS,
    });
    if (ALLOWED_PARENT_ORIGIN_PATTERNS.length === 0) {
      console.error("[handover-iframe] NEXT_PUBLIC_RDASH_UI_ORIGIN not set");
      setPhase("error");
      setErrorMessage("This app is not configured for embedding.");
      return;
    }

    const params = new URLSearchParams(window.location.search);
    // /api/session redirects here with ?error=… when consuming the handover
    // failed. Show it instead of immediately requesting another code (which
    // would loop on a persistent server-side failure).
    const errorCode = params.get("error");
    if (errorCode) {
      setPhase("error");
      setErrorMessage(BOOTSTRAP_ERROR_MESSAGES[errorCode] ?? "Sign-in to this app failed.");
      return;
    }
    const next = sanitizeNext(params.get("next"));
    // `force=1` is set by api-fetch on 401: cookie may look structurally valid
    // (so /api/auth/me would 200) but the underlying rDash tokens are dead.
    // Skip the short-circuit and always go ask the parent for a fresh
    // handover code.
    const forceHandover = params.get("force") === "1";
    // Always preserve project_id / org_id / user_id / vendor_id from the bootstrap URL
    // into the final target — even when `next` is set. Without this, when
    // rDash sets `next=/payments` (no project params inline) and our cookie
    // is already valid, bootstrap redirects straight to /payments with no URL
    // params, middleware sees no mismatch, and the cookie keeps the previous
    // workspace.
    const targetUrl = mergeContextIntoTarget(next, params);
    console.log("[handover-iframe] resolved target", { targetUrl });

    // vendor_id is required (PBE is opened from a vendor's Vendor Payments
    // page). Read it from the bootstrap URL, or from `next` — apiFetch's 401
    // recovery (force=1) only carries it there, as `vendorId`. No vendor →
    // error, never a fallback to whatever vendor an existing cookie holds.
    // The value itself is verified server-side in /api/session.
    const bootstrapVendorId = vendorIdFromTarget(targetUrl);
    if (!bootstrapVendorId) {
      console.error("[handover-iframe] no vendor_id in bootstrap URL");
      setPhase("error");
      setErrorMessage(BOOTSTRAP_ERROR_MESSAGES.missing_vendor);
      return;
    }

    const controller = new AbortController();
    let cleanedUp = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      controller.abort();
      window.removeEventListener("message", onMessage);
      if (timeoutId) clearTimeout(timeoutId);
    };

    const onMessage = (evt: MessageEvent) => {
      if (evt.data?.type === "rdash_handover" || evt.data?.type === "rdash_iframe_ready") {
        console.log("[handover-iframe] message received", {
          origin: evt.origin,
          allowed: isParentOriginAllowed(evt.origin),
          type: evt.data?.type,
        });
      }
      if (!isParentOriginAllowed(evt.origin)) return;
      if (evt.data?.type !== "rdash_handover") return;
      const code = typeof evt.data.code === "string" ? evt.data.code : "";
      if (!code) {
        console.warn("[handover-iframe] handover message missing code");
        return;
      }
      cleanup();
      setPhase("consuming");
      const handoverUrl = buildSessionUrl(code, targetUrl, params, bootstrapVendorId);
      console.log("[handover-iframe] redirecting to /api/session", { codeLen: code.length });
      window.location.replace(handoverUrl);
    };

    (async () => {
      try {
        // force=1 path: skip /api/auth/me entirely and immediately request a
        // new handover code from rDash. Used by api-fetch.ts's 401 recovery.
        if (!forceHandover) {
          // Send the rDash context (org/user/vendor/project) with the probe
          // so middleware compares it with the cookie: a different org,
          // user or vendor clears the cookie → 401 → fresh handover, instead
          // of reusing a session bound to another vendor/org.
          const probe = contextParams(params);
          probe.set("vendor_id", bootstrapVendorId);
          const probeUrl = `/api/auth/me?${probe.toString()}`;
          console.log("[handover-iframe] GET /api/auth/me");
          // Intentional exception to "apiFetch for client API calls"
          // (CLAUDE.md): a 401 here is the expected "no session" answer, and
          // apiFetch's 401 handler would redirect back to this page → loop.
          const res = await fetch(probeUrl, {
            credentials: "include",
            signal: controller.signal,
          });
          if (cleanedUp) return;
          console.log("[handover-iframe] /api/auth/me result", { status: res.status, ok: res.ok });

          if (res.ok) {
            console.log("[handover-iframe] cookie valid, skipping handover, redirecting", { targetUrl });
            cleanup();
            window.location.replace(targetUrl);
            return;
          }
        } else {
          console.log("[handover-iframe] force=1 — skipping /api/auth/me, requesting fresh handover");
        }

        if (window.parent === window) {
          console.error("[handover-iframe] not in iframe, cannot request handover");
          setPhase("error");
          setErrorMessage("This page must be opened inside the rDash app.");
          return;
        }

        // Pin the outbound targetOrigin to the actual parent if we can detect
        // and trust it; otherwise "*". INTENTIONAL EXCEPTION to "no silent
        // fallbacks" (documented in CLAUDE.md): the message is a constant
        // `rdash_iframe_ready` signal with no secret; the sensitive reply
        // (parent → iframe with the handover code) is always origin-checked
        // via isParentOriginAllowed; and parent-origin detection fails in
        // some browsers (no ancestorOrigins, referrer stripped), where a
        // strict target would leave the iframe unable to ever sign in.
        const detected = detectParentOrigin();
        const trustedParentOrigin = detected && isParentOriginAllowed(detected) ? detected : null;
        if (trustedParentOrigin) rememberTrustedParentOrigin(trustedParentOrigin);
        const targetOrigin = trustedParentOrigin || "*";
        console.log("[handover-iframe] parent origin", { detected, targetOrigin, allowed: Boolean(trustedParentOrigin) });

        window.addEventListener("message", onMessage);
        setPhase("waiting_for_code");
        console.log("[handover-iframe] posting rdash_iframe_ready", { targetOrigin });
        window.parent.postMessage({ type: "rdash_iframe_ready" }, targetOrigin);

        timeoutId = setTimeout(() => {
          if (cleanedUp) return;
          console.error("[handover-iframe] timed out waiting for handover code", { ms: HANDOVER_TIMEOUT_MS });
          cleanup();
          setPhase("error");
          setErrorMessage("Timed out waiting for the rDash app to authenticate this session.");
        }, HANDOVER_TIMEOUT_MS);
      } catch (err) {
        if (cleanedUp) return;
        console.error("[handover-iframe] bootstrap error", err);
        cleanup();
        setPhase("error");
        setErrorMessage("Unexpected error while opening this app.");
      }
    })();

    return cleanup;
  }, []);

  if (phase === "error") {
    return (
      <div style={{ padding: 24, fontFamily: "sans-serif" }}>
        <h2>Couldn&apos;t open this app</h2>
        <p>{errorMessage}</p>
        <p>Try refreshing this tab in rDash.</p>
      </div>
    );
  }

  return <BootstrapSkeleton />;
}

function BootstrapSkeleton() {
  return (
    <div style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 1200, margin: "0 auto" }}>
      <style>{`
        @keyframes pbeShimmer {
          0% { background-position: -1000px 0; }
          100% { background-position: 1000px 0; }
        }
        .pbe-skel {
          background: linear-gradient(90deg, #f3f4f6 0%, #e5e7eb 50%, #f3f4f6 100%);
          background-size: 1000px 100%;
          animation: pbeShimmer 1.4s linear infinite;
          border-radius: 6px;
        }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div className="pbe-skel" style={{ height: 28, width: 180 }} />
        <div style={{ display: "flex", gap: 12 }}>
          <div className="pbe-skel" style={{ height: 36, width: 120 }} />
          <div className="pbe-skel" style={{ height: 36, width: 140 }} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <div className="pbe-skel" style={{ height: 38, flex: 1 }} />
        <div className="pbe-skel" style={{ height: 38, width: 160 }} />
        <div className="pbe-skel" style={{ height: 38, width: 160 }} />
      </div>

      <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 16, padding: 14, background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
          {[120, 160, 100, 120, 100, 90].map((w, i) => (
            <div key={i} className="pbe-skel" style={{ height: 14, width: w }} />
          ))}
        </div>
        {Array.from({ length: 6 }).map((_, row) => (
          <div
            key={row}
            style={{
              display: "flex",
              gap: 16,
              padding: 16,
              borderBottom: row === 5 ? "none" : "1px solid #f1f5f9",
            }}
          >
            {[120, 160, 100, 120, 100, 90].map((w, i) => (
              <div key={i} className="pbe-skel" style={{ height: 14, width: w }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
