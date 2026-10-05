#!/usr/bin/env bash
# ==============================================================================
# migrate-to-local.sh
#
# Migrates data from Docker containers (shared-database, shared-redis) to your
# local Postgres and Redis instances.
#
# Usage:
#   chmod +x scripts/migrate-to-local.sh
#   ./scripts/migrate-to-local.sh
#
# Prerequisites:
#   - Docker must be running with the wallet-backend containers active.
#     Start them first with: pnpm localenv:compose up shared-database shared-redis
#   - Local Postgres and Redis must be running.
#   - psql, pg_dump, redis-cli must be available on your PATH.
# ==============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration — adjust if your local setup differs
# ---------------------------------------------------------------------------
DOCKER_COMPOSE_CMD="pnpm localenv:compose"

# Docker-side (from .env.docker)
DOCKER_DB_CONTAINER="wallet-backend-shared-database-1"
DOCKER_DB_USER="man_hunter"
DOCKER_DB_NAME="wallet_bucket"
DOCKER_DB_PASSWORD="pgadmin123"

DOCKER_REDIS_CONTAINER="wallet-backend-shared-redis-1"
DOCKER_REDIS_PASSWORD="rdadmin123"

# Local-side (from .env)
LOCAL_DB_HOST="localhost"
LOCAL_DB_PORT="5432"
LOCAL_DB_USER="man_hunter"
LOCAL_DB_NAME="wallet_bucket"
LOCAL_DB_PASSWORD="pgadmin123"

LOCAL_REDIS_HOST="localhost"
LOCAL_REDIS_PORT="6379"
# LOCAL_REDIS_PASSWORD=""  # no password on local Redis

DUMP_FILE="/tmp/wallet_bucket_dump.sql"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info()    { echo ""; echo "➜  $*"; }
success() { echo "✔  $*"; }
warn()    { echo "⚠  $*"; }

# ---------------------------------------------------------------------------
# Step 0: Preflight checks
# ---------------------------------------------------------------------------
info "Preflight checks..."

if ! command -v psql &>/dev/null; then
  echo "✖  psql not found. Install PostgreSQL client tools first." && exit 1
fi
if ! command -v pg_dump &>/dev/null; then
  echo "✖  pg_dump not found. Install PostgreSQL client tools first." && exit 1
fi
if ! command -v redis-cli &>/dev/null; then
  echo "✖  redis-cli not found. Install Redis client tools first." && exit 1
fi
if ! docker info &>/dev/null; then
  echo "✖  Docker is not running. Start Docker and then start the containers:" && \
  echo "   pnpm localenv:compose up shared-database shared-redis" && exit 1
fi

# Check Docker containers are up
if ! docker ps --format '{{.Names}}' | grep -q "$DOCKER_DB_CONTAINER"; then
  warn "Docker DB container '$DOCKER_DB_CONTAINER' not running."
  warn "Starting shared-database and shared-redis via docker compose..."
  $DOCKER_COMPOSE_CMD up -d shared-database shared-redis
  echo "Waiting for DB to be healthy..."
  sleep 8
fi

# Check local Postgres
if ! PGPASSWORD="$LOCAL_DB_PASSWORD" psql -h "$LOCAL_DB_HOST" -p "$LOCAL_DB_PORT" \
    -U "$LOCAL_DB_USER" -d postgres -c '\q' &>/dev/null; then
  warn "Cannot connect to local Postgres as $LOCAL_DB_USER."
  warn "Attempting setup as current OS user..."

  # Try to create the role and database as the current superuser
  psql postgres -c "CREATE ROLE $LOCAL_DB_USER WITH LOGIN PASSWORD '$LOCAL_DB_PASSWORD';" 2>/dev/null || \
    echo "   (role may already exist — continuing)"
  psql postgres -c "CREATE DATABASE $LOCAL_DB_NAME OWNER $LOCAL_DB_USER;" 2>/dev/null || \
    echo "   (database may already exist — continuing)"
  psql postgres -c "GRANT ALL PRIVILEGES ON DATABASE $LOCAL_DB_NAME TO $LOCAL_DB_USER;" 2>/dev/null || true
fi

# Check local Redis
if ! redis-cli -h "$LOCAL_REDIS_HOST" -p "$LOCAL_REDIS_PORT" ping | grep -q PONG; then
  echo "✖  Local Redis is not reachable at $LOCAL_REDIS_HOST:$LOCAL_REDIS_PORT." && exit 1
fi

success "Preflight checks passed."

# ---------------------------------------------------------------------------
# Step 1: Dump Postgres from Docker container
# ---------------------------------------------------------------------------
info "Dumping Postgres data from Docker container '$DOCKER_DB_CONTAINER'..."

