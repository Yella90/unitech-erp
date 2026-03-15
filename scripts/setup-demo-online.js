#!/usr/bin/env node
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
require("dotenv").config();

const DEMO_EMAIL = "demo@gmail.com";
const DEMO_PASSWORD = "demo@";
const DEMO_SCHOOL_NAME = "DEMO ONLINE";
const DEMO_SCHOOL_PHONE = "";
const DEMO_SCHOOL_ADDRESS = "Acces en ligne (demo)";
const DEMO_PLAN = "premium";

const centralUrl = String(process.env.CENTRAL_DATABASE_URL || process.env.DATABASE_URL || "").trim();
const centralSsl = String(process.env.CENTRAL_PGSSL || process.env.PGSSL || "true").toLowerCase() === "true";

if (!centralUrl) {
  console.error("CENTRAL_DATABASE_URL (or DATABASE_URL) is required.");
  process.exit(1);
}

async function main() {
  const pool = new Pool({ connectionString: centralUrl, ssl: centralSsl ? { rejectUnauthorized: false } : false });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const schoolRes = await client.query(
      `
        INSERT INTO schools (name, email, phone, address, subscription_plan, is_active)
        VALUES ($1, $2, $3, $4, $5, 1)
        ON CONFLICT (email)
        DO UPDATE SET
          name = EXCLUDED.name,
          phone = EXCLUDED.phone,
          address = EXCLUDED.address,
          subscription_plan = EXCLUDED.subscription_plan,
          is_active = 1
        RETURNING id
      `,
      [DEMO_SCHOOL_NAME, DEMO_EMAIL, DEMO_SCHOOL_PHONE, DEMO_SCHOOL_ADDRESS, DEMO_PLAN]
    );
    const schoolId = Number(schoolRes.rows[0].id);

    const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
    await client.query(
      `
        INSERT INTO users (school_id, full_name, email, password_hash, role, is_active)
        VALUES ($1, $2, $3, $4, 'school_admin', 1)
        ON CONFLICT (email)
        DO UPDATE SET
          school_id = EXCLUDED.school_id,
          full_name = EXCLUDED.full_name,
          password_hash = EXCLUDED.password_hash,
          role = 'school_admin',
          is_active = 1
      `,
      [schoolId, "Demo Admin", DEMO_EMAIL, hash]
    );

    await client.query("COMMIT");
    console.log("Demo online account ready:");
    console.log(`  email: ${DEMO_EMAIL}`);
    console.log(`  password: ${DEMO_PASSWORD}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Setup demo online failed:", err.message || err);
  process.exitCode = 1;
});
