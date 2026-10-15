#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set"
  exit 1
fi

# Resolve migrations relative to this script so it works both locally
# (`sh db/migrate.sh`) and in the container (/app/db/migrate.sh).
MIGRATIONS_DIR="$(cd "$(dirname "$0")" && pwd)/migrations"

echo "Running migrations..."
for f in "$MIGRATIONS_DIR"/*.sql; do
  echo "=== $(basename "$f") ==="
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
echo "All migrations complete."
