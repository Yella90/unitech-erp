const { Pool } = require("pg");
const { all, get, run } = require("../../utils/dbAsync");

const TABLES = [
  "classes",
  "eleves",
  "paiements",
  "notes",
  "enseignants",
  "personnel",
  "depenses",
  "salaires",
  "matieres",
  "affectations",
  "emplois",
  "notifications",
  "retraits_promoteur",
  "saas_subscriptions"
];
const localSqlite = String(process.env.DB_CLIENT || "").trim().toLowerCase() !== "postgres";
const centralUrl = String(
  process.env.CENTRAL_DATABASE_URL || process.env.DATABASE_URL || ""
).trim();
const centralSsl = String(
  process.env.CENTRAL_PGSSL || process.env.PGSSL || "true"
).trim().toLowerCase() === "true";

function parseNetworkFamily() {
  const raw = String(process.env.PG_FAMILY || "").trim().toLowerCase();
  if (!raw || raw === "0" || raw === "auto") return 0;
  const n = Number(raw);
  if (n === 4 || n === 6) return n;
  return 0;
}

let pool = null;
const centralColumnsCache = new Map();
const syncStatus = {
  mode: localSqlite ? "sqlite" : "postgres",
  centralConfigured: Boolean(centralUrl),
  connected: false,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null
};

function isEnabled() {
  return localSqlite && Boolean(centralUrl);
}

function getPool() {
  if (!pool) {
    const family = parseNetworkFamily();
    const cfg = {
      connectionString: centralUrl,
      ssl: centralSsl ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: Number(process.env.CENTRAL_PG_CONNECT_TIMEOUT_MS || 10_000)
    };
    if (family) cfg.family = family;
    pool = new Pool(cfg);
  }
  return pool;
}

