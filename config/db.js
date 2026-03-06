const usePostgres = String(process.env.DB_CLIENT || "").trim().toLowerCase() === "postgres";
if (usePostgres) {
  module.exports = require("./db.postgres-adapter");
} else {
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();

const sqlitePath = process.env.SQLITE_PATH
  ? path.resolve(process.env.SQLITE_PATH)
  : path.resolve(__dirname, "..", "database.sqlite");
const minimalBootstrap = String(process.env.DB_MINIMAL_BOOTSTRAP || "0") === "1";
const sqliteDir = path.dirname(sqlitePath);
if (!fs.existsSync(sqliteDir)) {
  fs.mkdirSync(sqliteDir, { recursive: true });
}

const db = new sqlite3.Database(sqlitePath, (err) => {
  if (err) {
    console.error("Database connection error:", err.message);
  } else {
    console.log(`SQLite connected (${sqlitePath})`);
  }
});

db.serialize(() => {
  db.run("PRAGMA foreign_keys = ON");

  db.run(`
    CREATE TABLE IF NOT EXISTS schools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS subscription_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      max_students INTEGER NOT NULL,
      max_teachers INTEGER NOT NULL,
      finance_enabled INTEGER NOT NULL DEFAULT 0,
      price_monthly INTEGER NOT NULL DEFAULT 0,
      price_annual INTEGER NOT NULL DEFAULT 0,
      annual_discount_percent INTEGER NOT NULL DEFAULT 15,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER,
      matricule TEXT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('superadmin', 'school_admin', 'staff')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (school_id) REFERENCES schools(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL,
      nom TEXT NOT NULL,
      cycle TEXT,
      niveau TEXT,
      annee TEXT,
      mensuel INTEGER DEFAULT 0,
      frais_inscription INTEGER DEFAULT 0,
      effectif INTEGER DEFAULT 0,
      totalapaie INTEGER DEFAULT 0,
      totalpaie INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (school_id, nom),
      FOREIGN KEY (school_id) REFERENCES schools(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS eleves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL,
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
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (school_id, matricule),
      FOREIGN KEY (school_id) REFERENCES schools(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS enseignants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL,
      matricule TEXT,
      full_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      matiere TEXT,
      status TEXT DEFAULT 'actif',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (school_id) REFERENCES schools(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS personnel (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL,
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
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (school_id) REFERENCES schools(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS paiements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL,
      eleve_id INTEGER,
      eleve_matricule TEXT,
      montant INTEGER NOT NULL,
      mois TEXT,
      date_payement TEXT,
      mode_payement TEXT,
      annee_scolaire TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (school_id) REFERENCES schools(id),
      FOREIGN KEY (eleve_id) REFERENCES eleves(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS depenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL,
      categorie TEXT,
      description TEXT,
      motif TEXT NOT NULL,
      montant INTEGER NOT NULL,
      date_depenses TEXT,
      valide_par TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (school_id) REFERENCES schools(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS salaires (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL,
      personnel_matricule TEXT,
      mois TEXT,
      montant INTEGER NOT NULL DEFAULT 0,
      mode_payement TEXT,
      date_payement TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (school_id) REFERENCES schools(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS matieres (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL,
      nom TEXT NOT NULL,
      coefficient REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (school_id, nom),
      FOREIGN KEY (school_id) REFERENCES schools(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS affectations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL,
      enseignant_matricule TEXT NOT NULL,
      classe TEXT NOT NULL,
      matiere TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (school_id) REFERENCES schools(id)
    )
  `);
  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_affectations_school_classe_matiere_unique
    ON affectations (school_id, lower(trim(classe)), lower(trim(matiere)))
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS emplois (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL,
      affectation_id INTEGER NOT NULL,
      jour TEXT NOT NULL,
      heure_debut TEXT NOT NULL,
      heure_fin TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (school_id) REFERENCES schools(id),
      FOREIGN KEY (affectation_id) REFERENCES affectations(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL,
      eleve_matricule TEXT NOT NULL,
      matiere TEXT NOT NULL,
      trimestre TEXT NOT NULL,
      note REAL NOT NULL,
      annee TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (school_id) REFERENCES schools(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL,
      table_name TEXT NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN ('insert', 'update', 'delete')),
      data TEXT NOT NULL,
      uuid TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'synced', 'failed')),
      retry_count INTEGER NOT NULL DEFAULT 0,
      source_device_id TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (school_id) REFERENCES schools(id)
    )
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_sync_queue_school_status_created
    ON sync_queue (school_id, status, created_at ASC)
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS sync_state (
      table_name TEXT PRIMARY KEY,
      last_pulled_at TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS sync_runtime (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      triggers_disabled INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.run(`
    INSERT OR IGNORE INTO sync_runtime (id, triggers_disabled)
    VALUES (1, 0)
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS public_visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL DEFAULT 0,
      page_path TEXT NOT NULL,
      visitor_token TEXT,
      ip_address TEXT,
      ip_anonymized TEXT,
      country_code TEXT,
      country_name TEXT,
      region TEXT,
      city TEXT,
      latitude REAL,
      longitude REAL,
      accuracy_m REAL,
      source TEXT,
      user_agent TEXT,
      referer TEXT,
      timezone TEXT,
      locale TEXT,
      uuid TEXT,
      updated_at TEXT,
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      synced_to_central INTEGER NOT NULL DEFAULT 0,
      sync_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_public_visits_created ON public_visits (created_at DESC)");
  db.run("CREATE INDEX IF NOT EXISTS idx_public_visits_page ON public_visits (page_path, created_at DESC)");
  db.run("CREATE INDEX IF NOT EXISTS idx_public_visits_token ON public_visits (visitor_token)");

  db.run(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      nom TEXT NOT NULL,
      prenom TEXT NOT NULL,
      date_naissance TEXT,
      sexe TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      ecole_id INTEGER NOT NULL,
      classe_id INTEGER,
      date_entree TEXT,
      date_sortie TEXT,
      statut TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'transfere', 'diplome')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(id),
      FOREIGN KEY (ecole_id) REFERENCES schools(id),
      FOREIGN KEY (classe_id) REFERENCES classes(id)
    )
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_enrollments_student
    ON enrollments (student_id, created_at DESC)
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_enrollments_school_status
    ON enrollments (ecole_id, statut)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS grades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      enrollment_id INTEGER NOT NULL,
      matiere_id INTEGER,
      trimestre TEXT NOT NULL,
      note REAL NOT NULL,
      school_year TEXT,
      source_note_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (enrollment_id) REFERENCES enrollments(id),
      FOREIGN KEY (matiere_id) REFERENCES matieres(id),
      FOREIGN KEY (source_note_id) REFERENCES notes(id)
    )
  `);
  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grades_source_note_unique
    ON grades (source_note_id)
    WHERE source_note_id IS NOT NULL
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      from_ecole_id INTEGER NOT NULL,
      to_ecole_id INTEGER NOT NULL,
      requested_by INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
      date_request TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      date_response TEXT,
      response_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(id),
      FOREIGN KEY (from_ecole_id) REFERENCES schools(id),
      FOREIGN KEY (to_ecole_id) REFERENCES schools(id),
      FOREIGN KEY (requested_by) REFERENCES users(id),
      FOREIGN KEY (response_by) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_transfers_to_school_status
    ON transfers (to_ecole_id, status, date_request DESC)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      user_id INTEGER,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT,
      timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      entity_ref TEXT,
      metadata TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      unique_key TEXT,
      FOREIGN KEY (school_id) REFERENCES schools(id)
    )
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_notifications_school_read_created
    ON notifications (school_id, is_read, created_at DESC)
  `);
  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_school_unique_key
    ON notifications (school_id, unique_key)
    WHERE TRIM(COALESCE(unique_key, '')) <> ''
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS retraits_promoteur (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL,
      montant INTEGER NOT NULL,
      date_retrait TEXT,
      motif TEXT,
      valide_par TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (school_id) REFERENCES schools(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS saas_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL,
      plan_code TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      billing_cycle TEXT NOT NULL DEFAULT 'monthly',
      status TEXT NOT NULL DEFAULT 'active',
      starts_at TEXT,
      expires_at TEXT,
      validated_at TEXT,
      validated_by INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (school_id) REFERENCES schools(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER,
      school_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (actor_user_id) REFERENCES users(id),
      FOREIGN KEY (school_id) REFERENCES schools(id)
    )
  `);

  db.run(`
    INSERT OR IGNORE INTO subscription_plans (
      code, name, max_students, max_teachers, finance_enabled, price_monthly
    )
    VALUES
      ('basic', 'Basic', 1000000, 1000000, 1, 15000),
      ('pro', 'Intermediaire (Smart)', 1000000, 1000000, 1, 30000),
      ('premium', 'Premium', 1000000, 1000000, 1, 60000)
  `);

  ensureColumn("classes", "school_id", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("classes", "frais_inscription", "INTEGER DEFAULT 0");
  ensureColumn("classes", "cycle", "TEXT");
  ensureColumn("classes", "effectif_max", "INTEGER DEFAULT 50");
  ensureColumn("classes", "totalapaie", "INTEGER DEFAULT 0");
  ensureColumn("classes", "totalpaie", "INTEGER DEFAULT 0");
  ensureColumn("eleves", "school_id", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("eleves", "statut", "TEXT DEFAULT 'actif'");
  ensureColumn("eleves", "nomParent", "TEXT");
  ensureColumn("eleves", "telparent", "TEXT");
  ensureColumn("eleves", "sexe", "TEXT");
  ensureColumn("eleves", "photo_profil", "TEXT");
  ensureColumn("eleves", "photo_acte_naissance", "TEXT");
  ensureColumn("enseignants", "school_id", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("enseignants", "matricule", "TEXT");
  ensureColumn("enseignants", "status", "TEXT DEFAULT 'actif'");
  ensureColumn("enseignants", "type_payement", "TEXT");
  ensureColumn("enseignants", "salaire_base", "INTEGER DEFAULT 0");
  ensureColumn("enseignants", "taux_horaire", "INTEGER DEFAULT 0");
  ensureColumn("personnel", "school_id", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("personnel", "matricule", "TEXT");
  ensureColumn("personnel", "nom", "TEXT");
  ensureColumn("personnel", "prenom", "TEXT");
  ensureColumn("personnel", "type_personnel", "TEXT");
  ensureColumn("personnel", "type_payement", "TEXT");
  ensureColumn("personnel", "salaire_base", "INTEGER DEFAULT 0");
  ensureColumn("personnel", "taux_horaire", "INTEGER DEFAULT 0");
  ensureColumn("personnel", "date_embauche", "TEXT");
  ensureColumn("personnel", "statut", "TEXT DEFAULT 'actif'");
  ensureColumn("paiements", "school_id", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("paiements", "eleve_matricule", "TEXT");
  ensureColumn("paiements", "date_payement", "TEXT");
  ensureColumn("paiements", "mode_payement", "TEXT");
  ensureColumn("paiements", "annee_scolaire", "TEXT");
  ensureColumn("depenses", "school_id", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("depenses", "categorie", "TEXT");
  ensureColumn("depenses", "description", "TEXT");
  ensureColumn("depenses", "date_depenses", "TEXT");
  ensureColumn("depenses", "valide_par", "TEXT");
  ensureColumn("schools", "promoter_name", "TEXT");
  ensureColumn("schools", "director_name", "TEXT");
  ensureColumn("schools", "localisation", "TEXT");
  ensureColumn("schools", "logo_url", "TEXT");
  ensureColumn("schools", "code_postal", "TEXT");
  ensureColumn("schools", "current_school_year", "TEXT");
  ensureColumn("schools", "api_key_hash", "TEXT");
  ensureColumn("users", "matricule", "TEXT");
  ensureColumn("users", "phone", "TEXT");
  ensureColumn("schools", "daterentrer", "TEXT");
  ensureColumn("notes", "note_type", "TEXT DEFAULT 'devoir'");
  ensureColumn("notes", "description", "TEXT");
  ensureColumn("notes", "enrollment_id", "INTEGER");
  ensureColumn("eleves", "student_uuid", "TEXT");
  ensureColumn("emplois", "school_id", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("emplois", "affectation_id", "INTEGER");
  ensureColumn("emplois", "jour", "TEXT");
  ensureColumn("emplois", "heure_debut", "TEXT");
  ensureColumn("emplois", "heure_fin", "TEXT");
  ensureColumn("affectations", "school_id", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("affectations", "enseignant_matricule", "TEXT");
  ensureColumn("affectations", "classe", "TEXT");
  ensureColumn("affectations", "matiere", "TEXT");
  ensureColumn("saas_subscriptions", "starts_at", "TEXT");
  ensureColumn("saas_subscriptions", "expires_at", "TEXT");
  ensureColumn("saas_subscriptions", "validated_at", "TEXT");
  ensureColumn("saas_subscriptions", "validated_by", "INTEGER");
  ensureColumn("saas_subscriptions", "notes", "TEXT");
  ensureColumn("saas_subscriptions", "billing_cycle", "TEXT NOT NULL DEFAULT 'monthly'");
  ensureColumn("subscription_plans", "price_annual", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("subscription_plans", "annual_discount_percent", "INTEGER NOT NULL DEFAULT 15");
  ensureColumn("notifications", "entity_ref", "TEXT");
  ensureColumn("notifications", "metadata", "TEXT");
  ensureColumn("notifications", "is_read", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("notifications", "read_at", "TEXT");
  ensureColumn("notifications", "unique_key", "TEXT");
  ensureColumn("classes", "uuid", "TEXT");
  ensureColumn("classes", "updated_at", "TEXT");
  ensureColumn("classes", "deleted_at", "TEXT");
  ensureColumn("classes", "version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("depenses", "uuid", "TEXT");
  ensureColumn("depenses", "updated_at", "TEXT");
  ensureColumn("depenses", "deleted_at", "TEXT");
  ensureColumn("depenses", "version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("salaires", "uuid", "TEXT");
  ensureColumn("salaires", "updated_at", "TEXT");
  ensureColumn("salaires", "deleted_at", "TEXT");
  ensureColumn("salaires", "version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("matieres", "uuid", "TEXT");
  ensureColumn("matieres", "updated_at", "TEXT");
  ensureColumn("matieres", "deleted_at", "TEXT");
  ensureColumn("matieres", "version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("affectations", "uuid", "TEXT");
  ensureColumn("affectations", "updated_at", "TEXT");
  ensureColumn("affectations", "deleted_at", "TEXT");
  ensureColumn("affectations", "version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("emplois", "uuid", "TEXT");
  ensureColumn("emplois", "updated_at", "TEXT");
  ensureColumn("emplois", "deleted_at", "TEXT");
  ensureColumn("emplois", "version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("eleves", "uuid", "TEXT");
  ensureColumn("eleves", "updated_at", "TEXT");
  ensureColumn("eleves", "deleted_at", "TEXT");
  ensureColumn("eleves", "version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("paiements", "uuid", "TEXT");
  ensureColumn("paiements", "updated_at", "TEXT");
  ensureColumn("paiements", "deleted_at", "TEXT");
  ensureColumn("paiements", "version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("notes", "uuid", "TEXT");
  ensureColumn("notes", "updated_at", "TEXT");
  ensureColumn("notes", "deleted_at", "TEXT");
  ensureColumn("notes", "version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("enseignants", "uuid", "TEXT");
  ensureColumn("enseignants", "updated_at", "TEXT");
  ensureColumn("enseignants", "deleted_at", "TEXT");
  ensureColumn("enseignants", "version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("personnel", "uuid", "TEXT");
  ensureColumn("personnel", "updated_at", "TEXT");
  ensureColumn("personnel", "deleted_at", "TEXT");
  ensureColumn("personnel", "version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("notifications", "uuid", "TEXT");
  ensureColumn("notifications", "updated_at", "TEXT");
  ensureColumn("notifications", "deleted_at", "TEXT");
  ensureColumn("notifications", "version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("retraits_promoteur", "uuid", "TEXT");
  ensureColumn("retraits_promoteur", "updated_at", "TEXT");
  ensureColumn("retraits_promoteur", "deleted_at", "TEXT");
  ensureColumn("retraits_promoteur", "version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("saas_subscriptions", "uuid", "TEXT");
  ensureColumn("saas_subscriptions", "updated_at", "TEXT");
  ensureColumn("saas_subscriptions", "deleted_at", "TEXT");
  ensureColumn("saas_subscriptions", "version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("public_visits", "school_id", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("public_visits", "uuid", "TEXT");
  ensureColumn("public_visits", "updated_at", "TEXT");
  ensureColumn("public_visits", "deleted_at", "TEXT");
  ensureColumn("public_visits", "version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("public_visits", "synced_to_central", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("public_visits", "sync_synced_at", "TEXT");
  ensureColumn("users", "uuid", "TEXT");
  ensureColumn("users", "updated_at", "TEXT");
  ensureColumn("users", "deleted_at", "TEXT");
  ensureColumn("users", "version", "INTEGER NOT NULL DEFAULT 1");

  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_students_uuid_unique
    ON students (uuid)
  `);
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_uuid_unique ON classes (uuid) WHERE TRIM(COALESCE(uuid, '')) <> ''");
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_eleves_uuid_unique ON eleves (uuid) WHERE TRIM(COALESCE(uuid, '')) <> ''");
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_paiements_uuid_unique ON paiements (uuid) WHERE TRIM(COALESCE(uuid, '')) <> ''");
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_uuid_unique ON notes (uuid) WHERE TRIM(COALESCE(uuid, '')) <> ''");
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_enseignants_uuid_unique ON enseignants (uuid) WHERE TRIM(COALESCE(uuid, '')) <> ''");
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_personnel_uuid_unique ON personnel (uuid) WHERE TRIM(COALESCE(uuid, '')) <> ''");
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_depenses_uuid_unique ON depenses (uuid) WHERE TRIM(COALESCE(uuid, '')) <> ''");
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_salaires_uuid_unique ON salaires (uuid) WHERE TRIM(COALESCE(uuid, '')) <> ''");
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_matieres_uuid_unique ON matieres (uuid) WHERE TRIM(COALESCE(uuid, '')) <> ''");
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_affectations_uuid_unique ON affectations (uuid) WHERE TRIM(COALESCE(uuid, '')) <> ''");
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_emplois_uuid_unique ON emplois (uuid) WHERE TRIM(COALESCE(uuid, '')) <> ''");
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_uuid_unique ON notifications (uuid) WHERE TRIM(COALESCE(uuid, '')) <> ''");
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_retraits_promoteur_uuid_unique ON retraits_promoteur (uuid) WHERE TRIM(COALESCE(uuid, '')) <> ''");
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_saas_subscriptions_uuid_unique ON saas_subscriptions (uuid) WHERE TRIM(COALESCE(uuid, '')) <> ''");
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_public_visits_uuid_unique ON public_visits (uuid) WHERE TRIM(COALESCE(uuid, '')) <> ''");
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uuid_unique ON users (uuid) WHERE TRIM(COALESCE(uuid, '')) <> ''");
  db.run("DROP INDEX IF EXISTS idx_sync_queue_uuid_created_unique");
  db.run("CREATE INDEX IF NOT EXISTS idx_sync_queue_uuid_created ON sync_queue (uuid, created_at)");
  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_eleves_school_student_uuid_unique
    ON eleves (school_id, student_uuid)
    WHERE TRIM(COALESCE(student_uuid, '')) <> ''
  `);

  db.run(`
    UPDATE subscription_plans
    SET name = 'Basic',
        max_students = 1000000,
        max_teachers = 1000000,
        finance_enabled = 1,
        price_monthly = 15000,
        price_annual = 153000,
        annual_discount_percent = 15
    WHERE code = 'basic'
  `);
  db.run(`
    UPDATE subscription_plans
    SET name = 'Intermediaire (Smart)',
        max_students = 1000000,
        max_teachers = 1000000,
        finance_enabled = 1,
        price_monthly = 30000,
        price_annual = 306000,
        annual_discount_percent = 15
    WHERE code = 'pro'
  `);
  db.run(`
    UPDATE subscription_plans
    SET name = 'Premium',
        max_students = 1000000,
        max_teachers = 1000000,
        finance_enabled = 1,
        price_monthly = 60000,
        price_annual = 612000,
        annual_discount_percent = 15
    WHERE code = 'premium'
  `);

  db.run("UPDATE classes SET school_id = 1 WHERE school_id IS NULL");
  db.run("UPDATE eleves SET school_id = 1 WHERE school_id IS NULL");
  db.run("UPDATE enseignants SET school_id = 1 WHERE school_id IS NULL");
  db.run("UPDATE personnel SET school_id = 1 WHERE school_id IS NULL");
  db.run("UPDATE paiements SET school_id = 1 WHERE school_id IS NULL");
  db.run("UPDATE depenses SET school_id = 1 WHERE school_id IS NULL");
  db.run("UPDATE affectations SET school_id = 1 WHERE school_id IS NULL");
  db.run("UPDATE emplois SET school_id = 1 WHERE school_id IS NULL");
  db.run("UPDATE classes SET uuid = lower(hex(randomblob(16))) WHERE TRIM(COALESCE(uuid, '')) = ''");
  db.run("UPDATE depenses SET uuid = lower(hex(randomblob(16))) WHERE TRIM(COALESCE(uuid, '')) = ''");
  db.run("UPDATE salaires SET uuid = lower(hex(randomblob(16))) WHERE TRIM(COALESCE(uuid, '')) = ''");
  db.run("UPDATE matieres SET uuid = lower(hex(randomblob(16))) WHERE TRIM(COALESCE(uuid, '')) = ''");
  db.run("UPDATE affectations SET uuid = lower(hex(randomblob(16))) WHERE TRIM(COALESCE(uuid, '')) = ''");
  db.run("UPDATE emplois SET uuid = lower(hex(randomblob(16))) WHERE TRIM(COALESCE(uuid, '')) = ''");
  db.run("UPDATE eleves SET uuid = lower(hex(randomblob(16))) WHERE TRIM(COALESCE(uuid, '')) = ''");
  db.run("UPDATE paiements SET uuid = lower(hex(randomblob(16))) WHERE TRIM(COALESCE(uuid, '')) = ''");
  db.run("UPDATE notes SET uuid = lower(hex(randomblob(16))) WHERE TRIM(COALESCE(uuid, '')) = ''");
  db.run("UPDATE enseignants SET uuid = lower(hex(randomblob(16))) WHERE TRIM(COALESCE(uuid, '')) = ''");
  db.run("UPDATE personnel SET uuid = lower(hex(randomblob(16))) WHERE TRIM(COALESCE(uuid, '')) = ''");
  db.run("UPDATE notifications SET uuid = lower(hex(randomblob(16))) WHERE TRIM(COALESCE(uuid, '')) = ''");
  db.run("UPDATE retraits_promoteur SET uuid = lower(hex(randomblob(16))) WHERE TRIM(COALESCE(uuid, '')) = ''");
  db.run("UPDATE saas_subscriptions SET uuid = lower(hex(randomblob(16))) WHERE TRIM(COALESCE(uuid, '')) = ''");
  db.run("UPDATE public_visits SET school_id = COALESCE(school_id, 0)");
  db.run("UPDATE public_visits SET uuid = lower(hex(randomblob(16))) WHERE TRIM(COALESCE(uuid, '')) = ''");
  db.run("UPDATE public_visits SET synced_to_central = COALESCE(synced_to_central, 0)");
  db.run("UPDATE users SET uuid = lower(hex(randomblob(16))) WHERE TRIM(COALESCE(uuid, '')) = ''");
  db.run("UPDATE classes SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL");
  db.run("UPDATE depenses SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL");
  db.run("UPDATE salaires SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL");
  db.run("UPDATE matieres SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL");
  db.run("UPDATE affectations SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL");
  db.run("UPDATE emplois SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL");
  db.run("UPDATE eleves SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL");
  db.run("UPDATE paiements SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL");
  db.run("UPDATE notes SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL");
  db.run("UPDATE enseignants SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL");
  db.run("UPDATE personnel SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL");
  db.run("UPDATE notifications SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL");
  db.run("UPDATE retraits_promoteur SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL");
  db.run("UPDATE saas_subscriptions SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL");
  db.run("UPDATE public_visits SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL");
  db.run("UPDATE users SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL");
  // Normalize legacy epoch numeric dates (seconds/milliseconds) into SQLite date/datetime text.
  db.run(`
    UPDATE saas_subscriptions
    SET starts_at = date(
      datetime(
        CASE
          WHEN CAST(starts_at AS REAL) > 10000000000 THEN CAST(starts_at AS REAL) / 1000.0
          ELSE CAST(starts_at AS REAL)
        END,
        'unixepoch'
      )
    )
    WHERE starts_at IS NOT NULL
      AND TRIM(CAST(starts_at AS TEXT)) GLOB '[0-9]*'
      AND instr(CAST(starts_at AS TEXT), '-') = 0
  `);
  db.run(`
    UPDATE saas_subscriptions
    SET expires_at = date(
      datetime(
        CASE
          WHEN CAST(expires_at AS REAL) > 10000000000 THEN CAST(expires_at AS REAL) / 1000.0
          ELSE CAST(expires_at AS REAL)
        END,
        'unixepoch'
      )
    )
    WHERE expires_at IS NOT NULL
      AND TRIM(CAST(expires_at AS TEXT)) GLOB '[0-9]*'
      AND instr(CAST(expires_at AS TEXT), '-') = 0
  `);
  db.run(`
    UPDATE saas_subscriptions
    SET created_at = datetime(
      CASE
        WHEN CAST(created_at AS REAL) > 10000000000 THEN CAST(created_at AS REAL) / 1000.0
        ELSE CAST(created_at AS REAL)
      END,
      'unixepoch'
    )
    WHERE created_at IS NOT NULL
      AND TRIM(CAST(created_at AS TEXT)) GLOB '[0-9]*'
      AND instr(CAST(created_at AS TEXT), '-') = 0
  `);
  db.run(`
    UPDATE saas_subscriptions
    SET updated_at = datetime(
      CASE
        WHEN CAST(updated_at AS REAL) > 10000000000 THEN CAST(updated_at AS REAL) / 1000.0
        ELSE CAST(updated_at AS REAL)
      END,
      'unixepoch'
    )
    WHERE updated_at IS NOT NULL
      AND TRIM(CAST(updated_at AS TEXT)) GLOB '[0-9]*'
      AND instr(CAST(updated_at AS TEXT), '-') = 0
  `);
  db.run(`
    UPDATE paiements
    SET date_payement = date(
      datetime(
        CASE
          WHEN CAST(date_payement AS REAL) > 10000000000 THEN CAST(date_payement AS REAL) / 1000.0
          ELSE CAST(date_payement AS REAL)
        END,
        'unixepoch'
      )
    )
    WHERE date_payement IS NOT NULL
      AND TRIM(CAST(date_payement AS TEXT)) GLOB '[0-9]*'
      AND instr(CAST(date_payement AS TEXT), '-') = 0
  `);
  db.run(`
    UPDATE paiements
    SET created_at = datetime(
      CASE
        WHEN CAST(created_at AS REAL) > 10000000000 THEN CAST(created_at AS REAL) / 1000.0
        ELSE CAST(created_at AS REAL)
      END,
      'unixepoch'
    )
    WHERE created_at IS NOT NULL
      AND TRIM(CAST(created_at AS TEXT)) GLOB '[0-9]*'
      AND instr(CAST(created_at AS TEXT), '-') = 0
  `);
  db.run(`
    UPDATE paiements
    SET updated_at = datetime(
      CASE
        WHEN CAST(updated_at AS REAL) > 10000000000 THEN CAST(updated_at AS REAL) / 1000.0
        ELSE CAST(updated_at AS REAL)
      END,
      'unixepoch'
    )
    WHERE updated_at IS NOT NULL
      AND TRIM(CAST(updated_at AS TEXT)) GLOB '[0-9]*'
      AND instr(CAST(updated_at AS TEXT), '-') = 0
  `);
  db.run(`
    UPDATE depenses
    SET date_depenses = date(
      datetime(
        CASE
          WHEN CAST(date_depenses AS REAL) > 10000000000 THEN CAST(date_depenses AS REAL) / 1000.0
          ELSE CAST(date_depenses AS REAL)
        END,
        'unixepoch'
      )
    )
    WHERE date_depenses IS NOT NULL
      AND TRIM(CAST(date_depenses AS TEXT)) GLOB '[0-9]*'
      AND instr(CAST(date_depenses AS TEXT), '-') = 0
  `);
  db.run(`
    UPDATE salaires
    SET date_payement = date(
      datetime(
        CASE
          WHEN CAST(date_payement AS REAL) > 10000000000 THEN CAST(date_payement AS REAL) / 1000.0
          ELSE CAST(date_payement AS REAL)
        END,
        'unixepoch'
      )
    )
    WHERE date_payement IS NOT NULL
      AND TRIM(CAST(date_payement AS TEXT)) GLOB '[0-9]*'
      AND instr(CAST(date_payement AS TEXT), '-') = 0
  `);
  db.run(`
    UPDATE retraits_promoteur
    SET date_retrait = date(
      datetime(
        CASE
          WHEN CAST(date_retrait AS REAL) > 10000000000 THEN CAST(date_retrait AS REAL) / 1000.0
          ELSE CAST(date_retrait AS REAL)
        END,
        'unixepoch'
      )
    )
    WHERE date_retrait IS NOT NULL
      AND TRIM(CAST(date_retrait AS TEXT)) GLOB '[0-9]*'
      AND instr(CAST(date_retrait AS TEXT), '-') = 0
  `);
  db.run("UPDATE classes SET version = COALESCE(version, 1)");
  db.run("UPDATE depenses SET version = COALESCE(version, 1)");
  db.run("UPDATE salaires SET version = COALESCE(version, 1)");
  db.run("UPDATE matieres SET version = COALESCE(version, 1)");
  db.run("UPDATE affectations SET version = COALESCE(version, 1)");
  db.run("UPDATE emplois SET version = COALESCE(version, 1)");
  db.run("UPDATE eleves SET version = COALESCE(version, 1)");
  db.run("UPDATE paiements SET version = COALESCE(version, 1)");
  db.run("UPDATE notes SET version = COALESCE(version, 1)");
  db.run("UPDATE enseignants SET version = COALESCE(version, 1)");
  db.run("UPDATE personnel SET version = COALESCE(version, 1)");
  db.run("UPDATE notifications SET version = COALESCE(version, 1)");
  db.run("UPDATE retraits_promoteur SET version = COALESCE(version, 1)");
  db.run("UPDATE saas_subscriptions SET version = COALESCE(version, 1)");
  db.run("UPDATE public_visits SET version = COALESCE(version, 1)");
  db.run("UPDATE users SET version = COALESCE(version, 1)");
  db.run("UPDATE eleves SET student_uuid = lower(hex(randomblob(16))) WHERE TRIM(COALESCE(student_uuid, '')) = ''");
  db.run(`
    INSERT INTO students (uuid, nom, prenom, date_naissance, sexe, created_at)
    SELECT DISTINCT
      e.student_uuid,
      e.nom,
      e.prenom,
      e.dateNaissance,
      e.sexe,
      COALESCE(e.created_at, CURRENT_TIMESTAMP)
    FROM eleves e
    WHERE TRIM(COALESCE(e.student_uuid, '')) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM students s WHERE s.uuid = e.student_uuid
      )
  `);
  db.run(`
    INSERT INTO enrollments (student_id, ecole_id, classe_id, date_entree, statut, created_at)
    SELECT
      s.id,
      e.school_id,
      c.id,
      COALESCE(date(e.created_at), date('now')),
      CASE
        WHEN lower(trim(COALESCE(e.statut, 'actif'))) = 'inactif' THEN 'diplome'
        ELSE 'actif'
      END,
      COALESCE(e.created_at, CURRENT_TIMESTAMP)
    FROM eleves e
    JOIN students s ON s.uuid = e.student_uuid
    LEFT JOIN classes c ON c.school_id = e.school_id AND c.nom = e.classe
    WHERE NOT EXISTS (
      SELECT 1
      FROM enrollments en
      WHERE en.student_id = s.id
        AND en.ecole_id = e.school_id
        AND en.statut = 'actif'
    )
  `);
  db.run(`
    UPDATE notes
    SET enrollment_id = (
      SELECT en.id
      FROM eleves e
      JOIN students s ON s.uuid = e.student_uuid
      JOIN enrollments en ON en.student_id = s.id AND en.ecole_id = notes.school_id
      WHERE e.school_id = notes.school_id
        AND e.matricule = notes.eleve_matricule
      ORDER BY
        CASE en.statut WHEN 'actif' THEN 0 ELSE 1 END ASC,
        en.created_at DESC,
        en.id DESC
      LIMIT 1
    )
    WHERE enrollment_id IS NULL
  `);
  db.run(`
    INSERT INTO grades (enrollment_id, matiere_id, trimestre, note, school_year, source_note_id, created_at)
    SELECT
      n.enrollment_id,
      m.id,
      n.trimestre,
      n.note,
      COALESCE(n.annee, ''),
      n.id,
      COALESCE(n.created_at, CURRENT_TIMESTAMP)
    FROM notes n
    LEFT JOIN matieres m
      ON m.school_id = n.school_id
     AND lower(trim(m.nom)) = lower(trim(n.matiere))
    WHERE n.enrollment_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM grades g WHERE g.source_note_id = n.id)
  `);

  if (!minimalBootstrap) {
    db.run(`
      INSERT OR IGNORE INTO schools (id, name, email, phone, address, subscription_plan, is_active)
      VALUES (1, 'Ecole Demo', 'demo@school.local', '', '', 'premium', 1)
    `);
  }

  installSyncTriggers(db);
});

function ensureColumn(tableName, columnName, definition) {
  db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`, (err) => {
    if (!err) return;
    const msg = String(err.message || "").toLowerCase();
    if (msg.includes("duplicate column name")) return;
    // ignore "no such table" silently during first boot ordering
    if (msg.includes("no such table")) return;
  });
}

module.exports = db;
}

function installSyncTriggers(db) {
  const tables = [
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
    "users"
  ];
  for (const tableName of tables) {
    db.run(`
      CREATE TRIGGER IF NOT EXISTS trg_${tableName}_sync_insert
      AFTER INSERT ON ${tableName}
      WHEN NEW.uuid IS NOT NULL
       AND NEW.school_id IS NOT NULL
       AND TRIM(COALESCE(NEW.uuid, '')) <> ''
       AND (SELECT triggers_disabled FROM sync_runtime WHERE id = 1) = 0
      BEGIN
        INSERT INTO sync_queue (
          school_id, table_name, operation, data, uuid, status, retry_count, source_device_id, version, created_at, updated_at
        )
        VALUES (
          NEW.school_id, '${tableName}', 'insert', '{}', NEW.uuid, 'pending', 0, NULL, COALESCE(NEW.version, 1), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        );
      END
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS trg_${tableName}_sync_update
      AFTER UPDATE ON ${tableName}
      WHEN NEW.uuid IS NOT NULL
       AND NEW.school_id IS NOT NULL
       AND TRIM(COALESCE(NEW.uuid, '')) <> ''
       AND (SELECT triggers_disabled FROM sync_runtime WHERE id = 1) = 0
      BEGIN
        INSERT INTO sync_queue (
          school_id, table_name, operation, data, uuid, status, retry_count, source_device_id, version, created_at, updated_at
        )
        VALUES (
          NEW.school_id, '${tableName}', 'update', '{}', NEW.uuid, 'pending', 0, NULL, COALESCE(NEW.version, 1), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        );
      END
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS trg_${tableName}_sync_delete
      AFTER DELETE ON ${tableName}
      WHEN OLD.uuid IS NOT NULL
       AND OLD.school_id IS NOT NULL
       AND TRIM(COALESCE(OLD.uuid, '')) <> ''
       AND (SELECT triggers_disabled FROM sync_runtime WHERE id = 1) = 0
      BEGIN
        INSERT INTO sync_queue (
          school_id, table_name, operation, data, uuid, status, retry_count, source_device_id, version, created_at, updated_at
        )
        VALUES (
          OLD.school_id, '${tableName}', 'delete',
          json_object('deleted_at', CURRENT_TIMESTAMP, 'updated_at', CURRENT_TIMESTAMP),
          OLD.uuid,
          'pending',
          0,
          NULL,
          COALESCE(OLD.version, 1),
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        );
      END
    `);
  }
}
