#!/usr/bin/env node
const crypto = require("crypto");
const { Pool } = require("pg");
require("dotenv").config();

const DEMO_EMAIL = "demo@gmail.com";
const SCHOOL_YEAR = "2025-2026";
const MONTHS_BACK = 5;
const MIN_ELEVES_PER_CLASS = 10;

const maleFirst = ["Moussa", "Ibrahim", "Seydou", "Adama", "Oumar", "Boubacar", "Cheick", "Mahamadou", "Amadou", "Yacouba"];
const femaleFirst = ["Aminata", "Awa", "Mariam", "Fatoumata", "Assitan", "Hawa", "Kadiatou", "Fanta", "Sira", "Aissata"];
const lastNames = ["Traore", "Keita", "Diakite", "Coulibaly", "Diarra", "Sangare", "Camara", "Doumbia", "Toure", "Konate"];

const classesSeed = [
  { nom: "6e A", niveau: "6e", cycle: "Fondamental" },
  { nom: "6e B", niveau: "6e", cycle: "Fondamental" },
  { nom: "5e A", niveau: "5e", cycle: "Fondamental" },
  { nom: "5e B", niveau: "5e", cycle: "Fondamental" },
  { nom: "4e A", niveau: "4e", cycle: "Secondaire" },
  { nom: "3e A", niveau: "3e", cycle: "Secondaire" }
];

const matieresSeed = [
  "Mathématiques",
  "Français",
  "Physique",
  "Chimie",
  "SVT",
  "Histoire",
  "Géographie",
  "Anglais",
  "EPS",
  "Informatique"
];