async function getCentralColumns(tableName) {
  const cacheKey = String(tableName || "").trim().toLowerCase();
  if (centralColumnsCache.has(cacheKey)) return centralColumnsCache.get(cacheKey);
  const p = getPool();
  const q = await p.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
    `,
    [cacheKey]
  );
  const cols = new Set((q.rows || []).map((r) => String(r.column_name || "").trim()).filter(Boolean));
  centralColumnsCache.set(cacheKey, cols);
  return cols;
}

function pickTimestampColumn(columns) {
  if (columns.has("updated_at")) return "updated_at";
  if (columns.has("created_at")) return "created_at";
  return null;
}

async function pingCentral() {
  if (!isEnabled()) return false;
  const p = getPool();
  const q = await p.query("SELECT 1 AS ok");
  return !!(q.rows && q.rows[0] && Number(q.rows[0].ok) === 1);
}

function dateScore(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  const raw = String(value || "").trim();
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n > 10_000_000_000 ? n : n * 1000;
  }
  const ts = Date.parse(String(value || ""));
  return Number.isNaN(ts) ? 0 : ts;
}

function normalizeTimestampForPg(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();

  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      const ms = n > 10_000_000_000 ? n : n * 1000;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
  }

  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return raw;
  return new Date(parsed).toISOString();
}

function normalizeSyncCursor(value) {
  const ts = normalizeTimestampForPg(value);
  return ts || "1970-01-01T00:00:00.000Z";
}

function shouldNormalizeTemporalField(key) {
  const k = String(key || "").trim().toLowerCase();
  if (!k) return false;
  if (/_at$/.test(k)) return true;
  if (/^date($|_)/.test(k)) return true;
  if (/_date$/.test(k)) return true;
  if (/_time$/.test(k)) return true;
  return false;
}

async function setTriggersDisabled(value) {
  await run("UPDATE sync_runtime SET triggers_disabled = ? WHERE id = 1", [value ? 1 : 0]);
}

async function getLocalSchoolIds() {
  const rows = await all("SELECT id FROM schools ORDER BY id ASC");
  return (rows || [])
    .map((r) => Number(r.id))
    .filter((n) => Number.isFinite(n) && n > 0);
}

async function getLocalColumns(tableName) {
  const rows = await all(`PRAGMA table_info(${tableName})`);
  return (rows || []).map((r) => String(r.name || "").trim()).filter(Boolean);
}

async function getLocalByUuid(tableName, uuid) {
  return get(`SELECT * FROM ${tableName} WHERE uuid = ? LIMIT 1`, [uuid]);
}

async function getCentralByUuid(tableName, uuid) {
  const cols = await getCentralColumns(tableName);
  if (!cols.has("uuid")) return null;
  const p = getPool();
  const q = await p.query(`SELECT * FROM ${tableName} WHERE uuid = $1 LIMIT 1`, [uuid]);
  return q.rows && q.rows[0] ? q.rows[0] : null;
}

function filterPayloadByColumns(payload, columns, options = {}) {
  const skipKeys = new Set(options.skipKeys || []);
  const out = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (skipKeys.has(key)) continue;
    if (!columns.has(key)) continue;
    if (value === undefined) continue;
    if (shouldNormalizeTemporalField(key)) {
      out[key] = normalizeTimestampForPg(value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

async function upsertCentralFromLocal(tableName, localRow, op) {
  const p = getPool();
  const cols = await getCentralColumns(tableName);
  if (!cols.has("uuid")) return;
  const centralRow = await getCentralByUuid(tableName, localRow.uuid);
  const tsCol = pickTimestampColumn(cols);

  if (op === "delete") {
    if (!centralRow) return;
    const deletedAt = localRow.deleted_at || localRow.updated_at || new Date().toISOString();
    const sets = [];
    const values = [];
    if (cols.has("deleted_at")) {
      sets.push(`deleted_at = $${values.length + 1}`);
      values.push(deletedAt);
    }
    if (tsCol) {
      sets.push(`${tsCol} = $${values.length + 1}`);
      values.push(deletedAt);
    }
    if (!sets.length) return;
    values.push(localRow.uuid);
    await p.query(
      `UPDATE ${tableName} SET ${sets.join(", ")} WHERE uuid = $${values.length}`,
      values
    );
    return;
  }

  if (!centralRow) {
    const payload = filterPayloadByColumns(localRow, cols, { skipKeys: ["id"] });
    const keys = Object.keys(payload);
    if (!keys.length) return;
    const placeholders = keys.map((_, i) => `$${i + 1}`);
    const values = keys.map((k) => payload[k]);
    await p.query(
      `INSERT INTO ${tableName} (${keys.join(",")}) VALUES (${placeholders.join(",")})`,
      values
    );
    return;
  }

  const localUpdated = dateScore(localRow.updated_at || localRow.created_at);
  const centralUpdated = dateScore((tsCol && centralRow[tsCol]) || centralRow.updated_at || centralRow.created_at);
  if (localUpdated < centralUpdated) {
    // Central is newer: local will be refreshed by pull step.
    return;
  }

  const payload = filterPayloadByColumns(localRow, cols, { skipKeys: ["id"] });
  const keys = Object.keys(payload);
  if (!keys.length) return;
  const setSql = keys.map((k, i) => `${k} = $${i + 1}`).join(",");
  const values = keys.map((k) => payload[k]);
  values.push(localRow.uuid);
  await p.query(
    `UPDATE ${tableName} SET ${setSql} WHERE uuid = $${values.length}`,
    values
  );
}

async function upsertLocalFromCentral(tableName, centralRow) {
  const localColumns = await getLocalColumns(tableName);
  const payload = {};
  for (const key of localColumns) {
    if (key === "id") continue;
    if (centralRow[key] !== undefined) payload[key] = centralRow[key];
  }
  if (!payload.uuid) return;

  const existing = await getLocalByUuid(tableName, payload.uuid);
  if (!existing) {
    const keys = Object.keys(payload);
    const placeholders = keys.map(() => "?");
    const values = keys.map((k) => payload[k]);
    await run(
      `INSERT INTO ${tableName} (${keys.join(",")}) VALUES (${placeholders.join(",")})`,
      values
    );
    return;
  }

  const localUpdated = dateScore(existing.updated_at);
  const centralUpdated = dateScore(payload.updated_at);
  if (centralUpdated < localUpdated) return;

  const keys = Object.keys(payload).filter((k) => k !== "id");
  const setSql = keys.map((k) => `${k} = ?`).join(",");
  const values = keys.map((k) => payload[k]);
  values.push(payload.uuid);
  await run(`UPDATE ${tableName} SET ${setSql} WHERE uuid = ?`, values);
}

async function processPushQueue() {
  if (TABLES.length) {
    const unsupported = TABLES.map(() => "?").join(",");
    await run(
      `
        UPDATE sync_queue
        SET status = 'synced',
            last_error = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE status IN ('pending', 'failed')
          AND table_name NOT IN (${unsupported})
      `,
      TABLES
    );
  }

  const pending = await all(
    `
      SELECT id, school_id, table_name, operation, uuid
      FROM sync_queue
      WHERE status IN ('pending', 'failed') AND retry_count < 8
      ORDER BY id ASC
      LIMIT 200
    `
  );

  for (const item of pending || []) {
    try {
      if (!TABLES.includes(item.table_name)) {
        await run("UPDATE sync_queue SET status = 'synced', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [item.id]);
        continue;
      }

      const localRow = await get(
        `SELECT * FROM ${item.table_name} WHERE school_id = ? AND uuid = ? LIMIT 1`,
        [item.school_id, item.uuid]
      );

      if (item.table_name === "users" && localRow && String(localRow.role || "").toLowerCase() === "superadmin") {
        await run("UPDATE sync_queue SET status = 'synced', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [item.id]);
        continue;
      }

      const tombstone = item.operation === "delete" && !localRow
        ? { uuid: item.uuid, school_id: item.school_id, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        : null;
      const payload = localRow || tombstone;
      if (!payload) {
        await run("UPDATE sync_queue SET status = 'synced', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [item.id]);
        continue;
      }

      await upsertCentralFromLocal(item.table_name, payload, item.operation);
      await run("UPDATE sync_queue SET status = 'synced', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [item.id]);
    } catch (err) {
      await run(
        `
          UPDATE sync_queue
          SET status = 'failed',
              retry_count = retry_count + 1,
              last_error = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [String(err.message || err), item.id]
      );
    }
  }
}

