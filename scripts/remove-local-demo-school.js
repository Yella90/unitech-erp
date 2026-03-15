#!/usr/bin/env node
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
require("dotenv").config();

const sqlitePath = process.env.SQLITE_PATH
  ? path.resolve(process.env.SQLITE_PATH)
  : path.resolve(__dirname, "..", "database.sqlite");

const targetEmail = String(process.env.LOCAL_DEMO_EMAIL || "demo@school.local").trim().toLowerCase();

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

async function main() {
  const db = new sqlite3.Database(sqlitePath);
  try {
    const school = await get(
      db,
      "SELECT id, name, email FROM schools WHERE lower(trim(email)) = ? LIMIT 1",
      [targetEmail]
    );
    if (!school) {
      console.log(`No local school found for ${targetEmail}`);
      return;
    }
    const schoolId = Number(school.id);
    console.log(`Removing local school ${schoolId} (${school.name}, ${school.email})`);

    await run(db, "BEGIN TRANSACTION");
    // Order matters for FK constraints.
    await run(
      db,
      "DELETE FROM grades WHERE enrollment_id IN (SELECT id FROM enrollments WHERE ecole_id = ?)",
      [schoolId]
    );
    await run(db, "DELETE FROM transfers WHERE from_ecole_id = ? OR to_ecole_id = ?", [schoolId, schoolId]);
    await run(db, "DELETE FROM enrollments WHERE ecole_id = ?", [schoolId]);
    await run(db, "DELETE FROM activity_logs WHERE school_id = ?", [schoolId]);
    await run(db, "DELETE FROM notifications WHERE school_id = ?", [schoolId]);
    await run(db, "DELETE FROM sync_queue WHERE school_id = ?", [schoolId]);
    await run(db, "DELETE FROM public_visits WHERE school_id = ?", [schoolId]);
    await run(db, "DELETE FROM retraits_promoteur WHERE school_id = ?", [schoolId]);
    await run(db, "DELETE FROM saas_subscriptions WHERE school_id = ?", [schoolId]);
    await run(db, "DELETE FROM notes WHERE school_id = ?", [schoolId]);
    await run(db, "DELETE FROM paiements WHERE school_id = ?", [schoolId]);
    await run(db, "DELETE FROM depenses WHERE school_id = ?", [schoolId]);
    await run(db, "DELETE FROM salaires WHERE school_id = ?", [schoolId]);
    await run(db, "DELETE FROM affectations WHERE school_id = ?", [schoolId]);
    await run(db, "DELETE FROM emplois WHERE school_id = ?", [schoolId]);
    await run(db, "DELETE FROM matieres WHERE school_id = ?", [schoolId]);
    await run(db, "DELETE FROM eleves WHERE school_id = ?", [schoolId]);
    await run(db, "DELETE FROM enseignants WHERE school_id = ?", [schoolId]);
    await run(db, "DELETE FROM personnel WHERE school_id = ?", [schoolId]);
    await run(db, "DELETE FROM users WHERE school_id = ?", [schoolId]);
    await run(db, "DELETE FROM classes WHERE school_id = ?", [schoolId]);
    await run(db, "DELETE FROM schools WHERE id = ?", [schoolId]);
    await run(db, "COMMIT");
    console.log("Local demo school removed.");
  } catch (err) {
    try {
      await run(db, "ROLLBACK");
    } catch (_) {}
    throw err;
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error("Remove local demo failed:", err.message || err);
  process.exitCode = 1;
});
