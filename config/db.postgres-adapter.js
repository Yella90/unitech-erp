const { pool } = require("./postgres");

function replaceStrftimeYearMonth(sql) {
  const marker = "strftime('%Y-%m',";
  let out = "";
  let cursor = 0;

  while (cursor < sql.length) {
    const idx = sql.indexOf(marker, cursor);
    if (idx < 0) {
      out += sql.slice(cursor);
      break;
    }

    out += sql.slice(cursor, idx);
    let i = idx + marker.length;
    while (i < sql.length && /\s/.test(sql[i])) i += 1;

    let depth = 0;
    let inSingle = false;
    let expr = "";
    for (; i < sql.length; i += 1) {
      const ch = sql[i];
      if (ch === "'" && sql[i - 1] !== "\\") {
        inSingle = !inSingle;
        expr += ch;
        continue;
      }
      if (!inSingle) {
        if (ch === "(") {
          depth += 1;
          expr += ch;
          continue;
        }
        if (ch === ")") {
          if (depth === 0) break;
          depth -= 1;
          expr += ch;
          continue;
        }
      }
      expr += ch;
    }

    out += `to_char((${expr.trim()})::timestamp, 'YYYY-MM')`;
    cursor = i + 1;
  }

  return out;
}

function rewriteSqliteSqlToPostgres(sql) {
  let rewritten = String(sql || "");
  const hadInsertOrIgnore = /\bINSERT\s+OR\s+IGNORE\b/i.test(rewritten);

  if (/^\s*PRAGMA\b/i.test(rewritten)) {
    return "";
  }

  rewritten = replaceStrftimeYearMonth(rewritten);
  rewritten = rewritten.replace(/\bINSERT\s+OR\s+IGNORE\b/gi, "INSERT");
  rewritten = rewritten.replace(/\bdatetime\('now'\)/gi, "CURRENT_TIMESTAMP");
  rewritten = rewritten.replace(/\bdate\('now'\)/gi, "CURRENT_DATE");
  rewritten = rewritten.replace(/\bMAX\s*\(/g, "GREATEST(");

  if (hadInsertOrIgnore && !/\bON\s+CONFLICT\b/i.test(rewritten)) {
    rewritten = `${rewritten.replace(/;\s*$/, "")} ON CONFLICT DO NOTHING`;
  }

  return rewritten;
}

function convertQuestionMarksToPg(sql) {
  let out = "";
  let inSingle = false;
  let idx = 1;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'" && sql[i - 1] !== "\\") {
      inSingle = !inSingle;
      out += ch;
      continue;
    }
    if (!inSingle && ch === "?") {
      out += `$${idx}`;
      idx += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

async function exec(sql, params = []) {
  const rewritten = rewriteSqliteSqlToPostgres(sql);
  if (!rewritten || !rewritten.trim()) {
    return { rows: [], rowCount: 0 };
  }

  const finalSql = convertQuestionMarksToPg(rewritten);
  return pool.query(finalSql, params);
}

const db = {
  serialize(fn) {
    if (typeof fn === "function") fn();
  },

  run(sql, params, callback) {
    const args = Array.isArray(params) ? params : [];
    const cb = typeof params === "function" ? params : callback;
    exec(sql, args)
      .then((result) => {
        if (typeof cb === "function") {
          cb.call({ lastID: null, changes: Number(result.rowCount || 0) }, null);
        }
      })
      .catch((err) => {
        if (typeof cb === "function") cb(err);
        else console.error("PostgreSQL run error:", err.message);
      });
  },

  get(sql, params, callback) {
    const args = Array.isArray(params) ? params : [];
    const cb = typeof params === "function" ? params : callback;
    exec(sql, args)
      .then((result) => {
        if (typeof cb === "function") cb(null, result.rows && result.rows[0] ? result.rows[0] : undefined);
      })
      .catch((err) => {
        if (typeof cb === "function") cb(err);
        else console.error("PostgreSQL get error:", err.message);
      });
  },

  all(sql, params, callback) {
    const args = Array.isArray(params) ? params : [];
    const cb = typeof params === "function" ? params : callback;
    exec(sql, args)
      .then((result) => {
        if (typeof cb === "function") cb(null, result.rows || []);
      })
      .catch((err) => {
        if (typeof cb === "function") cb(err);
        else console.error("PostgreSQL all error:", err.message);
      });
  }
};

async function initPostgresSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS schools (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      promoter_name TEXT,
      director_name TEXT,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      address TEXT,
      localisation TEXT,
      logo_url TEXT,
      code_postal TEXT,
      subscription_plan TEXT NOT NULL DEFAULT 'basic',
      is_active INTEGER NOT NULL DEFAULT 1,
      current_school_year TEXT,
      daterentrer TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS subscription_plans (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      max_students INTEGER NOT NULL,
      max_teachers INTEGER NOT NULL,
      finance_enabled INTEGER NOT NULL DEFAULT 0,
      price_monthly INTEGER NOT NULL DEFAULT 0,
      price_annual INTEGER NOT NULL DEFAULT 0,
      annual_discount_percent INTEGER NOT NULL DEFAULT 15,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT,
      matricule TEXT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS classes (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      nom TEXT NOT NULL,
      cycle TEXT,
      niveau TEXT,
      annee TEXT,
      mensuel INTEGER DEFAULT 0,
      frais_inscription INTEGER DEFAULT 0,
      effectif INTEGER DEFAULT 0,
      effectif_max INTEGER DEFAULT 50,
      totalapaie INTEGER DEFAULT 0,
      totalpaie INTEGER DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_school_nom_unique ON classes (school_id, nom)`,
    `CREATE TABLE IF NOT EXISTS eleves (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      student_uuid TEXT,
      matricule TEXT NOT NULL,
      nom TEXT NOT NULL,
      prenom TEXT NOT NULL,
      classe TEXT,
      sexe TEXT,
      dateNaissance TEXT,
      telparent TEXT,
      nomParent TEXT,
      photo_profil TEXT,
      photo_acte_naissance TEXT,
      statut TEXT DEFAULT 'actif',
      caise INTEGER DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_eleves_school_matricule_unique ON eleves (school_id, matricule)`,
    `CREATE TABLE IF NOT EXISTS enseignants (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      matricule TEXT,
      full_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      matiere TEXT,
      status TEXT DEFAULT 'actif',
      type_payement TEXT,
      salaire_base INTEGER DEFAULT 0,
      taux_horaire INTEGER DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS personnel (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      matricule TEXT,
      nom TEXT,
      prenom TEXT,
      full_name TEXT,
      role TEXT,
      type_personnel TEXT,
      type_payement TEXT,
      salaire_base INTEGER DEFAULT 0,
      taux_horaire INTEGER DEFAULT 0,
      date_embauche TEXT,
      statut TEXT DEFAULT 'actif',
      email TEXT,
      phone TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS paiements (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      eleve_id BIGINT,
      eleve_matricule TEXT,
      montant INTEGER NOT NULL,
      mois TEXT,
      date_payement TEXT,
      mode_payement TEXT,
      annee_scolaire TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS depenses (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      categorie TEXT,
      description TEXT,
      motif TEXT NOT NULL,
      montant INTEGER NOT NULL,
      date_depenses TEXT,
      valide_par TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS salaires (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      personnel_matricule TEXT,
      mois TEXT,
      montant INTEGER NOT NULL DEFAULT 0,
      mode_payement TEXT,
      date_payement TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS matieres (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      nom TEXT NOT NULL,
      coefficient REAL NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_matieres_school_nom_unique ON matieres (school_id, nom)`,
    `CREATE TABLE IF NOT EXISTS affectations (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      enseignant_matricule TEXT NOT NULL,
      classe TEXT NOT NULL,
      matiere TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS emplois (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      affectation_id BIGINT NOT NULL,
      jour TEXT NOT NULL,
      heure_debut TEXT NOT NULL,
      heure_fin TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS notes (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      enrollment_id BIGINT,
      eleve_matricule TEXT NOT NULL,
      matiere TEXT NOT NULL,
      trimestre TEXT NOT NULL,
      note REAL NOT NULL,
      annee TEXT,
      note_type TEXT DEFAULT 'devoir',
      description TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS retraits_promoteur (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      montant INTEGER NOT NULL,
      date_retrait TEXT,
      motif TEXT,
      valide_par TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS saas_subscriptions (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      plan_code TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      billing_cycle TEXT NOT NULL DEFAULT 'monthly',
      status TEXT NOT NULL DEFAULT 'active',
      starts_at TEXT,
      expires_at TEXT,
      validated_at TEXT,
      validated_by BIGINT,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS activity_logs (
      id BIGSERIAL PRIMARY KEY,
      actor_user_id BIGINT,
      school_id BIGINT,
      action TEXT NOT NULL,
      details TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS students (
      id BIGSERIAL PRIMARY KEY,
      uuid TEXT NOT NULL UNIQUE,
      nom TEXT NOT NULL,
      prenom TEXT NOT NULL,
      date_naissance TEXT,
      sexe TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS enrollments (
      id BIGSERIAL PRIMARY KEY,
      student_id BIGINT NOT NULL,
      ecole_id BIGINT NOT NULL,
      classe_id BIGINT,
      date_entree TEXT,
      date_sortie TEXT,
      statut TEXT NOT NULL DEFAULT 'actif',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS grades (
      id BIGSERIAL PRIMARY KEY,
      enrollment_id BIGINT NOT NULL,
      matiere_id BIGINT,
      trimestre TEXT NOT NULL,
      note REAL NOT NULL,
      school_year TEXT,
      source_note_id BIGINT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS transfers (
      id BIGSERIAL PRIMARY KEY,
      student_id BIGINT NOT NULL,
      from_ecole_id BIGINT NOT NULL,
      to_ecole_id BIGINT NOT NULL,
      requested_by BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      date_request TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      date_response TIMESTAMP,
      response_by BIGINT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      user_id BIGINT,
      entity_type TEXT NOT NULL,
      entity_id BIGINT,
      details TEXT,
      timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      entity_type TEXT,
      entity_id BIGINT,
      entity_ref TEXT,
      metadata TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      read_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      unique_key TEXT
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_school_unique_key ON notifications (school_id, unique_key)`,
    `INSERT INTO subscription_plans (code, name, max_students, max_teachers, finance_enabled, price_monthly, price_annual, annual_discount_percent)
     VALUES
      ('basic', 'Basic', 1000000, 1000000, 1, 15000, 153000, 15),
      ('pro', 'Intermediaire (Smart)', 1000000, 1000000, 1, 30000, 306000, 15),
      ('premium', 'Premium', 1000000, 1000000, 1, 60000, 612000, 15)
     ON CONFLICT (code) DO NOTHING`,
    `INSERT INTO schools (id, name, email, phone, address, subscription_plan, is_active)
     VALUES (1, 'Ecole Demo', 'demo@school.local', '', '', 'premium', 1)
     ON CONFLICT (id) DO NOTHING`
  ];
  

  for (const sql of statements) {
    // eslint-disable-next-line no-await-in-loop
    await pool.query(sql);
  }

  // Keep SERIAL/BIGSERIAL sequence aligned when rows are inserted with explicit ids.
  // Prevents errors like: duplicate key value violates unique constraint "schools_pkey".
  await pool.query(`
    SELECT setval(
      pg_get_serial_sequence('schools', 'id'),
      COALESCE((SELECT MAX(id) FROM schools), 1),
      true
    )
  `);
}

initPostgresSchema()
  .then(() => {
    console.log("PostgreSQL connected");
  })
  .catch((err) => {
    console.error("PostgreSQL init error:", err.message);
  });

module.exports = db;