const personnelSeed = [
  { role: "Secretaire", full_name: "Awa Traore" },
  { role: "Comptable", full_name: "Boubacar Keita" },
  { role: "Surveillant", full_name: "Mariam Diarra" },
  { role: "Gestionnaire", full_name: "Seydou Coulibaly" }
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDateBetween(start, end) {
  const ts = start.getTime() + Math.random() * (end.getTime() - start.getTime());
  return new Date(ts);
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function rangeMonths(back) {
  const out = [];
  const now = new Date();
  for (let i = back - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(d);
  }
  return out;
}

async function main() {
  const centralUrl = String(process.env.CENTRAL_DATABASE_URL || process.env.DATABASE_URL || "").trim();
  const centralSsl = String(process.env.CENTRAL_PGSSL || process.env.PGSSL || "true").toLowerCase() === "true";
  if (!centralUrl) throw new Error("CENTRAL_DATABASE_URL required");

  const pool = new Pool({ connectionString: centralUrl, ssl: centralSsl ? { rejectUnauthorized: false } : false });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const schoolRes = await client.query(
      "SELECT id FROM schools WHERE lower(trim(email)) = lower(trim($1)) LIMIT 1",
      [DEMO_EMAIL]
    );
    if (!schoolRes.rows[0]) throw new Error("Demo school not found");
    const schoolId = Number(schoolRes.rows[0].id);

    // Clean demo data (school-scoped tables).
    const cleanupTables = [
      "notes",
      "paiements",
      "depenses",
      "salaires",
      "emplois",
      "affectations",
      "matieres",
      "eleves",
      "enseignants",
      "personnel",
      "classes",
      "notifications",
      "retraits_promoteur",
      "public_visits"
    ];
    for (const table of cleanupTables) {
      // eslint-disable-next-line no-await-in-loop
      await client.query(`DELETE FROM ${table} WHERE school_id = $1`, [schoolId]);
    }

    // Classes
    const classRows = [];
    for (const c of classesSeed) {
      const uuid = crypto.randomUUID();
      const res = await client.query(
        `
          INSERT INTO classes (school_id, nom, cycle, niveau, annee, mensuel, frais_inscription, effectif_max, uuid, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (school_id, nom) DO UPDATE SET
            cycle = EXCLUDED.cycle,
            niveau = EXCLUDED.niveau,
            annee = EXCLUDED.annee,
            mensuel = EXCLUDED.mensuel,
            frais_inscription = EXCLUDED.frais_inscription,
            effectif_max = EXCLUDED.effectif_max,
            updated_at = EXCLUDED.updated_at
          RETURNING id, nom
        `,
        [schoolId, c.nom, c.cycle, c.niveau, SCHOOL_YEAR, 20000, 5000, 60, uuid, new Date().toISOString()]
      );
      classRows.push(res.rows[0]);
    }

    // Matieres
    const matieresRows = [];
    for (const name of matieresSeed) {
      const uuid = crypto.randomUUID();
      const res = await client.query(
        `
          INSERT INTO matieres (school_id, nom, coefficient, uuid, updated_at)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (school_id, nom) DO UPDATE SET
            coefficient = EXCLUDED.coefficient,
            updated_at = EXCLUDED.updated_at
          RETURNING id, nom
        `,
        [schoolId, name, 1, uuid, new Date().toISOString()]
      );
      matieresRows.push(res.rows[0]);
    }

    // Enseignants
    const enseignantsRows = [];
    for (let i = 0; i < 7; i += 1) {
      const full_name = `${pick(maleFirst)} ${pick(lastNames)}`;
      const matricule = `ENS-${String(i + 1).padStart(3, "0")}`;
      const matiere = pick(matieresSeed);
      const uuid = crypto.randomUUID();
      const res = await client.query(
        `
          INSERT INTO enseignants (school_id, matricule, full_name, email, phone, matiere, status, type_payement, salaire_base, taux_horaire, uuid, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'actif', 'mensuel', $7, $8, $9, $10)
          RETURNING id, matricule, matiere
        `,
        [schoolId, matricule, full_name, "", "", matiere, 150000, 0, uuid, new Date().toISOString()]
      );
      enseignantsRows.push(res.rows[0]);
    }

    // Personnel
    const personnelRows = [];
    for (let i = 0; i < personnelSeed.length; i += 1) {
      const p = personnelSeed[i];
      const matricule = `PER-${String(i + 1).padStart(3, "0")}`;
      const uuid = crypto.randomUUID();
      const res = await client.query(
        `
          INSERT INTO personnel (school_id, matricule, full_name, role, type_personnel, type_payement, salaire_base, statut, uuid, updated_at)
          VALUES ($1, $2, $3, $4, $5, 'mensuel', $6, 'actif', $7, $8)
          RETURNING id, matricule
        `,
        [schoolId, matricule, p.full_name, p.role, p.role, 120000, uuid, new Date().toISOString()]
      );
      personnelRows.push(res.rows[0]);
    }

    // Eleves
    const elevesRows = [];
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - MONTHS_BACK);
    const now = new Date();

    for (const c of classRows) {
      for (let i = 0; i < MIN_ELEVES_PER_CLASS; i += 1) {
        const isMale = i % 2 === 0;
        const prenom = isMale ? pick(maleFirst) : pick(femaleFirst);
        const nom = pick(lastNames);
        const matricule = `EL-${c.nom.replace(/\s+/g, "").toUpperCase()}-${String(i + 1).padStart(3, "0")}`;
        const uuid = crypto.randomUUID();
        const studentUuid = crypto.randomUUID();
        const createdAt = randomDateBetween(startDate, now);
        const res = await client.query(
          `
            INSERT INTO eleves (school_id, student_uuid, matricule, nom, prenom, classe, sexe, dateNaissance, telparent, nomParent, statut, caise, uuid, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'actif', 0, $11, $12, $13)
            RETURNING id, matricule, classe, student_uuid
          `,
          [
            schoolId,
            studentUuid,
            matricule,
            nom,
            prenom,
            c.nom,
            isMale ? "M" : "F",
            "2012-01-01",
            "",
            `${pick(maleFirst)} ${pick(lastNames)}`,
            uuid,
            createdAt.toISOString(),
            createdAt.toISOString()
          ]
        );
        elevesRows.push({
          ...res.rows[0],
          nom,
          prenom,
          sexe: isMale ? "M" : "F"
        });
      }
    }

    // Students + enrollments (optional but useful for transfers)
    const studentIdsByUuid = new Map();
    for (const e of elevesRows) {
      const studentRes = await client.query(
        `
          INSERT INTO students (uuid, nom, prenom, date_naissance, sexe)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (uuid) DO NOTHING
          RETURNING id
        `,
        [e.student_uuid, e.nom || "", e.prenom || "", "2012-01-01", e.sexe || "M"]
      );
      const studentId = studentRes.rows[0] ? Number(studentRes.rows[0].id) : null;
      if (studentId) studentIdsByUuid.set(e.student_uuid, studentId);
      const classRow = classRows.find((c) => c.nom === e.classe);
      if (studentId && classRow) {
        await client.query(
          `
            INSERT INTO enrollments (student_id, ecole_id, classe_id, date_entree, statut)
            VALUES ($1, $2, $3, $4, 'actif')
          `,
          [studentId, schoolId, classRow.id, new Date().toISOString().slice(0, 10)]
        );
      }
    }

    // Affectations + emplois
    for (const c of classRows) {
      const neededMatieres = matieresSeed.slice(0, 5);
      for (const m of neededMatieres) {
        const teacher = pick(enseignantsRows);
        const uuid = crypto.randomUUID();
        const affRes = await client.query(
          `
            INSERT INTO affectations (school_id, enseignant_matricule, classe, matiere, uuid, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT DO NOTHING
            RETURNING id
          `,
          [schoolId, teacher.matricule, c.nom, m, uuid, new Date().toISOString()]
        );
        const affectationId = affRes.rows[0] ? Number(affRes.rows[0].id) : null;
        if (affectationId) {
          const jours = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
          for (let j = 0; j < 2; j += 1) {
            await client.query(
              `
                INSERT INTO emplois (school_id, affectation_id, jour, heure_debut, heure_fin, uuid, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
              `,
              [schoolId, affectationId, pick(jours), "08:00", "10:00", crypto.randomUUID(), new Date().toISOString()]
            );
          }
        }
      }
    }

    // Notes
    for (const e of elevesRows) {
      const subjects = matieresSeed.slice(0, 3);
      for (const m of subjects) {
        await client.query(
          `
            INSERT INTO notes (school_id, eleve_matricule, matiere, trimestre, note, annee, note_type, uuid, updated_at)
            VALUES ($1, $2, $3, '1', $4, $5, 'devoir', $6, $7)
          `,
          [schoolId, e.matricule, m, (8 + Math.random() * 10).toFixed(1), SCHOOL_YEAR, crypto.randomUUID(), new Date().toISOString()]
        );
      }
    }

    // Paiements
    const months = rangeMonths(MONTHS_BACK);
    for (const e of elevesRows) {
      const payMonths = months.slice(0, 3);
      for (const m of payMonths) {
        await client.query(
          `
            INSERT INTO paiements (school_id, eleve_matricule, montant, mois, date_payement, mode_payement, annee_scolaire, uuid, updated_at)
            VALUES ($1, $2, $3, $4, $5, 'cash', $6, $7, $8)
          `,
          [
            schoolId,
            e.matricule,
            15000,
            monthKey(m),
            m.toISOString().slice(0, 10),
            SCHOOL_YEAR,
            crypto.randomUUID(),
            new Date().toISOString()
          ]
        );
      }
    }

    // Salaires + Depenses
    for (const m of months) {
      for (const p of personnelRows) {
        await client.query(
          `
            INSERT INTO salaires (school_id, personnel_matricule, mois, montant, mode_payement, date_payement, uuid, updated_at)
            VALUES ($1, $2, $3, $4, 'virement', $5, $6, $7)
          `,
          [schoolId, p.matricule, monthKey(m), 120000, m.toISOString().slice(0, 10), crypto.randomUUID(), new Date().toISOString()]
        );
      }
      for (const t of enseignantsRows) {
        await client.query(
          `
            INSERT INTO salaires (school_id, personnel_matricule, mois, montant, mode_payement, date_payement, uuid, updated_at)
            VALUES ($1, $2, $3, $4, 'virement', $5, $6, $7)
          `,
          [schoolId, t.matricule, monthKey(m), 150000, m.toISOString().slice(0, 10), crypto.randomUUID(), new Date().toISOString()]
        );
      }
      await client.query(
        `
          INSERT INTO depenses (school_id, categorie, description, motif, montant, date_depenses, valide_par, uuid, updated_at)
          VALUES ($1, 'Logistique', 'Achat fournitures', 'Fournitures', $2, $3, 'Direction', $4, $5)
        `,
        [schoolId, 80000, m.toISOString().slice(0, 10), crypto.randomUUID(), new Date().toISOString()]
      );
    }

    // Transfers (light demo)
    const otherSchool = await client.query("SELECT id FROM schools WHERE id <> $1 ORDER BY id ASC LIMIT 1", [schoolId]);
    const otherSchoolId = otherSchool.rows[0] ? Number(otherSchool.rows[0].id) : null;
    const adminRes = await client.query("SELECT id FROM users WHERE school_id = $1 LIMIT 1", [schoolId]);
    const requesterId = adminRes.rows[0] ? Number(adminRes.rows[0].id) : null;
    if (otherSchoolId && requesterId) {
      const sample = elevesRows.slice(0, 3);
      for (const e of sample) {
        const studentId = studentIdsByUuid.get(e.student_uuid) || 1;
        await client.query(
          `
            INSERT INTO transfers (student_id, from_ecole_id, to_ecole_id, requested_by, status, date_request, date_response, response_by)
            VALUES ($1, $2, $3, $4, 'pending', $5, NULL, NULL)
          `,
          [studentId, schoolId, otherSchoolId, requesterId, new Date().toISOString()]
        );
      }
    }

    await client.query("COMMIT");
    console.log("Demo data seeded for DEMO SCHOOL.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Seed demo failed:", err.message || err);
  process.exitCode = 1;
});