docker exec -e PGPASSWORD="$DOCKER_DB_PASSWORD" "$DOCKER_DB_CONTAINER" \
  pg_dump -U "$DOCKER_DB_USER" -d "$DOCKER_DB_NAME" \
  --no-owner --no-acl --clean --if-exists \
  > "$DUMP_FILE"

success "Dump saved to $DUMP_FILE ($(du -sh "$DUMP_FILE" | cut -f1))"

# ---------------------------------------------------------------------------
# Step 2: Restore into local Postgres
# ---------------------------------------------------------------------------
info "Restoring into local Postgres ($LOCAL_DB_NAME @ $LOCAL_DB_HOST:$LOCAL_DB_PORT)..."

# Ensure local DB exists
PGPASSWORD="$LOCAL_DB_PASSWORD" psql -h "$LOCAL_DB_HOST" -p "$LOCAL_DB_PORT" \
  -U "$LOCAL_DB_USER" -d postgres \
  -c "CREATE DATABASE $LOCAL_DB_NAME;" 2>/dev/null || \
    warn "Database '$LOCAL_DB_NAME' already exists — data will be overwritten."

PGPASSWORD="$LOCAL_DB_PASSWORD" psql -h "$LOCAL_DB_HOST" -p "$LOCAL_DB_PORT" \
  -U "$LOCAL_DB_USER" -d "$LOCAL_DB_NAME" \
  -f "$DUMP_FILE" \
  --quiet

success "Postgres data restored into local '$LOCAL_DB_NAME'."

# ---------------------------------------------------------------------------
# Step 3: Migrate Redis data
# ---------------------------------------------------------------------------
info "Migrating Redis data from Docker container '$DOCKER_REDIS_CONTAINER'..."

# Dump Redis RDB from the container and restore it locally
REDIS_DUMP_FILE="/tmp/wallet_redis_dump.rdb"
LOCAL_REDIS_DIR=$(redis-cli -h "$LOCAL_REDIS_HOST" -p "$LOCAL_REDIS_PORT" CONFIG GET dir | tail -1)
LOCAL_REDIS_DBFILENAME=$(redis-cli -h "$LOCAL_REDIS_HOST" -p "$LOCAL_REDIS_PORT" CONFIG GET dbfilename | tail -1)

# Trigger BGSAVE in Docker Redis to get a fresh RDB
docker exec "$DOCKER_REDIS_CONTAINER" \
  sh -c "REDISCLI_AUTH='$DOCKER_REDIS_PASSWORD' redis-cli BGSAVE"
sleep 2  # let the save complete

# Copy the RDB file out of the container
DOCKER_REDIS_DIR=$(docker exec "$DOCKER_REDIS_CONTAINER" \
  sh -c "REDISCLI_AUTH='$DOCKER_REDIS_PASSWORD' redis-cli CONFIG GET dir" | tail -1)

docker cp "$DOCKER_REDIS_CONTAINER:$DOCKER_REDIS_DIR/dump.rdb" "$REDIS_DUMP_FILE"

# Shut local Redis down, swap the RDB, restart it
info "Swapping local Redis RDB file (requires local redis-server write access)..."

if [[ -n "$LOCAL_REDIS_DIR" && -n "$LOCAL_REDIS_DBFILENAME" ]]; then
  # Flush local Redis and import via redis-cli --pipe isn't ideal for RDB;
  # instead copy the RDB file in place then restart.
  redis-cli -h "$LOCAL_REDIS_HOST" -p "$LOCAL_REDIS_PORT" SHUTDOWN NOSAVE 2>/dev/null || true
  sleep 1
  cp "$REDIS_DUMP_FILE" "$LOCAL_REDIS_DIR/$LOCAL_REDIS_DBFILENAME"
  success "RDB file copied to $LOCAL_REDIS_DIR/$LOCAL_REDIS_DBFILENAME"
  warn "Redis was shut down. Restart it with: brew services restart redis  (or however you manage it)"
else
  warn "Could not determine local Redis data directory."
  warn "Manually copy $REDIS_DUMP_FILE to your Redis data dir and restart Redis."
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "============================================================"
echo " Migration complete!"
echo "============================================================"
echo " Postgres : $LOCAL_DB_NAME @ $LOCAL_DB_HOST:$LOCAL_DB_PORT"
echo " Redis    : $LOCAL_REDIS_HOST:$LOCAL_REDIS_PORT (restart required)"
echo ""
echo " Next steps:"
echo "   1. brew services restart redis   (if Redis was shut down)"
echo "   2. pnpm dev                      (start the API)"
echo "   3. pnpm worker:dev               (start the worker)"
echo "============================================================"
