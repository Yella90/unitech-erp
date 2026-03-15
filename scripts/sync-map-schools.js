#!/usr/bin/env node
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { Pool } = require("pg");
require("dotenv").config();

const sqlitePath = process.env.SQLITE_PATH
  ? path.resolve(process.env.SQLITE_PATH)
  : path.resolve(__dirname, "..", "database.sqlite");
const centralUrl = String(process.env.CENTRAL_DATABASE_URL || process.env.DATABASE_URL || "").trim();
const centralSsl = String(process.env.CENTRAL_PGSSL || process.env.PGSSL || "true").toLowerCase() === "true";

if (!centralUrl) {
  console.error("CENTRAL_DATABASE_URL (or DATABASE_URL) is required.");
  process.exit(1);
}

const db = new sqlite3.Database(sqlitePath);
const pool = new Pool({ connectionString: centralUrl, ssl: centralSsl ? { rejectUnauthorized: false } : false });

function allSqlite(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function runSqlite(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

async function main() {
  const localSchools = await allSqlite("SELECT id, email FROM schools WHERE email IS NOT NULL AND TRIM(email) <> ''");
  let updated = 0;

  for (const row of localSchools) {
    const email = String(row.email || "").trim().toLowerCase();
    if (!email) continue;
    // eslint-disable-next-line no-await-in-loop
    const q = await pool.query("SELECT id FROM schools WHERE lower(trim(email)) = $1 LIMIT 1", [email]);
    const centralId = q.rows && q.rows[0] ? Number(q.rows[0].id) : 0;
    if (centralId > 0) {
      // eslint-disable-next-line no-await-in-loop
      await runSqlite("UPDATE schools SET central_school_id = ? WHERE id = ?", [centralId, row.id]);
      updated += 1;
      console.log(`Mapped school ${row.id} (${email}) -> central ${centralId}`);
    } else {
      console.log(`No central match for ${email}`);
    }
  }

  console.log(`Done. Updated ${updated} school(s).`);
}

main()
  .catch((err) => {
    console.error("Mapping failed:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    db.close();
    await pool.end();
  });
