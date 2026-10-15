import "server-only";
import { Pool, PoolClient } from "pg";
import { requireEnv } from "./env";

// Only used for the rDash session cache (pbe_user_sessions). No business data.

// Prevent multiple Pool instances during Next.js hot reload in dev
const globalForPg = globalThis as unknown as { pgPool?: Pool };

// Created lazily so a missing DATABASE_URL surfaces on first use, not at build.
function getPool(): Pool {
  if (globalForPg.pgPool) return globalForPg.pgPool;
  const pool = new Pool({
    connectionString: requireEnv("DATABASE_URL"),
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });
  pool.on("error", (err) => {
    console.error("Unexpected PG pool error:", err);
  });
  globalForPg.pgPool = pool;
  return pool;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await getPool().query(text, params);
  return result.rows as T[];
}

export async function queryWithClient<T = Record<string, unknown>>(
  client: PoolClient,
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await client.query(text, params);
  return result.rows as T[];
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
