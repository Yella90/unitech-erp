#!/usr/bin/env node
const crypto = require("crypto");
const { Pool } = require("pg");
require("dotenv").config();

const DEMO_EMAIL = "demo@gmail.com";
const TARGET_SOLDE = 2_000_000;
const BUFFER = 100_000;

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

    const [paiementsRow, depensesRow, salairesRow, retraitsRow] = await Promise.all([
      client.query("SELECT COALESCE(SUM(montant), 0) AS total FROM paiements WHERE school_id = $1", [schoolId]),
      client.query("SELECT COALESCE(SUM(montant), 0) AS total FROM depenses WHERE school_id = $1", [schoolId]),
      client.query("SELECT COALESCE(SUM(montant), 0) AS total FROM salaires WHERE school_id = $1", [schoolId]),
      client.query("SELECT COALESCE(SUM(montant), 0) AS total FROM retraits_promoteur WHERE school_id = $1", [schoolId])
    ]);

    const entrees = Number(paiementsRow.rows[0].total || 0);
    const sorties = Number(depensesRow.rows[0].total || 0)
      + Number(salairesRow.rows[0].total || 0)
      + Number(retraitsRow.rows[0].total || 0);
    const solde = entrees - sorties;
    const desired = TARGET_SOLDE + BUFFER;

    if (solde >= desired) {
      console.log(`Solde already OK: ${solde}`);
      return;
    }

    const delta = desired - solde;
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    await client.query(
      `
        INSERT INTO paiements (
          school_id, eleve_matricule, montant, mois, date_payement, mode_payement, annee_scolaire, uuid, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, 'virement', $6, $7, $8)
      `,
      [
        schoolId,
        "DEMO-BOOST",
        Math.ceil(delta),
        monthKey,
        now.toISOString().slice(0, 10),
        `${now.getFullYear()}-${now.getFullYear() + 1}`,
        crypto.randomUUID(),
        now.toISOString()
      ]
    );

    console.log(`Added demo boost paiement: ${Math.ceil(delta)}. New solde target >= ${desired}.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Boost demo balance failed:", err.message || err);
  process.exitCode = 1;
});
