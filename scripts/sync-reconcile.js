#!/usr/bin/env node
/**
 * Minimal bi-directional reconciliation between local SQLite and central Postgres.
 * Scope: tables with uuid + updated_at fields.
 */
const path = require("path");
const { Pool } = require("pg");
const sqlite3 = require("sqlite3").verbose();
require("dotenv").config();

const TABLES = ["schools", "users", "classes", "eleves", "paiements", "notifications"];

function assertEnv() {
  if (String(process.env.DB_CLIENT || "").trim().toLowerCase() !== "sqlite") {
    throw new Error("Reconcile only runs when DB_CLIENT=sqlite");
  }
  if (!process.env.CENTRAL_DATABASE_URL && !process.env.DATABASE_URL) {
    throw new Error("CENTRAL_DATABASE_URL (or DATABASE_URL) required for reconcile");
  }
}

function openLocal() {
  const sqlitePath = process.env.SQLITE_PATH
    ? path.resolve(process.env.SQLITE_PATH)
    : path.resolve(__dirname, "..", "database.sqlite");
  const db = new sqlite3.Database(sqlitePath);
  db.serialize(() => {
    db.run("PRAGMA foreign_keys = ON");
  });
  return db;
}

function openCentral() {
  const url = String(process.env.CENTRAL_DATABASE_URL || process.env.DATABASE_URL || "").trim();
  const ssl = String(process.env.CENTRAL_PGSSL || process.env.PGSSL || "true").toLowerCase() === "true";
  return new Pool({ connectionString: url, ssl: ssl ? { rejectUnauthorized: false } : false });
}

