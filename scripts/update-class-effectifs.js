#!/usr/bin/env node
const { Pool } = require("pg");
require("dotenv").config();

const DEMO_EMAIL = "demo@gmail.com";

async function main() {
  const centralUrl = String(process.env.CENTRAL_DATABASE_URL || process.env.DATABASE_URL || "").trim();
  const centralSsl = String(process.env.CENTRAL_PGSSL || process.env.PGSSL || "true").toLowerCase() === "true";
  if (!centralUrl) throw new Error("CENTRAL_DATABASE_URL required");

  const pool = new Pool({ connectionString: centralUrl, ssl: centralSsl ? { rejectUnauthorized: false } : false });
  const client = await pool.connect();
  try {
    const schoolRes = await client.query(
      "SELECT id FROM schools WHERE lower(trim(email)) = lower(trim($1)) LIMIT 1",
      [DEMO_EMAIL]
    );
    if (!schoolRes.rows[0]) throw new Error("Demo school not found");
    const schoolId = Number(schoolRes.rows[0].id);

    await client.query(
      `
        UPDATE classes c
        SET effectif = COALESCE((
          SELECT COUNT(*) FROM eleves e
          WHERE e.school_id = c.school_id
            AND lower(trim(e.classe)) = lower(trim(c.nom))
            AND e.deleted_at IS NULL
        ), 0)
        WHERE c.school_id = $1
      `,
      [schoolId]
    );

    console.log("Classes effectif updated for DEMO SCHOOL.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Update class effectifs failed:", err.message || err);
  process.exitCode = 1;
});
