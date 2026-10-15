import "server-only";
import { resolveDataSource, type DataSource } from "@/lib/runtime-config";

export type { DataSource };

// The single mock|real switch for BOTH auth (getSessionOrMock) and data.
// Rules (incl. the production opt-in) live in resolveDataSource; any invalid
// combination throws — there is no default and no fallback from real to mock.
export function getDataSource(): DataSource {
  return resolveDataSource(process.env);
}
