import "server-only";
import { resolveDataSource, type DataSource } from "@/lib/runtime-config";

export type { DataSource };

// The single mock|real switch for BOTH auth (getSessionOrMock) and data.
// Rules (incl. the production opt-in) live in resolveDataSource; a missing or
// invalid RDASH_DATA_SOURCE (or invalid combination) throws — there is no
// default and no fallback from real to mock. Kept separate from index.ts so
// auth.ts can import it without pulling in the sources (import cycle).
export function getDataSource(): DataSource {
  return resolveDataSource(process.env);
}
