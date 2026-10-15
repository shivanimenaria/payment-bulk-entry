import "server-only";
import Hashids from "hashids";
import { requireEnv } from "./env";

// Decoder/encoder for rDash-issued IDs (project_id, org_id, user_id,
// vendor_id, payment_request_id, etc.). rDash encodes these via Pydantic
// HashIdInt and ships a per-consumer salt to this app via
// EMBEDDED_APPS_HASH_ID_SALT_PBE, so the same Hashids instance round-trips
// both directions: rDash → us (decode) and us → rDash (encode).
//
// Convention in this codebase: stored values (cookie, session cache) are the
// *decoded* integer in string form (e.g. "1234"). Anything that crosses the
// rDash boundary — outbound URL paths, payloads sent to rDash, IDs returned to
// the browser — must be re-encoded via `encodeRdashId`.
//
// TODO(verify): which rDash ids use this salt — iframe URL ids
// (vendor_id/org_id/user_id/project_id), handover user.id/org.id, /v2/vendors
// ids, config/details/bulk payment_request_id (docs/api-notes.md → "ID encoding").
const MIN_LENGTH = 16;
let hashids: Hashids | null = null;

// Lazy so `next build` doesn't need the salt; first use without it throws.
function getHashids(): Hashids {
  if (!hashids) hashids = new Hashids(requireEnv("EMBEDDED_APPS_HASH_ID_SALT_PBE"), MIN_LENGTH);
  return hashids;
}

/** Decode a rDash hashid string to its integer (returned as a string for
 *  symmetry with the rest of the codebase, which treats IDs as strings). */
export function decodeRdashId(hash: string): string {
  if (!hash) throw new Error("decodeRdashId: empty input");
  const decoded = getHashids().decode(hash);
  if (decoded.length !== 1) throw new Error(`Invalid rDash id: ${hash}`);
  return String(decoded[0]);
}

/** Encode a decoded integer (string or number) back into rDash's hashid
 *  string. Used at the boundary just before calling rDash APIs. */
export function encodeRdashId(id: string | number): string {
  const num = typeof id === "string" ? parseInt(id, 10) : id;
  if (Number.isNaN(num) || !Number.isFinite(num)) {
    throw new Error(`encodeRdashId: not an integer: ${id}`);
  }
  return getHashids().encode(num);
}

/** Best-effort decode — returns null on invalid input instead of throwing.
 *  A missing salt still throws (misconfiguration, not bad input). */
export function decodeRdashIdSafe(hash: string | null | undefined): string | null {
  if (!hash) return null;
  getHashids();
  try {
    return decodeRdashId(hash);
  } catch {
    return null;
  }
}
