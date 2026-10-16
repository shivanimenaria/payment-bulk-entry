"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";

type DataSource = "mock" | "real";
type AuthMode = "handover" | "static_token";

interface SessionData {
  orgId: string;
  projectId: string;
  userId: string;
  // rDash vendor this iframe was opened for (verified server-side at handover).
  vendorId: string;
  displayName: string;
  // From /api/auth/me; null until the session loads. Drives the MOCK DATA badge.
  dataSource: DataSource | null;
  // "static_token" = DEV-only real-data mode (UI badge "DEV — REAL DATA").
  authMode: AuthMode | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_SESSION: SessionData = {
  orgId: "",
  projectId: "",
  userId: "",
  vendorId: "",
  displayName: "",
  dataSource: null,
  authMode: null,
  loading: true,
  error: null,
};

const SessionContext = createContext<SessionData>(EMPTY_SESSION);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionData>(EMPTY_SESSION);

  // Dedup concurrent pingAuth calls (mount + visibilitychange + interval can
  // overlap). Multiple in-flight /api/auth/me requests race the cookie write
  // back from middleware and trigger refresh-token replay.
  const inflightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Skip the auto-ping on the embedded bootstrap page — that page already
    // probes /api/auth/me itself and immediately redirects.
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/embedded/bootstrap")) {
      return;
    }

    const pingAuth = (): Promise<void> => {
      if (inflightRef.current) return inflightRef.current;
      const p = fetch("/api/auth/me", { credentials: "include", cache: "no-store" })
        .then(async (res) => {
          if (cancelled) return;
          if (!res.ok) throw new Error(`Session check failed (${res.status})`);
          const data = await res.json();
          setSession({
            orgId: data.orgId || "",
            projectId: data.projectId || "",
            userId: data.userId || "",
            vendorId: data.vendorId || "",
            displayName: data.displayName || "",
            dataSource: data.dataSource === "mock" || data.dataSource === "real" ? data.dataSource : null,
            authMode: data.authMode === "handover" || data.authMode === "static_token" ? data.authMode : null,
            loading: false,
            error: null,
          });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          // No fallback identity: surface the error. Recovery (re-handover)
          // is driven by apiFetch's 401 handling.
          setSession((prev) => ({
            ...prev,
            loading: false,
            error: err instanceof Error ? err.message : "Session check failed",
          }));
        })
        .finally(() => {
          if (inflightRef.current === p) inflightRef.current = null;
        });
      inflightRef.current = p;
      return p;
    };

    pingAuth();

    // Keep the session warm while the user is idle inside the iframe.
    const intervalId = setInterval(pingAuth, 10 * 60 * 1000);
    // Refresh when the tab regains focus AFTER being hidden — but ignore the
    // initial "visible" that fires synchronously with mount in some browsers.
    let wasHidden = document.visibilityState === "hidden";
    const onVisible = () => {
      if (document.visibilityState === "hidden") {
        wasHidden = true;
        return;
      }
      if (wasHidden) {
        wasHidden = false;
        pingAuth();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      // Drop the in-flight ping: its .then is bound to THIS effect's
      // `cancelled` flag, so a remount (React StrictMode in dev, or any
      // re-mount) reusing it would never set the session.
      inflightRef.current = null;
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);

  // buildUrl: carry the workspace params (orgId/projectId/userId/vendorId) from the
  // current iframe URL onto in-app navigation so middleware keeps the cookie
  // in sync. Pass-through when the URL has none.
  function buildUrl(path: string) {
    if (typeof window === "undefined") return path;
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    if (!orgId) return path;
    const sep = path.includes("?") ? "&" : "?";
    const toAppend: string[] = [];
    if (orgId) toAppend.push(`orgId=${orgId}`);
    const projectId = params.get("projectId");
    if (projectId) toAppend.push(`projectId=${projectId}`);
    const userId = params.get("userId");
    if (userId) toAppend.push(`userId=${userId}`);
    const vendorId = params.get("vendorId");
    if (vendorId) toAppend.push(`vendorId=${vendorId}`);
    return toAppend.length > 0 ? `${path}${sep}${toAppend.join("&")}` : path;
  }

  return { ...ctx, buildUrl };
}
