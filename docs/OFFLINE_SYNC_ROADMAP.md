# Offline-First + Sync Roadmap (Implemented Foundation)

## Delivered in this step

1. Clean API architecture under `server/`
- `server/controllers`
- `server/services`
- `server/models`
- `server/routes`
- `server/middleware`

2. UUID + sync metadata
- Added `uuid`, `updated_at`, `deleted_at`, `version` on:
  - `classes`
  - `eleves`
  - `paiements`
  - `notes`
  - `enseignants`
  - `personnel`
- Added backfill updates for existing rows.

3. Sync queue
- New table `sync_queue` (SQLite + PostgreSQL bootstrap).
- API endpoints:
  - `GET /api/v1/sync/queue`
  - `POST /api/v1/sync/queue`
  - `POST /api/v1/sync/queue/:id/ack`
- Background worker resets retriable failed items to pending.

4. Conflict strategy v1
- `Last Write Wins` on `updated_at` in API services.

5. Security baseline for API
- Bearer token endpoint: `POST /api/v1/auth/token`
- School API key enforcement (`x-school-key`) for school-scoped API routes.
- Basic API rate-limiting middleware.
- Activity logs for API write actions.

6. Desktop + backups scaffolding
- Electron files:
  - `electron/main.js`
  - `electron/preload.js`
- Backup scripts:
  - `scripts/backup-sqlite.ps1`
  - `scripts/backup-postgres.ps1`
- School API key generation script:
  - `scripts/generate-school-api-key.js <school_id>`

## New API routes

- `GET /api/v1/health`
- `POST /api/v1/auth/token`
- `GET|POST|PATCH|DELETE /api/v1/classes`
- `GET|POST|PATCH|DELETE /api/v1/eleves`
- `GET|POST /api/v1/sync/queue`
- `POST /api/v1/sync/queue/:id/ack`

## Setup commands

```bash
npm install
npm run start
```

Generate an API key for a school:

```bash
npm run db:school:key -- 1
```

Run local backup:

```bash
npm run backup:sqlite
```

## Next iterations (recommended)

1. Extend API v1 to remaining entities (`notes`, `paiements`, `personnel`, `enseignants`).
2. Add real sync push/pull with central server (idempotent upsert + checkpoint cursors).
3. Implement refresh token flow and token revocation.
4. Add distributed rate limiting (Redis) for national-scale deployment.
5. Add conflict dashboard for manual resolution on critical entities.