function allSqlite(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function hasSqliteUniqueOnColumn(db, table, column) {
  const indexes = await allSqlite(db, `PRAGMA index_list(${table})`);
  for (const idx of indexes || []) {
    if (Number(idx.unique) !== 1) continue;
    if (Object.prototype.hasOwnProperty.call(idx, "partial") && Number(idx.partial) === 1) continue;
    const info = await allSqlite(db, `PRAGMA index_info(${idx.name})`);
    const hasCol = (info || []).some((row) => String(row.name || "").trim() === column);
    if (hasCol) return true;
  }
  return false;
}

async function allPg(pool, sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows || [];
}

async function hasPgUniqueOnColumn(pool, table, column) {
  const q = await pool.query(
    `
      SELECT 1
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
      WHERE n.nspname = 'public'
        AND c.relname = $1
        AND i.indisunique = true
        AND i.indpred IS NULL
        AND a.attname = $2
      LIMIT 1
    `,
    [table, column]
  );
  return q.rows && q.rows.length > 0;
}

function upsertSqlite(db, table, row) {
  return (async () => {
    const cols = Object.keys(row);
    const placeholders = cols.map(() => "?").join(",");
    const values = cols.map((c) => row[c]);
    const hasUniqueUuid = await hasSqliteUniqueOnColumn(db, table, "uuid");
    if (hasUniqueUuid) {
      const updates = cols.map((c) => `${c}=excluded.${c}`).join(",");
      const sql = `INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders}) ON CONFLICT(uuid) DO UPDATE SET ${updates}`;
      return new Promise((resolve, reject) => {
        db.run(sql, values, function (err) {
          if (err) return reject(err);
          resolve(this.changes || 0);
        });
      });
    }
    const existing = await allSqlite(db, `SELECT id FROM ${table} WHERE uuid = ? LIMIT 1`, [row.uuid]);
    if (existing && existing[0]) {
      const updates = cols.map((c) => `${c}=?`).join(",");
      return new Promise((resolve, reject) => {
        db.run(`UPDATE ${table} SET ${updates} WHERE uuid = ?`, [...values, row.uuid], function (err) {
          if (err) return reject(err);
          resolve(this.changes || 0);
        });
      });
    }
    return new Promise((resolve, reject) => {
      db.run(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders})`, values, function (err) {
        if (err) return reject(err);
        resolve(this.changes || 0);
      });
    });
  })();
}

async function upsertPg(pool, table, row) {
  const cols = Object.keys(row);
  const placeholders = cols
    .map((c, i) => (c === "version" ? `CAST($${i + 1} AS INTEGER)` : `$${i + 1}`))
    .join(",");
  const updates = cols.map((c) => {
    if (c === "version") return `${c}=CAST(excluded.${c} AS INTEGER)`;
    return `${c}=excluded.${c}`;
  }).join(",");
  const values = cols.map((c) => {
    if (c === "version") {
      if (row[c] === null || row[c] === undefined || row[c] === "") return 1;
      const n = Number(row[c]);
      return Number.isFinite(n) ? n : 1;
    }
    return row[c];
  });
  const hasUniqueUuid = await hasPgUniqueOnColumn(pool, table, "uuid");
  if (hasUniqueUuid) {
    const sql = `
      INSERT INTO ${table} (${cols.join(",")})
      VALUES (${placeholders})
      ON CONFLICT (uuid) DO UPDATE SET ${updates}
    `;
    await pool.query(sql, values);
    return;
  }
  if (table === "users" && row.email) {
    const email = String(row.email || "").trim().toLowerCase();
    if (email) {
      const existingByEmail = await pool.query(
        `SELECT id FROM users WHERE lower(trim(email)) = $1 LIMIT 1`,
        [email]
      );
      if (existingByEmail.rows && existingByEmail.rows[0]) {
        const setSql = cols.map((c, i) => (c === "version" ? `${c} = CAST($${i + 1} AS INTEGER)` : `${c} = $${i + 1}`)).join(",");
        await pool.query(`UPDATE users SET ${setSql} WHERE lower(trim(email)) = $${cols.length + 1}`, [...values, email]);
        return;
      }
    }
  }
  // Fallback when no unique constraint exists on uuid.
  const existing = await pool.query(`SELECT id FROM ${table} WHERE uuid = $1 LIMIT 1`, [row.uuid]);
  if (existing.rows && existing.rows[0]) {
    const setSql = cols.map((c, i) => (c === "version" ? `${c} = CAST($${i + 1} AS INTEGER)` : `${c} = $${i + 1}`)).join(",");
    await pool.query(`UPDATE ${table} SET ${setSql} WHERE uuid = $${cols.length + 1}`, [...values, row.uuid]);
    return;
  }
  await pool.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders})`, values);
}

function normalizeRow(row) {
  const out = { ...row };
  for (const k of Object.keys(out)) {
    if (out[k] instanceof Date) out[k] = out[k].toISOString();
    if (k === "version") {
      if (out[k] === null || out[k] === undefined || out[k] === "") {
        out[k] = 1;
      } else {
        const n = Number(out[k]);
        out[k] = Number.isFinite(n) ? n : 1;
      }
    }
  }
  return out;
}

function pickColumns(rows) {
  return rows.map((r) => {
    const o = { ...r };
    delete o.id;
    return o;
  });
}

function hasSqliteColumn(db, table, column) {
  return new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info(${table})`, (err, rows) => {
      if (err) return reject(err);
      const cols = new Set((rows || []).map((r) => String(r.name || "").trim()));
      resolve(cols.has(column));
    });
  });
}

async function mapCentralSchoolIdToLocal(db, centralSchoolId) {
  const centralId = Number(centralSchoolId || 0);
  if (!Number.isFinite(centralId) || centralId <= 0) return null;
  const rows = await allSqlite(db, "SELECT id FROM schools WHERE central_school_id = ? LIMIT 1", [centralId]);
  if (rows && rows[0] && Number(rows[0].id) > 0) return Number(rows[0].id);
  const fallback = await allSqlite(db, "SELECT id FROM schools WHERE id = ? LIMIT 1", [centralId]);
  if (fallback && fallback[0] && Number(fallback[0].id) > 0) return Number(fallback[0].id);
  return null;
}

async function mapLocalSchoolIdToCentral(db, localSchoolId) {
  const localId = Number(localSchoolId || 0);
  if (!Number.isFinite(localId) || localId <= 0) return null;
  const rows = await allSqlite(db, "SELECT central_school_id FROM schools WHERE id = ? LIMIT 1", [localId]);
  const central = rows && rows[0] ? Number(rows[0].central_school_id) : null;
  if (Number.isFinite(central) && central > 0) return central;
  return localId;
}

async function reconcileTable(db, pool, table) {
  const hasUuid = await hasSqliteColumn(db, table, "uuid");
  if (!hasUuid) {
    return { table, pushed: 0, pulled: 0, skipped: true };
  }
  const localRows = await allSqlite(
    db,
    `SELECT * FROM ${table} WHERE uuid IS NOT NULL AND TRIM(uuid) <> ''`
  );
  const remoteRows = await allPg(
    pool,
    `SELECT * FROM ${table} WHERE uuid IS NOT NULL AND TRIM(uuid) <> ''`
  );

  const localMap = new Map(pickColumns(localRows).map((r) => [String(r.uuid), normalizeRow(r)]));
  const remoteMap = new Map(pickColumns(remoteRows).map((r) => [String(r.uuid), normalizeRow(r)]));

  let pulled = 0;
  let pushed = 0;

  // push missing/older to central
  for (const [uuid, row] of localMap) {
    if (row.school_id !== undefined) {
      // eslint-disable-next-line no-await-in-loop
      const mapped = await mapLocalSchoolIdToCentral(db, row.school_id);
      if (!mapped) continue;
      row.school_id = mapped;
    }
    const remote = remoteMap.get(uuid);
    if (!remote) {
      await upsertPg(pool, table, row);
      pushed += 1;
      continue;
    }
    if (new Date(row.updated_at || row.created_at || 0) > new Date(remote.updated_at || remote.created_at || 0)) {
      await upsertPg(pool, table, row);
      pushed += 1;
    }
  }

  // pull missing/older to local
  for (const [uuid, row] of remoteMap) {
    if (row.school_id !== undefined) {
      // eslint-disable-next-line no-await-in-loop
      const mapped = await mapCentralSchoolIdToLocal(db, row.school_id);
      if (!mapped) continue;
      row.school_id = mapped;
    }
    const local = localMap.get(uuid);
    if (!local) {
      pulled += await upsertSqlite(db, table, row);
      continue;
    }
    if (new Date(row.updated_at || row.created_at || 0) > new Date(local.updated_at || local.created_at || 0)) {
      pulled += await upsertSqlite(db, table, row);
    }
  }

  return { table, pushed, pulled, skipped: false };
}

async function main() {
  assertEnv();
  const db = openLocal();
  const pool = openCentral();
  const results = [];
  try {
    for (const table of TABLES) {
      try {
        const r = await reconcileTable(db, pool, table);
        results.push(r);
        if (r.skipped) {
          console.log(`${table}: skipped (no uuid column)`);
        } else {
          console.log(`${table}: pushed ${r.pushed}, pulled ${r.pulled}`);
        }
      } catch (err) {
        console.error(`Reconcile error on table ${table}:`, err.message || err);
        throw err;
      }
    }
  } finally {
    db.close();
    await pool.end();
  }
  return results;
}

main()
  .then(() => {
    console.log("Reconcile completed");
  })
  .catch((err) => {
    console.error("Reconcile failed:", err.message);
    process.exitCode = 1;
  });
