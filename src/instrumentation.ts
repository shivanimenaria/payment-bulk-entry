// Runs once when the server starts (Node and Edge runtimes). Fails fast on
// invalid security-relevant configuration instead of at the first request.
// Not run by `next build`, so builds don't need runtime secrets.
import { validateRuntimeConfig } from "@/lib/runtime-config";

export async function register() {
  try {
    const dataSource = validateRuntimeConfig(process.env);
    if (dataSource === "mock") {
      console.warn(`[startup] RDASH_DATA_SOURCE=mock (runtime: ${process.env.NEXT_RUNTIME}) — auth is bypassed and data is mocked`);
    }
  } catch (err) {
    // Message names the offending setting only — never its value.
    console.error("[startup] invalid configuration:", err instanceof Error ? err.message : err);
    if (process.env.NEXT_RUNTIME === "nodejs") process.exit(1);
    throw err;
  }
}
