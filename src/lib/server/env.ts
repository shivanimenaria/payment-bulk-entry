import "server-only";

// Read a required env var at call time (not module load) so `next build` can
// evaluate route modules without runtime secrets. Missing → throw; never default.
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