async function getLastPulledAt(tableName) {
  const row = await get("SELECT last_pulled_at FROM sync_state WHERE table_name = ? LIMIT 1", [tableName]);
  return normalizeSyncCursor(row && row.last_pulled_at ? row.last_pulled_at : null);
}

async function setLastPulledAt(tableName, ts) {
  const normalizedTs = normalizeSyncCursor(ts);
  await run(
    `
      INSERT INTO sync_state (table_name, last_pulled_at)
      VALUES (?, ?)
      ON CONFLICT(table_name) DO UPDATE SET last_pulled_at = excluded.last_pulled_at
    `,
    [tableName, normalizedTs]
  );
}

async function pullFromCentral() {
  const p = getPool();
  const localSchoolIds = await getLocalSchoolIds();
  if (!localSchoolIds.length) return;

  await setTriggersDisabled(true);
  try {
    for (const tableName of TABLES) {
      // eslint-disable-next-line no-await-in-loop
      const cols = await getCentralColumns(tableName);
      if (!cols.size || !cols.has("uuid")) continue;
      const tsCol = pickTimestampColumn(cols);
      if (!tsCol) continue;
      const hasSchoolId = cols.has("school_id");

      const since = await getLastPulledAt(tableName);
      const q = hasSchoolId
        ? await p.query(
          `
            SELECT *
            FROM ${tableName}
            WHERE ${tsCol} IS NOT NULL
              AND ${tsCol} > $1
              AND school_id = ANY($2::bigint[])
            ORDER BY ${tsCol} ASC
            LIMIT 500
          `,
          [since, localSchoolIds]
        )
        : await p.query(
          `
            SELECT *
            FROM ${tableName}
            WHERE ${tsCol} IS NOT NULL
              AND ${tsCol} > $1
            ORDER BY ${tsCol} ASC
            LIMIT 500
          `,
          [since]
        );
      const rows = q.rows || [];
      let maxTs = since;
      for (const row of rows) {
        if (hasSchoolId) {
          const rowSchoolId = Number(row.school_id);
          if (!localSchoolIds.includes(rowSchoolId)) continue;
        }
        if (tableName === "users" && String(row.role || "").toLowerCase() === "superadmin") continue;
        // eslint-disable-next-line no-await-in-loop
        await upsertLocalFromCentral(tableName, row);
        const rowTs = normalizeSyncCursor(row[tsCol] || row.updated_at || row.created_at);
        if (dateScore(rowTs) > dateScore(maxTs)) {
          maxTs = rowTs;
        }
      }
      if (rows.length) {
        // eslint-disable-next-line no-await-in-loop
        await setLastPulledAt(tableName, maxTs);
      }
    }
  } finally {
    await setTriggersDisabled(false);
  }
}

