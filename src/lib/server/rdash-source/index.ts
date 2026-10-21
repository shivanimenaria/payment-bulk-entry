import "server-only";
import { getDataSource, type DataSource } from "./mode";
import type { RdashSource } from "./types";
import { createMockSource } from "./mock";
import { createRealSource } from "./real";

export { getDataSource };
export type { DataSource, RdashSource };

// Data source for one request, selected ONLY by RDASH_DATA_SOURCE (missing or
// invalid → getDataSource throws). `auth` is the session from
// getSessionOrMock; real mode uses its access token (the logged-in user's).
// No fallback from real to mock: a real-source error propagates.
export function getRdashSource(auth: { accessToken: string }): RdashSource {
  const mode = getDataSource();
  if (mode === "mock") return createMockSource();
  // DEV static-token mode: ids are rDash's own (RDASH_DEV_VENDOR_ID), sent as-is.
  return createRealSource(auth.accessToken);
}
