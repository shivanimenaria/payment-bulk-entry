"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { detectTrustedParentOrigin } from "@/lib/embedded-parent-origin";

const MESSAGE_TYPE = "rdash_embedded_navigation";
const APP_NAME = "pbe";

export function EmbeddedNavigationReporter() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  useEffect(() => {
    console.log("[EmbeddedNavigationReporter] detected navigation", { pathname, search });
    if (typeof window === "undefined") return;
    console.log("[EmbeddedNavigationReporter] window.location", { href: window.location.href, origin: window.location.origin });
    if (window.parent === window) return;

    const targetOrigin = detectTrustedParentOrigin();
    console.log("[EmbeddedNavigationReporter] reporting navigation to parent", { pathname, search, targetOrigin });

    if (!targetOrigin) return;

    const path = search ? `${pathname}?${search}` : pathname;
    window.parent.postMessage(
      {
        type: MESSAGE_TYPE,
        app: APP_NAME,
        path,
      },
      targetOrigin,
    );
  }, [pathname, search]);

  return null;
}
