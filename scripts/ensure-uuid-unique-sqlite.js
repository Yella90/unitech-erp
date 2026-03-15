#!/usr/bin/env node
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
require("dotenv").config();

const sqlitePath = process.env.SQLITE_PATH
  ? path.resolve(process.env.SQLITE_PATH)
  : path.resolve(__dirname, "..", "database.sqlite");

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
  "saas_subscriptions",
  "public_visits",
  "users"
];

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

async function getColumnNames(db, table) {
  const rows = await all(db, `PRAGMA table_info(${table})`);
  return (rows || []).map((r) => String(r.name || "").trim());
}

async function hasColumn(db, table, column) {
  const cols = await getColumnNames(db, table);
  return cols.includes(column);
}

async function normalizeEmptyUuid(db, table) {
  await run(db, `UPDATE ${table} SET uuid = NULL WHERE TRIM(COALESCE(uuid, '')) = ''`);
}

async function dedupeUuid(db, table) {
  const cols = await getColumnNames(db, table);
  if (!cols.includes("uuid")) return;
  const hasUpdatedAt = cols.includes("updated_at");

  const dupes = await all(
    db,
    `SELECT uuid, COUNT(*) AS c
     FROM ${table}
     WHERE uuid IS NOT NULL
     GROUP BY uuid
     HAVING c > 1`
  );

  for (const row of dupes || []) {
    const uuid = row.uuid;
    const orderSql = hasUpdatedAt ? "ORDER BY updated_at DESC, id DESC" : "ORDER BY id DESC";
    const ids = await all(
      db,
      `SELECT id FROM ${table} WHERE uuid = ? ${orderSql}`,
      [uuid]
    );
    if (!ids.length) continue;
    const keepId = ids[0].id;
    const toUpdate = ids.slice(1).map((r) => r.id);
    if (!toUpdate.length) continue;
    for (const id of toUpdate) {
      await run(db, `UPDATE ${table} SET uuid = lower(hex(randomblob(16))) WHERE id = ?`, [id]);
    }
    console.log(`${table}: deduped uuid ${uuid} (kept id ${keepId}, updated ${toUpdate.length})`);
  }
}

async function main() {
  const db = new sqlite3.Database(sqlitePath);
  try {
    for (const table of TABLES) {
      // eslint-disable-next-line no-await-in-loop
      const hasUuid = await hasColumn(db, table, "uuid");
      if (!hasUuid) {
        console.log(`${table}: skipped (no uuid column)`);
        continue;
      }
      // Normalize and dedupe before adding strict unique index.
      // eslint-disable-next-line no-await-in-loop
      await normalizeEmptyUuid(db, table);
      // eslint-disable-next-line no-await-in-loop
      await dedupeUuid(db, table);
      const indexName = `idx_${table}_uuid_unique`;
      // eslint-disable-next-line no-await-in-loop
      await run(
        db,
        `CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${table} (uuid)`
      );
      console.log(`${table}: ensured unique uuid index`);
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error("Ensure uuid unique failed:", err.message || err);
  process.exitCode = 1;
});
