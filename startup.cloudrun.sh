#!/usr/bin/env bash
# Cloud Run entrypoint for Keystone Core API.
#
# Differs from startup.relational.dev.sh:
# - No wait-for-it: Cloud SQL Auth Proxy makes the DB socket available immediately.
# - Migrations are still run (idempotent — TypeORM tracks applied migrations).
# - Seeds are still run (idempotent — built-in checks skip existing rows).
# - Uses start:prod (the compiled dist/) instead of dev mode.
#
# This file is invoked as the Cloud Run container CMD. The image itself is the
# same as the local docker-compose image; only the startup command differs.

set -e

# The Dockerfile copies env-example-relational to .env at build time as a fallback.
# env-cmd (used by npm scripts) loads that .env and overrides our Cloud Run process
# env vars — including parsing inline comments as part of values (e.g., DATABASE_HOST
# would become 'postgres  # In production: ...'). Truncate to empty so env-cmd
# loads nothing and process.env wins.
: > /usr/src/app/.env

echo "[cloudrun-startup] Running TypeORM migrations against Cloud SQL..."
npm run migration:run

echo "[cloudrun-startup] Running relational seeds (idempotent)..."
npm run seed:run:relational

echo "[cloudrun-startup] Starting NestJS server (start:prod)..."
exec npm run start:prod