async function syncTick() {
  if (!isEnabled()) {
    syncStatus.connected = false;
    syncStatus.lastError = null;
    return;
  }
  try {
    await pingCentral();
    await processPushQueue();
    await pullFromCentral();
    syncStatus.connected = true;
    syncStatus.lastSuccessAt = new Date().toISOString();
    syncStatus.lastError = null;
  } catch (err) {
    syncStatus.connected = false;
    syncStatus.lastErrorAt = new Date().toISOString();
    syncStatus.lastError = String(err.message || err);
    throw err;
  }
}

function getStatusSnapshot() {
  return {
    ...syncStatus,
    mode: localSqlite ? "sqlite" : "postgres",
    centralConfigured: Boolean(centralUrl)
  };
}

async function getQueueStats(schoolId) {
  const schoolValue = Number(schoolId || 0);
  const hasSchool = Number.isFinite(schoolValue) && schoolValue > 0;
  const whereSql = hasSchool ? "WHERE school_id = ?" : "";
  const args = hasSchool ? [schoolValue] : [];

  const row = await get(
    `
      SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 'synced' THEN 1 ELSE 0 END) AS synced,
        COUNT(*) AS total,
        MIN(CASE WHEN status = 'pending' THEN created_at ELSE NULL END) AS oldest_pending_at
      FROM sync_queue
      ${whereSql}
    `,
    args
  );

  return {
    pending: Number((row && row.pending) || 0),
    failed: Number((row && row.failed) || 0),
    synced: Number((row && row.synced) || 0),
    total: Number((row && row.total) || 0),
    oldestPendingAt: row && row.oldest_pending_at ? row.oldest_pending_at : null
  };
}

async function getRecentQueueErrors(schoolId, limit = 20) {
  const schoolValue = Number(schoolId || 0);
  const hasSchool = Number.isFinite(schoolValue) && schoolValue > 0;
  const whereSql = hasSchool
    ? "WHERE school_id = ? AND status = 'failed'"
    : "WHERE status = 'failed'";
  const args = hasSchool ? [schoolValue, Number(limit) || 20] : [Number(limit) || 20];
  return all(
    `
      SELECT id, school_id, table_name, operation, uuid, retry_count, last_error, updated_at
      FROM sync_queue
      ${whereSql}
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `,
    args
  );
}

async function getLastPulledState() {
  return all(
    `
      SELECT table_name, last_pulled_at
      FROM sync_state
      ORDER BY table_name ASC
    `
  );
}

async function getDetailedStatus(schoolId) {
  const [queue, recentErrors, pullState] = await Promise.all([
    getQueueStats(schoolId),
    getRecentQueueErrors(schoolId, 15),
    getLastPulledState()
  ]);

  return {
    ...getStatusSnapshot(),
    tables: [...TABLES],
    queue,
    recentErrors: recentErrors || [],
    pullState: pullState || []
  };
}

module.exports = {
  isEnabled,
  syncTick,
  getStatusSnapshot,
  getDetailedStatus
};
