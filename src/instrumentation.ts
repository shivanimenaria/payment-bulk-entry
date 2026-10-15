// Runs once when the server starts (Node and Edge runtimes). Fails fast on
// invalid security-relevant configuration instead of at the first request.
// Not run by `next build`, so builds don't need runtime secrets.
import { validateRuntimeConfig, resolveTempProjectId } from "@/lib/runtime-config";

export async function register() {
  try {
    const dataSource = validateRuntimeConfig(process.env);
    if (dataSource === "mock") {
      console.warn(`[startup] RDASH_DATA_SOURCE=mock (runtime: ${process.env.NEXT_RUNTIME}) — auth is bypassed and data is mocked`);
    }
    // TODO(remove-temp-project-id): warn on every startup while it is set.
    if (resolveTempProjectId(process.env)) {
      console.warn(
        `[startup] RDASH_TEMP_PROJECT_ID is set (runtime: ${process.env.NEXT_RUNTIME}) — TEMPORARY: config rows without project_id use this project for details; project names are marked "(temporary)"`,
      );
    }
  } catch (err) {
    // Message names the offending setting only — never its value.
    console.error("[startup] invalid configuration:", err instanceof Error ? err.message : err);
    if (process.env.NEXT_RUNTIME === "nodejs") process.exit(1);
    throw err;
  }
}
