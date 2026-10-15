import "server-only";
import { NextResponse } from "next/server";

// Runtime guard against rDash-int leaks on the wire. Wraps NextResponse.json
// with a recursive scan that flags any field whose *name* looks like an
// rDash ID and whose *value* looks like a decoded integer string. In dev /
// staging this logs a loud warning to the server console; in production it
// is a no-op (zero overhead). Catches the JSON-array vs single-id mismatch
// that bit us, plus any future field someone forgets to encode.
//
// Usage: replace `return NextResponse.json(data)` with `return safeJson(data, request)`
// inside any route that returns rDash-side data.

const IS_DEV_OR_STAGING =
  process.env.NODE_ENV !== "production" ||
  (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").includes("staging") ||
  (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").includes(".dev");

// Field-name patterns that should always carry rDash hashids on the wire.
// Match snake_case + camelCase forms. Add more as new columns appear.
const RDASH_ID_FIELDS = new Set([
  "vendor_id", "vendorId",
  "project_id", "projectId",
  "org_id", "orgId",
  "user_id", "userId",
  "source_order_id", "sourceOrderId",
  "element_id", "elementId",
  "selected_vendor_id", "selectedVendorId",
  "approver_user_id", "approverUserId",
  "assigned_user_id", "assignedUserId",
  "rdash_element_id", "rdashElementId",
  "actor_id", "actorId",
  "hash_id", "hashId",
]);

// rDash hashids are 16-char alphanumeric (per the configured MIN_LENGTH).
// Decoded ints are short numeric strings. We allow numeric look-alikes only
// when they could not possibly be encoded ids (e.g. 17+ chars).
const LOOKS_LIKE_DECODED_INT = /^\d{1,12}$/;

// Walk an arbitrary JSON-serializable value and call onLeak when a field
// name matches RDASH_ID_FIELDS and the value looks like a decoded int.
function scan(value: unknown, path: string, onLeak: (path: string, value: string) => void): void {
  if (value == null) return;
  if (typeof value === "string") return;
  if (typeof value === "number" || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      scan(value[i], `${path}[${i}]`, onLeak);
    }
    return;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      const child = path ? `${path}.${k}` : k;
      // Field-name match → check value shape.
      if (RDASH_ID_FIELDS.has(k)) {
        if (typeof v === "string" && LOOKS_LIKE_DECODED_INT.test(v)) {
          onLeak(child, v);
        } else if (typeof v === "string" && v.length > 0 && /^\[.*\]$/.test(v)) {
          // JSON-array string (e.g. selected_vendor_id stores '["12","34"]').
          try {
            const parsed = JSON.parse(v);
            if (Array.isArray(parsed)) {
              parsed.forEach((entry, i) => {
                if (typeof entry === "string" && LOOKS_LIKE_DECODED_INT.test(entry)) {
                  onLeak(`${child}[json:${i}]`, entry);
                }
              });
            }
          } catch { /* not JSON */ }
        }
      }
      // Recurse regardless of name — leaks can hide in nested rows.
      scan(v, child, onLeak);
    }
  }
}

interface SafeJsonOptions {
  /** Logical route label, surfaced in the warning. */
  route?: string;
  /** Forwarded to NextResponse.json. */
  status?: number;
  /** Headers added to the response. */
  headers?: Record<string, string>;
}

export function safeJson<T>(data: T, opts: SafeJsonOptions = {}): NextResponse {
  if (IS_DEV_OR_STAGING) {
    const leaks: { path: string; value: string }[] = [];
    try {
      scan(data, "", (p, v) => leaks.push({ path: p, value: v }));
    } catch (err) {
      console.warn("[safeJson] scan threw:", err);
    }
    if (leaks.length > 0) {
      console.error(
        `[rdash-leak] ${opts.route || "(unknown route)"} — ${leaks.length} suspected decoded-int rDash ID(s) in response:`,
      );
      for (const l of leaks.slice(0, 10)) {
        console.error(`  • ${l.path} = ${JSON.stringify(l.value)}`);
      }
      if (leaks.length > 10) console.error(`  • …and ${leaks.length - 10} more`);
    }
  }
  const res = NextResponse.json(data, { status: opts.status });
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) res.headers.set(k, v);
  }
  return res;
}
