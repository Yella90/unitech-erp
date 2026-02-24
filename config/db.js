const usePostgres = String(process.env.DB_CLIENT || "").trim().toLowerCase() === "postgres";
if (usePostgres) {
  module.exports = require("./db.postgres-adapter");
} else {
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const sqlitePath = path.resolve(__dirname, "..", "database.sqlite");

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

  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_students_uuid_unique
    ON students (uuid)
  `);
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

  db.run(`
    INSERT OR IGNORE INTO schools (id, name, email, phone, address, subscription_plan, is_active)
    VALUES (1, 'Ecole Demo', 'demo@school.local', '', '', 'premium', 1)
  `);
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
