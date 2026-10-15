const ALLOWED_ORIGINS_RAW = process.env.NEXT_PUBLIC_RDASH_UI_ORIGIN || "";
const TRUSTED_PARENT_ORIGIN_KEY = "pbe:trustedParentOrigin";

export const ALLOWED_PARENT_ORIGIN_PATTERNS = ALLOWED_ORIGINS_RAW
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function isParentOriginAllowed(candidate: string): boolean {
  if (!candidate) return false;

  for (const pattern of ALLOWED_PARENT_ORIGIN_PATTERNS) {
    if (pattern === candidate) return true;
    if (pattern.includes("*")) {
      // Escape regex specials, then * -> one subdomain segment (no dots).
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^.]+");
      if (new RegExp(`^${escaped}$`).test(candidate)) return true;
    }
  }

  return false;
}

export function detectParentOrigin(): string | null {
  if (typeof window === "undefined") return null;

  // ancestorOrigins is non-standard but reliable on Chromium/Safari and
  // survives strict Referrer-Policy. Falls back to document.referrer.
  const ancestors = (window.location as unknown as { ancestorOrigins?: { length: number; item(i: number): string | null } }).ancestorOrigins;
  if (ancestors && ancestors.length > 0) {
    const first = ancestors.item(0);
    if (first) return first;
  }

  if (document.referrer) {
    try {
      return new URL(document.referrer).origin;
    } catch {
      // ignore
    }
  }

  return null;
}

export function detectTrustedParentOrigin(): string | null {
  const detected = detectParentOrigin();
  console.log("[detectTrustedParentOrigin] detected parent origin", { detected });
  if (detected && isParentOriginAllowed(detected)) {
    rememberTrustedParentOrigin(detected);
    return detected;
  }

  return getRememberedTrustedParentOrigin();
}

export function rememberTrustedParentOrigin(origin: string): void {
  if (typeof window === "undefined") return;
  if (!isParentOriginAllowed(origin)) return;
  try {
    window.sessionStorage.setItem(TRUSTED_PARENT_ORIGIN_KEY, origin);
  } catch {
    // ignore
  }
}

function getRememberedTrustedParentOrigin(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const origin = window.sessionStorage.getItem(TRUSTED_PARENT_ORIGIN_KEY);
    return origin && isParentOriginAllowed(origin) ? origin : null;
  } catch {
    return null;
  }
}
