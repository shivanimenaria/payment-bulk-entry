/**
 * DEV ONLY — dump raw rDash JSON with the static dev token, to check real
 * response shapes before the embedded app is registered.
 *
 *   npx tsx --env-file=.env.local scripts/rdash-dump.ts "<vendor name>"
 *
 * Requires the RDASH_AUTH_MODE=static_token env (see .env.example); refuses
 * NODE_ENV=production. Prints, in order:
 *   1. GET /v2/vendors?name=<arg>                       (raw response)
 *   2. GET /v2/vendor-payment-requests/config/?vendor_id=RDASH_DEV_VENDOR_ID
 *      — every page, following `next` until null
 *   3. GET /v2/projects?limit=10&offset=0                (first page only —
 *      confirms the DRF shape; the org may have hundreds of projects)
 *   4. GET /v2/projects/{project_id}/vendor-payment-requests/{id}
 *      for the first payable row (pending/approved/submitted, due > 0)
 * GET requests only — it NEVER calls the bulk POST. The token is never
 * printed: any occurrence in output is replaced with ***REDACTED***.
 * Server-only: run from a terminal, never imported by app code.
 */
import { devStaticTokenConfig, resolveAuthMode } from "../src/lib/runtime-config";
import { isPayable } from "../src/lib/payments/payable";
import type { VendorPaymentRequestConfigItem } from "../src/types/rdash";

const MAX_PAGES = 200;

function fail(message: string): never {
  console.error(`rdash-dump: ${message}`);
  process.exit(1);
}

async function main() {
  const vendorName = process.argv[2];
  if (!vendorName) fail('usage: npx tsx --env-file=.env.local scripts/rdash-dump.ts "<vendor name>"');

  let mode: string;
  try {
    mode = resolveAuthMode(process.env);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  if (mode !== "static_token") fail("RDASH_AUTH_MODE=static_token is required (dev only)");
  const dev = devStaticTokenConfig(process.env);
  const base = (process.env.RDASH_API_URL as string).replace(/\/+$/, "");
  const baseOrigin = new URL(base).origin;

  const redact = (text: string) => text.split(dev.token).join("***REDACTED***");
  const print = (title: string, body: unknown) => {
    console.log(`\n===== ${title} =====`);
    console.log(redact(typeof body === "string" ? body : JSON.stringify(body, null, 2)));
  };

  // GET only. Refuses any URL outside RDASH_API_URL (token stays on rDash).
  async function get(url: string): Promise<{ status: number; json: unknown; text: string }> {
    if (new URL(url).origin !== baseOrigin) fail(`refusing to call ${new URL(url).origin} (outside RDASH_API_URL)`);
    const res = await fetch(url, { method: "GET", headers: { Authorization: `${dev.scheme} ${dev.token}`, Accept: "application/json" } });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON — printed raw */
    }
    return { status: res.status, json, text };
  }

  // 1. Vendors by name
  const vendors = await get(`${base}/v2/vendors?name=${encodeURIComponent(vendorName)}`);
  print(`GET /v2/vendors?name=${vendorName} → HTTP ${vendors.status}`, vendors.json ?? vendors.text);

  // 2. Config for the dev vendor — all pages via `next`
  const configPath = "/v2/vendor-payment-requests/config/";
  let url: string | null = `${base}${configPath}?vendor_id=${encodeURIComponent(dev.vendorId)}&limit=200&offset=0`;
  const rows: VendorPaymentRequestConfigItem[] = [];
  let count: number | null = null;
  for (let page = 1; url; page++) {
    if (page > MAX_PAGES) fail(`stopped after ${MAX_PAGES} pages (next never became null)`);
    const r = await get(url);
    print(`GET ${new URL(url).pathname}${new URL(url).search} (page ${page}) → HTTP ${r.status}`, r.json ?? r.text);
    if (r.status !== 200) fail(`config page ${page} returned HTTP ${r.status}`);
    const data = (r.json as { data?: { count?: unknown; next?: unknown; results?: unknown } } | null)?.data;
    if (!data || !Array.isArray(data.results) || typeof data.count !== "number") {
      fail("config response is not { data: { count, next, previous, results } }");
    }
    count = data.count;
    rows.push(...(data.results as VendorPaymentRequestConfigItem[]));
    if (data.next !== null && typeof data.next !== "string") fail("config `next` is neither a URL nor null");
    url = (data.next as string | null) || null;
    if (url && new URL(url).pathname !== configPath) fail(`config \`next\` points to another path: ${new URL(url).pathname}`);
  }
  console.log(`\nconfig: ${rows.length} row(s) collected, count = ${count}${rows.length === count ? "" : "  ← MISMATCH"}`);

  // 3. Projects — first page only
  const projects = await get(`${base}/v2/projects?limit=10&offset=0`);
  print(`GET /v2/projects?limit=10&offset=0 (first page) → HTTP ${projects.status}`, projects.json ?? projects.text);
  const pd = (projects.json as { data?: { count?: unknown; next?: unknown; results?: unknown } } | null)?.data;
  console.log(
    `\nprojects shape: ${pd && Array.isArray(pd.results) && typeof pd.count === "number" ? `DRF (count ${pd.count}, next ${pd.next ? "set" : "null"})` : "NOT the DRF { count, next, previous, results } shape"}`,
  );

  // 4. Details for the first payable row
  const first = rows.find(isPayable);
  if (!first) {
    console.log("\nNo payable row (pending/approved/submitted with payment_due > 0) — details not fetched.");
    return;
  }
  if (!first.project_id) fail(`first payable row ${first.payment_request_id} has no project_id`);
  const detailsPath = `/v2/projects/${encodeURIComponent(first.project_id)}/vendor-payment-requests/${encodeURIComponent(first.payment_request_id)}`;
  const details = await get(`${base}${detailsPath}`);
  print(`GET ${detailsPath} → HTTP ${details.status}`, details.json ?? details.text);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
