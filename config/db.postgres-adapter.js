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
  const isDesktop = String(process.env.ELECTRON_DESKTOP || "").trim() === "1";
  if (isDesktop) {
    const raw = String(sql || "").trim();
    const writePattern = /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i;
    if (writePattern.test(raw)) {
      throw new Error("Direct PostgreSQL writes are blocked in desktop mode. Use SQLite + sync.");
    }
  }

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
      api_key_hash TEXT,
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
      uuid TEXT,
      updated_at TIMESTAMP,
      deleted_at TIMESTAMP,
      version INTEGER NOT NULL DEFAULT 1,
      synced_to_central INTEGER NOT NULL DEFAULT 0,
      sync_synced_at TIMESTAMP,
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
      uuid TEXT,
      updated_at TIMESTAMP,
      deleted_at TIMESTAMP,
      version INTEGER NOT NULL DEFAULT 1,
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
      uuid TEXT,
      updated_at TIMESTAMP,
      deleted_at TIMESTAMP,
      version INTEGER NOT NULL DEFAULT 1,
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
      uuid TEXT,
      updated_at TIMESTAMP,
      deleted_at TIMESTAMP,
      version INTEGER NOT NULL DEFAULT 1,
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
      uuid TEXT,
      updated_at TIMESTAMP,
      deleted_at TIMESTAMP,
      version INTEGER NOT NULL DEFAULT 1,
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
      uuid TEXT,
      updated_at TIMESTAMP,
      deleted_at TIMESTAMP,
      version INTEGER NOT NULL DEFAULT 1,
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
      uuid TEXT,
      updated_at TIMESTAMP,
      deleted_at TIMESTAMP,
      version INTEGER NOT NULL DEFAULT 1,
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
      uuid TEXT,
      updated_at TIMESTAMP,
      deleted_at TIMESTAMP,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS matieres (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      nom TEXT NOT NULL,
      coefficient REAL NOT NULL DEFAULT 1,
      uuid TEXT,
      updated_at TIMESTAMP,
      deleted_at TIMESTAMP,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_matieres_school_nom_unique ON matieres (school_id, nom)`,
    `CREATE TABLE IF NOT EXISTS affectations (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      enseignant_matricule TEXT NOT NULL,
      classe TEXT NOT NULL,
      matiere TEXT NOT NULL,
      uuid TEXT,
      updated_at TIMESTAMP,
      deleted_at TIMESTAMP,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS emplois (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      affectation_id BIGINT NOT NULL,
      jour TEXT NOT NULL,
      heure_debut TEXT NOT NULL,
      heure_fin TEXT,
      uuid TEXT,
      updated_at TIMESTAMP,
      deleted_at TIMESTAMP,
      version INTEGER NOT NULL DEFAULT 1,
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
      uuid TEXT,
      updated_at TIMESTAMP,
      deleted_at TIMESTAMP,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS sync_queue (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      table_name TEXT NOT NULL,
      operation TEXT NOT NULL,
      data TEXT NOT NULL,
      uuid TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      source_device_id TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      last_error TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sync_queue_school_status_created ON sync_queue (school_id, status, created_at ASC)`,
    `DROP INDEX IF EXISTS idx_sync_queue_uuid_created_unique`,
    `CREATE INDEX IF NOT EXISTS idx_sync_queue_uuid_created ON sync_queue (uuid, created_at)`,
    `CREATE TABLE IF NOT EXISTS sync_state (
      table_name TEXT PRIMARY KEY,
      last_pulled_at TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS sync_runtime (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      triggers_disabled INTEGER NOT NULL DEFAULT 0
    )`,
    `INSERT INTO sync_runtime (id, triggers_disabled)
      VALUES (1, 0)
      ON CONFLICT (id) DO NOTHING`,
    `ALTER TABLE schools ADD COLUMN IF NOT EXISTS api_key_hash TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS uuid TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE classes ADD COLUMN IF NOT EXISTS uuid TEXT`,
    `ALTER TABLE classes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`,
    `ALTER TABLE classes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,
    `ALTER TABLE classes ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE eleves ADD COLUMN IF NOT EXISTS uuid TEXT`,
    `ALTER TABLE eleves ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`,
    `ALTER TABLE eleves ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,
    `ALTER TABLE eleves ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE paiements ADD COLUMN IF NOT EXISTS uuid TEXT`,
    `ALTER TABLE paiements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`,
    `ALTER TABLE paiements ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,
    `ALTER TABLE paiements ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE depenses ADD COLUMN IF NOT EXISTS uuid TEXT`,
    `ALTER TABLE depenses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`,
    `ALTER TABLE depenses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,
    `ALTER TABLE depenses ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE salaires ADD COLUMN IF NOT EXISTS uuid TEXT`,
    `ALTER TABLE salaires ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`,
    `ALTER TABLE salaires ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,
    `ALTER TABLE salaires ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE matieres ADD COLUMN IF NOT EXISTS uuid TEXT`,
    `ALTER TABLE matieres ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`,
    `ALTER TABLE matieres ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,
    `ALTER TABLE matieres ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE affectations ADD COLUMN IF NOT EXISTS uuid TEXT`,
    `ALTER TABLE affectations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`,
    `ALTER TABLE affectations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,
    `ALTER TABLE affectations ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE emplois ADD COLUMN IF NOT EXISTS uuid TEXT`,
    `ALTER TABLE emplois ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`,
    `ALTER TABLE emplois ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,
    `ALTER TABLE emplois ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE notes ADD COLUMN IF NOT EXISTS uuid TEXT`,
    `ALTER TABLE notes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`,
    `ALTER TABLE notes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,
    `ALTER TABLE notes ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE enseignants ADD COLUMN IF NOT EXISTS uuid TEXT`,
    `ALTER TABLE enseignants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`,
    `ALTER TABLE enseignants ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,
    `ALTER TABLE enseignants ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE personnel ADD COLUMN IF NOT EXISTS uuid TEXT`,
    `ALTER TABLE personnel ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`,
    `ALTER TABLE personnel ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,
    `ALTER TABLE personnel ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`,
    `UPDATE classes SET uuid = md5(random()::text || clock_timestamp()::text) WHERE COALESCE(trim(uuid), '') = ''`,
    `UPDATE depenses SET uuid = md5(random()::text || clock_timestamp()::text) WHERE COALESCE(trim(uuid), '') = ''`,
    `UPDATE salaires SET uuid = md5(random()::text || clock_timestamp()::text) WHERE COALESCE(trim(uuid), '') = ''`,
    `UPDATE matieres SET uuid = md5(random()::text || clock_timestamp()::text) WHERE COALESCE(trim(uuid), '') = ''`,
    `UPDATE affectations SET uuid = md5(random()::text || clock_timestamp()::text) WHERE COALESCE(trim(uuid), '') = ''`,
    `UPDATE emplois SET uuid = md5(random()::text || clock_timestamp()::text) WHERE COALESCE(trim(uuid), '') = ''`,
    `UPDATE eleves SET uuid = md5(random()::text || clock_timestamp()::text) WHERE COALESCE(trim(uuid), '') = ''`,
    `UPDATE paiements SET uuid = md5(random()::text || clock_timestamp()::text) WHERE COALESCE(trim(uuid), '') = ''`,
    `UPDATE notes SET uuid = md5(random()::text || clock_timestamp()::text) WHERE COALESCE(trim(uuid), '') = ''`,
    `UPDATE enseignants SET uuid = md5(random()::text || clock_timestamp()::text) WHERE COALESCE(trim(uuid), '') = ''`,
    `UPDATE personnel SET uuid = md5(random()::text || clock_timestamp()::text) WHERE COALESCE(trim(uuid), '') = ''`,
    `UPDATE users SET uuid = md5(random()::text || clock_timestamp()::text) WHERE COALESCE(trim(uuid), '') = ''`,
    `UPDATE classes SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP), version = COALESCE(version, 1)`,
    `UPDATE depenses SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP), version = COALESCE(version, 1)`,
    `UPDATE salaires SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP), version = COALESCE(version, 1)`,
    `UPDATE matieres SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP), version = COALESCE(version, 1)`,
    `UPDATE affectations SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP), version = COALESCE(version, 1)`,
    `UPDATE emplois SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP), version = COALESCE(version, 1)`,
    `UPDATE eleves SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP), version = COALESCE(version, 1)`,
    `UPDATE paiements SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP), version = COALESCE(version, 1)`,
    `UPDATE notes SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP), version = COALESCE(version, 1)`,
    `UPDATE enseignants SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP), version = COALESCE(version, 1)`,
    `UPDATE personnel SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP), version = COALESCE(version, 1)`,
    `UPDATE users SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP), version = COALESCE(version, 1)`,
    `CREATE TABLE IF NOT EXISTS retraits_promoteur (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      montant INTEGER NOT NULL,
      date_retrait TEXT,
      motif TEXT,
      valide_par TEXT,
      uuid TEXT,
      updated_at TIMESTAMP,
      deleted_at TIMESTAMP,
      version INTEGER NOT NULL DEFAULT 1,
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
      uuid TEXT,
      updated_at TIMESTAMP,
      deleted_at TIMESTAMP,
      version INTEGER NOT NULL DEFAULT 1,
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
    `CREATE TABLE IF NOT EXISTS public_visits (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL DEFAULT 0,
      page_path TEXT NOT NULL,
      visitor_token TEXT,
      ip_address TEXT,
      ip_anonymized TEXT,
      country_code TEXT,
      country_name TEXT,
      region TEXT,
      city TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      accuracy_m DOUBLE PRECISION,
      source TEXT,
      user_agent TEXT,
      referer TEXT,
      timezone TEXT,
      locale TEXT,
      uuid TEXT,
      updated_at TIMESTAMP,
      deleted_at TIMESTAMP,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_public_visits_created ON public_visits (created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_public_visits_page ON public_visits (page_path, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_public_visits_token ON public_visits (visitor_token)`,
    `ALTER TABLE public_visits ADD COLUMN IF NOT EXISTS school_id BIGINT NOT NULL DEFAULT 0`,
    `ALTER TABLE public_visits ADD COLUMN IF NOT EXISTS uuid TEXT`,
    `ALTER TABLE public_visits ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`,
    `ALTER TABLE public_visits ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,
    `ALTER TABLE public_visits ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE public_visits ADD COLUMN IF NOT EXISTS synced_to_central INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE public_visits ADD COLUMN IF NOT EXISTS sync_synced_at TIMESTAMP`,
    `UPDATE public_visits SET school_id = COALESCE(school_id, 0)`,
    `UPDATE public_visits SET uuid = md5(random()::text || clock_timestamp()::text) WHERE COALESCE(trim(uuid), '') = ''`,
    `UPDATE public_visits SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP), version = COALESCE(version, 1), synced_to_central = COALESCE(synced_to_central, 0)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_public_visits_uuid_unique ON public_visits (uuid) WHERE COALESCE(trim(uuid), '') <> ''`,
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
      uuid TEXT,
      updated_at TIMESTAMP,
      deleted_at TIMESTAMP,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      unique_key TEXT
    )`,
    `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS uuid TEXT`,
    `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`,
    `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,
    `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE retraits_promoteur ADD COLUMN IF NOT EXISTS uuid TEXT`,
    `ALTER TABLE retraits_promoteur ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`,
    `ALTER TABLE retraits_promoteur ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,
    `ALTER TABLE retraits_promoteur ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE saas_subscriptions ADD COLUMN IF NOT EXISTS uuid TEXT`,
    `ALTER TABLE saas_subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`,
    `ALTER TABLE saas_subscriptions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,
    `ALTER TABLE saas_subscriptions ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`,
    `UPDATE notifications SET uuid = md5(random()::text || clock_timestamp()::text) WHERE COALESCE(trim(uuid), '') = ''`,
    `UPDATE retraits_promoteur SET uuid = md5(random()::text || clock_timestamp()::text) WHERE COALESCE(trim(uuid), '') = ''`,
    `UPDATE saas_subscriptions SET uuid = md5(random()::text || clock_timestamp()::text) WHERE COALESCE(trim(uuid), '') = ''`,
    `UPDATE notifications SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP), version = COALESCE(version, 1)`,
    `UPDATE retraits_promoteur SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP), version = COALESCE(version, 1)`,
    `UPDATE saas_subscriptions SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP), version = COALESCE(version, 1)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_school_unique_key ON notifications (school_id, unique_key)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_uuid_unique ON classes (uuid) WHERE COALESCE(trim(uuid), '') <> ''`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_eleves_uuid_unique ON eleves (uuid) WHERE COALESCE(trim(uuid), '') <> ''`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_paiements_uuid_unique ON paiements (uuid) WHERE COALESCE(trim(uuid), '') <> ''`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_uuid_unique ON notes (uuid) WHERE COALESCE(trim(uuid), '') <> ''`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_enseignants_uuid_unique ON enseignants (uuid) WHERE COALESCE(trim(uuid), '') <> ''`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_personnel_uuid_unique ON personnel (uuid) WHERE COALESCE(trim(uuid), '') <> ''`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_depenses_uuid_unique ON depenses (uuid) WHERE COALESCE(trim(uuid), '') <> ''`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_salaires_uuid_unique ON salaires (uuid) WHERE COALESCE(trim(uuid), '') <> ''`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_matieres_uuid_unique ON matieres (uuid) WHERE COALESCE(trim(uuid), '') <> ''`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_affectations_uuid_unique ON affectations (uuid) WHERE COALESCE(trim(uuid), '') <> ''`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_emplois_uuid_unique ON emplois (uuid) WHERE COALESCE(trim(uuid), '') <> ''`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_uuid_unique ON notifications (uuid) WHERE COALESCE(trim(uuid), '') <> ''`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_retraits_promoteur_uuid_unique ON retraits_promoteur (uuid) WHERE COALESCE(trim(uuid), '') <> ''`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_saas_subscriptions_uuid_unique ON saas_subscriptions (uuid) WHERE COALESCE(trim(uuid), '') <> ''`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uuid_unique ON users (uuid) WHERE COALESCE(trim(uuid), '') <> ''`,
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
    db.__pgInitFailed = true;
    db.__pgInitError = err;
  });

module.exports = db;
