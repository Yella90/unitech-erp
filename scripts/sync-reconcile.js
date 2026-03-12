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

async function allPg(pool, sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows || [];
}

function upsertSqlite(db, table, row) {
  const cols = Object.keys(row);
  const placeholders = cols.map(() => "?").join(",");
  const updates = cols.map((c) => `${c}=excluded.${c}`).join(",");
  const sql = `INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders}) ON CONFLICT(uuid) DO UPDATE SET ${updates}`;
  return new Promise((resolve, reject) => {
    db.run(sql, cols.map((c) => row[c]), function (err) {
      if (err) return reject(err);
      resolve(this.changes || 0);
    });
  });
}

async function upsertPg(pool, table, row) {
  const cols = Object.keys(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
  const updates = cols.map((c) => `${c}=excluded.${c}`).join(",");
  const sql = `
    INSERT INTO ${table} (${cols.join(",")})
    VALUES (${placeholders})
    ON CONFLICT (uuid) DO UPDATE SET ${updates}
  `;
  await pool.query(sql, cols.map((c) => row[c]));
}

function normalizeRow(row) {
  const out = { ...row };
  for (const k of Object.keys(out)) {
    if (out[k] instanceof Date) out[k] = out[k].toISOString();
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

async function reconcileTable(db, pool, table) {
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
    const local = localMap.get(uuid);
    if (!local) {
      pulled += await upsertSqlite(db, table, row);
      continue;
    }
    if (new Date(row.updated_at || row.created_at || 0) > new Date(local.updated_at || local.created_at || 0)) {
      pulled += await upsertSqlite(db, table, row);
    }
  }

  return { table, pushed, pulled };
}

async function main() {
  assertEnv();
  const db = openLocal();
  const pool = openCentral();
  const results = [];
  try {
    for (const table of TABLES) {
      const r = await reconcileTable(db, pool, table);
      results.push(r);
      console.log(`${table}: pushed ${r.pushed}, pulled ${r.pulled}`);
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
