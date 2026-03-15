const bcrypt = require("bcryptjs");
const { all, get, run } = require("../../utils/dbAsync");
const TransfersService = require("../transfers.service");

const SALT_ROUNDS = 10;
const NOTE_TYPES = ["devoir", "composition"];

function initialsFromFullName(fullName) {
  const normalized = String(fullName || "").trim().replace(/\s+/g, " ");
  if (!normalized) return "EN";
  const parts = normalized.split(" ").filter(Boolean);
  const first = (parts[0] || "E").charAt(0).toUpperCase();
  const second = (parts[1] || parts[0] || "N").charAt(0).toUpperCase();
  return `${first}${second}`;
}

async function generateEnseignantMatricule(schoolId, fullName) {
  const prefix = initialsFromFullName(fullName);
  const year = new Date().getFullYear().toString().slice(-2);

  for (let i = 0; i < 20; i += 1) {
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const candidate = `${prefix}${year}${randomNum}`;
    const exists = await get(
      "SELECT id FROM enseignants WHERE school_id = ? AND matricule = ? LIMIT 1",
      [schoolId, candidate]
    );
    if (!exists) return candidate;
  }

  throw new Error("Impossible de generer un matricule enseignant unique");
}

async function generatePersonnelMatricule(schoolId, fullName) {
  const prefix = initialsFromFullName(fullName).replace(/[^A-Z]/g, "") || "PE";
  const year = new Date().getFullYear().toString().slice(-2);

  for (let i = 0; i < 20; i += 1) {
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const candidate = `${prefix}${year}${randomNum}`;
    const exists = await get(
      "SELECT id FROM personnel WHERE school_id = ? AND matricule = ? LIMIT 1",
      [schoolId, candidate]
    );
    if (!exists) return candidate;
  }

  throw new Error("Impossible de generer un matricule personnel unique");
}

function toTrimmed(value) {
  return String(value || "").trim();
}

function toPositiveNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeTime(value) {
  const raw = toTrimmed(value);
  if (!raw) return "";
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function monthsElapsedFrom(startDateText) {
  const start = new Date(startDateText);
  if (Number.isNaN(start.getTime())) return 0;
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) {
    months -= 1;
  }
  return Math.max(months, 0);
}

function deriveMention(average) {
  if (average >= 16) return "Tres Bien";
  if (average >= 14) return "Bien";
  if (average >= 12) return "Assez Bien";
  if (average >= 10) return "Passable";
  return "Insuffisant";
}

function deriveAppreciation(mention) {
  if (mention === "Tres Bien") return "Excellent travail, felicitations.";
  if (mention === "Bien") return "Bon travail, continuez ainsi.";
  if (mention === "Assez Bien") return "Resultats satisfaisants, peut mieux faire.";
  if (mention === "Passable") return "Efforts a renforcer.";
  return "Travail insuffisant, redoublement conseille.";
}

function computeMonthlyPayroll(typePayement, salaireBase, tauxHoraire) {
  const type = toTrimmed(typePayement).toLowerCase();
  const salaire = Number(salaireBase) || 0;
  const taux = Number(tauxHoraire) || 0;
  if (type === "horaire") {
    return Math.max(taux, 0) * 160;
  }
  return Math.max(salaire, 0);
}

const LEVEL_ORDER = [
  "jardin",
  "1ere",
  "2eme",
  "3eme",
  "4eme",
  "5eme",
  "6eme",
  "7eme",
  "8eme",
  "9eme",
  "10eme",
  "11eme",
  "terminale"
];

function normalizeLevelToken(value) {
  const raw = toTrimmed(value).toLowerCase();
  if (!raw) return "";
  if (raw === "1ere" || raw === "1ere annee") return "1ere";
  if (raw === "2eme" || raw === "2eme annee") return "2eme";
  if (raw === "3eme" || raw === "3eme annee") return "3eme";
  if (raw === "4eme" || raw === "4eme annee") return "4eme";
  if (raw === "5eme" || raw === "5eme annee") return "5eme";
  if (raw === "6eme" || raw === "6eme annee") return "6eme";
  if (raw === "7eme" || raw === "7eme annee") return "7eme";
  if (raw === "8eme" || raw === "8eme annee") return "8eme";
  if (raw === "9eme" || raw === "9eme annee") return "9eme";
  if (raw === "10eme" || raw === "10eme annee") return "10eme";
  if (raw === "11eme" || raw === "11eme annee") return "11eme";
  if (raw.includes("term")) return "terminale";
  if (raw.includes("jardin")) return "jardin";
  return raw;
}

function extractLevelAndSuffix(className) {
  const raw = toTrimmed(className);
  if (!raw) return { level: "", suffix: "" };
  const lowered = raw.toLowerCase();
  const hit = LEVEL_ORDER.find((lvl) => lowered.startsWith(lvl));
  if (!hit) return { level: "", suffix: "" };
  const suffix = raw.slice(hit.length).trim();
  return { level: hit, suffix };
}

function buildClassName(level, suffix) {
  return suffix ? `${level} ${suffix}`.trim() : level;
}

function nextLevel(level) {
  const normalized = normalizeLevelToken(level);
  const idx = LEVEL_ORDER.indexOf(normalized);
  if (idx < 0 || idx >= LEVEL_ORDER.length - 1) return normalized;
  return LEVEL_ORDER[idx + 1];
}

function resolvePromotedClassName(className) {
  const { level, suffix } = extractLevelAndSuffix(className);
  if (!level) return className;
  const target = nextLevel(level);
  return buildClassName(target, suffix);
}

function safeSchoolYear(value) {
  const raw = toTrimmed(value);
  return /^\d{4}-\d{4}$/.test(raw) ? raw : "";
}

function monthKey(dateObj) {
  return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}`;
}

function buildSchoolMonthOptions(startDateText) {
  const now = new Date();
  const nowMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const startParsed = new Date(startDateText);
  const startMonth = Number.isNaN(startParsed.getTime())
    ? nowMonth
    : new Date(startParsed.getFullYear(), startParsed.getMonth(), 1);

  const begin = startMonth <= nowMonth ? startMonth : nowMonth;
  const cursor = new Date(begin.getFullYear(), begin.getMonth(), 1);
  const out = [];
  const fmt = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

  while (cursor <= nowMonth) {
    const value = monthKey(cursor);
    const rawLabel = fmt.format(cursor);
    const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
    out.push({ value, label });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return out;
}

function monthRange(monthValue) {
  const raw = toTrimmed(monthValue);
  if (!/^\d{4}-\d{2}$/.test(raw)) return null;
  const [yearText, monthText] = raw.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  const start = `${yearText}-${monthText}-01`;
  const endDate = new Date(year, month, 0);
  const end = `${yearText}-${monthText}-${String(endDate.getDate()).padStart(2, "0")}`;
  return { start, end, month: raw };
}

function schoolYearRange(schoolYearValue) {
  const safe = safeSchoolYear(schoolYearValue);
  if (!safe) return null;
  const [startYearText, endYearText] = safe.split("-");
  const startYear = Number(startYearText);
  const endYear = Number(endYearText);
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return null;
  return {
    schoolYear: safe,
    start: `${startYear}-09-01`,
    end: `${endYear}-08-31`
  };
}

function buildScopeClause(scope, dateExpr) {
  if (scope.period === "monthly") {
    return {
      clause: `strftime('%Y-%m', ${dateExpr}) = ?`,
      params: [scope.month]
    };
  }
  return {
    clause: `date(${dateExpr}) >= date(?) AND date(${dateExpr}) <= date(?)`,
    params: [scope.startDate, scope.endDate]
  };
}

async function buildEleveBulletin(schoolId, eleveMatricule, trimestre, annee) {
  const params = [schoolId, eleveMatricule, trimestre];
  let sql = `
    SELECT n.matiere, n.note_type, n.note, COALESCE(m.coefficient, 1) AS coefficient
    FROM notes n
    LEFT JOIN matieres m ON m.school_id = n.school_id AND m.nom = n.matiere
    WHERE n.school_id = ? AND n.eleve_matricule = ? AND n.trimestre = ?
  `;
  if (annee) {
    sql += " AND COALESCE(n.annee, '') = ? ";
    params.push(annee);
  }
  sql += " ORDER BY n.matiere ASC, n.created_at DESC";

  const rows = await all(sql, params);
  if (!rows.length) {
    return { details: [], average: 0 };
  }

  const grouped = new Map();
  rows.forEach((row) => {
    const matiere = toTrimmed(row.matiere);
    if (!matiere) return;
    if (!grouped.has(matiere)) {
      grouped.set(matiere, {
        matiere,
        coefficient: Number(row.coefficient || 1),
        devoirs: [],
        composition: null
      });
    }
    const item = grouped.get(matiere);
    if (row.note_type === "composition") {
      if (item.composition === null) {
        item.composition = Number(row.note || 0);
      }
      return;
    }
    item.devoirs.push(Number(row.note || 0));
  });

  const details = [];
  grouped.forEach((item) => {
    const avgDevoirs = item.devoirs.length
      ? item.devoirs.reduce((sum, score) => sum + score, 0) / item.devoirs.length
      : 0;
    const moyenneMatiere = item.composition === null
      ? avgDevoirs
      : (avgDevoirs * 0.4) + (item.composition * 0.6);
    details.push({
      matiere: item.matiere,
      coefficient: Number(item.coefficient || 1),
      avgDevoirs: Number(avgDevoirs.toFixed(2)),
      composition: item.composition === null ? null : Number(item.composition.toFixed(2)),
      moyenneMatiere: Number(moyenneMatiere.toFixed(2))
    });
  });

  const numerator = details.reduce((sum, row) => sum + (row.moyenneMatiere * row.coefficient), 0);
  const denominator = details.reduce((sum, row) => sum + row.coefficient, 0) || 1;
  const average = Number((numerator / denominator).toFixed(2));
  return { details, average };
}

async function buildEleveAnnualAverage(schoolId, eleveMatricule, annee) {
  const trimestreValues = ["1", "2", "3"];
  const trimestrialAverages = await Promise.all(
    trimestreValues.map(async (tri) => {
      const bulletin = await buildEleveBulletin(schoolId, eleveMatricule, tri, annee);
      return Number(bulletin.average || 0);
    })
  );
  const annualAverage = trimestrialAverages.reduce((sum, val) => sum + val, 0) / 3;
  return Number(annualAverage.toFixed(2));
}

const SystemService = {
  getSchoolMonthOptions: async (schoolId) => {
    const school = await get("SELECT daterentrer FROM schools WHERE id = ?", [schoolId]);
    const fallbackStart = new Date();
    fallbackStart.setMonth(8, 1);
    const startDate = school && school.daterentrer ? school.daterentrer : fallbackStart.toISOString().slice(0, 10);
    const monthOptions = buildSchoolMonthOptions(startDate);
    const activeMonth = monthOptions.length ? monthOptions[monthOptions.length - 1].value : monthKey(new Date());
    return { startDate, monthOptions, activeMonth };
  },

  resolveFinanceScope: async (schoolId, options = {}) => {
    const monthData = await SystemService.getSchoolMonthOptions(schoolId);
    const period = String(options.period || "annual").toLowerCase() === "monthly" ? "monthly" : "annual";
    const requestedMonth = monthRange(options.month);
    const activeMonth = requestedMonth
      ? requestedMonth.month
      : (monthData.activeMonth || monthKey(new Date()));

    if (period === "monthly") {
      const range = monthRange(activeMonth) || monthRange(monthData.activeMonth || "");
      if (range) {
        return {
          period,
          month: range.month,
          startDate: range.start,
          endDate: range.end,
          monthOptions: monthData.monthOptions || [],
          activeMonth: range.month
        };
      }
    }

    const schoolYear = schoolYearRange(options.schoolYear);
    if (schoolYear) {
      return {
        period,
        schoolYear: schoolYear.schoolYear,
        startDate: schoolYear.start,
        endDate: schoolYear.end,
        monthOptions: monthData.monthOptions || [],
        activeMonth
      };
    }

    const now = new Date();
    const y = now.getFullYear();
    return {
      period,
      schoolYear: `${y}-${y + 1}`,
      startDate: `${y}-01-01`,
      endDate: `${y}-12-31`,
      monthOptions: monthData.monthOptions || [],
      activeMonth
    };
  },

  getAdministration: async (schoolId) => {
    return get("SELECT * FROM schools WHERE id = ?", [schoolId]);
  },

  updateAdministration: async (schoolId, payload) => {
    const {
      name,
      promoter_name,
      director_name,
      email,
      phone,
      address,
      localisation,
      logo_url,
      code_postal,
      daterentrer,
      current_school_year
    } = payload;
    return run(
      `UPDATE schools
       SET name = ?, promoter_name = ?, director_name = ?, email = ?, phone = ?, address = ?,
           localisation = ?, logo_url = ?, code_postal = ?, daterentrer = ?, current_school_year = COALESCE(?, current_school_year)
       WHERE id = ?`,
      [
        name,
        promoter_name || "",
        director_name || "",
        email,
        phone || "",
        address || "",
        localisation || "",
        logo_url || "",
        code_postal || "",
        toTrimmed(daterentrer) || null,
        safeSchoolYear(current_school_year) || null,
        schoolId
      ]
    );
  },

  listClasses: async (schoolId) => all("SELECT id, nom, niveau, annee, mensuel, effectif, totalpaie FROM classes WHERE school_id = ? ORDER BY nom ASC", [schoolId]),
  listElevesForSelect: async (schoolId) => all(
    "SELECT matricule, nom, prenom, classe FROM eleves WHERE school_id = ? ORDER BY nom ASC, prenom ASC",
    [schoolId]
  ),

  listEnseignants: async (schoolId) => all("SELECT * FROM enseignants WHERE school_id = ? ORDER BY created_at DESC", [schoolId]),
  createEnseignant: async (schoolId, payload) => {
    const { full_name, email, phone, matiere, status } = payload;
    if (!String(full_name || "").trim()) {
      throw new Error("Le nom complet est obligatoire");
    }
    const matiereValue = toTrimmed(matiere);
    if (!matiereValue) {
      throw new Error("La matiere est obligatoire");
    }
    const matiereExists = await get(
      "SELECT id, nom FROM matieres WHERE school_id = ? AND lower(trim(nom)) = lower(trim(?)) LIMIT 1",
      [schoolId, matiereValue]
    );
    if (!matiereExists) {
      throw new Error("Matiere invalide: choisissez une matiere existante");
    }

    const matricule = await generateEnseignantMatricule(schoolId, full_name);
    return run(
      `INSERT INTO enseignants (
        school_id, matricule, full_name, email, phone, matiere, status, type_payement, salaire_base, taux_horaire
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        matricule,
        full_name,
        email || null,
        phone || null,
        matiereExists.nom,
        status || "actif",
        toTrimmed(payload.type_payement) || null,
        Number(payload.salaire_base) || 0,
        Number(payload.taux_horaire) || 0
      ]
    );
  },
  deleteEnseignant: async (schoolId, id) => run("DELETE FROM enseignants WHERE school_id = ? AND id = ?", [schoolId, id]),

  listPersonnel: async (schoolId) => all("SELECT * FROM personnel WHERE school_id = ? ORDER BY created_at DESC", [schoolId]),
  createPersonnel: async (schoolId, payload) => {
    const nom = toTrimmed(payload.nom);
    const prenom = toTrimmed(payload.prenom);
    const fullName = toTrimmed(payload.full_name) || [nom, prenom].filter(Boolean).join(" ").trim();
    if (!fullName) {
      throw new Error("Le nom du personnel est obligatoire");
    }

    const matricule = await generatePersonnelMatricule(schoolId, fullName);
    return run(
      `INSERT INTO personnel (
        school_id, matricule, nom, prenom, full_name, role, type_personnel, type_payement,
        salaire_base, taux_horaire, date_embauche, statut, email, phone
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        matricule,
        nom || null,
        prenom || null,
        fullName,
        toTrimmed(payload.role) || null,
        toTrimmed(payload.type_personnel) || null,
        toTrimmed(payload.type_payement) || null,
        Number(payload.salaire_base) || 0,
        Number(payload.taux_horaire) || 0,
        toTrimmed(payload.date_embauche) || null,
        toTrimmed(payload.statut) || "actif",
        toTrimmed(payload.email) || null,
        toTrimmed(payload.phone) || null
      ]
    );
  },
  deletePersonnel: async (schoolId, id) => run("DELETE FROM personnel WHERE school_id = ? AND id = ?", [schoolId, id]),

  listMatieres: async (schoolId) => all("SELECT * FROM matieres WHERE school_id = ? ORDER BY nom ASC", [schoolId]),
  createMatiere: async (schoolId, payload) => run(
    "INSERT INTO matieres (school_id, nom, coefficient) VALUES (?, ?, ?)",
    [schoolId, payload.nom, Number(payload.coefficient) || 1]
  ),
  deleteMatiere: async (schoolId, id) => run("DELETE FROM matieres WHERE school_id = ? AND id = ?", [schoolId, id]),

  listAffectations: async (schoolId) => all(
    `SELECT a.*, e.full_name AS enseignant_nom
     FROM affectations a
     LEFT JOIN enseignants e ON e.school_id = a.school_id AND e.matricule = a.enseignant_matricule
     WHERE a.school_id = ?
     ORDER BY a.created_at DESC`,
    [schoolId]
  ),
  createAffectation: async (schoolId, payload) => {
    const classe = toTrimmed(payload.classe);
    const matiere = toTrimmed(payload.matiere);
    const enseignantMatricule = toTrimmed(payload.enseignant_matricule);

    if (!classe || !matiere || !enseignantMatricule) {
      throw new Error("Classe, matiere et enseignant sont obligatoires");
    }

    const enseignant = await get(
      "SELECT id FROM enseignants WHERE school_id = ? AND matricule = ?",
      [schoolId, enseignantMatricule]
    );
    if (!enseignant) {
      throw new Error("Enseignant introuvable");
    }

    const existing = await get(
      `SELECT id
       FROM affectations
       WHERE school_id = ?
         AND lower(trim(classe)) = lower(trim(?))
         AND lower(trim(matiere)) = lower(trim(?))`,
      [schoolId, classe, matiere]
    );
    if (existing) {
      throw new Error("Cette matiere est deja affectee a cette classe");
    }

    try {
      return await run(
        `INSERT INTO affectations (school_id, enseignant_matricule, classe, matiere)
         VALUES (?, ?, ?, ?)`,
        [schoolId, enseignantMatricule, classe, matiere]
      );
    } catch (err) {
      if (String(err && err.message || "").toLowerCase().includes("unique")) {
        throw new Error("Cette matiere est deja affectee a cette classe");
      }
      throw err;
    }
  },
  deleteAffectation: async (schoolId, id) => {
    await run("DELETE FROM emplois WHERE school_id = ? AND affectation_id = ?", [schoolId, id]);
    return run("DELETE FROM affectations WHERE school_id = ? AND id = ?", [schoolId, id]);
  },

  listEmplois: async (schoolId, filters) => {
    const filterObj = typeof filters === "string"
      ? { classe: filters }
      : (filters || {});
    const classe = toTrimmed(filterObj.classe);
    const jour = toTrimmed(filterObj.jour);

    const params = [schoolId];
    let sql = `
      SELECT em.id, em.affectation_id, em.jour, em.heure_debut, em.heure_fin, a.classe, a.matiere, a.enseignant_matricule,
             e.full_name AS enseignant_nom
      FROM emplois em
      JOIN affectations a ON a.id = em.affectation_id
      LEFT JOIN enseignants e ON e.school_id = a.school_id AND e.matricule = a.enseignant_matricule
      WHERE em.school_id = ?
    `;
    if (classe) {
      sql += " AND a.classe = ? ";
      params.push(classe);
    }
    if (jour) {
      sql += " AND em.jour = ? ";
      params.push(jour);
    }
    sql += " ORDER BY a.classe ASC, em.jour ASC, em.heure_debut ASC";
    return all(sql, params);
  },
  getEmploiById: async (schoolId, id) => {
    return get(
      `SELECT em.id, em.affectation_id, em.jour, em.heure_debut, em.heure_fin, a.classe, a.matiere, a.enseignant_matricule
       FROM emplois em
       JOIN affectations a ON a.id = em.affectation_id
       WHERE em.school_id = ? AND em.id = ?`,
      [schoolId, id]
    );
  },
  createEmploi: async (schoolId, payload) => {
    const affectationId = Number(payload.affectation_id);
    const jour = toTrimmed(payload.jour);
    const heureDebut = normalizeTime(payload.heure_debut);
    const heureFin = normalizeTime(payload.heure_fin);

    if (!Number.isInteger(affectationId) || affectationId <= 0) {
      throw new Error("Affectation invalide");
    }
    if (!jour || !heureDebut) {
      throw new Error("Jour et heure de debut sont obligatoires");
    }
    if (heureFin && heureFin <= heureDebut) {
      throw new Error("L'heure de fin doit etre apres l'heure de debut");
    }

    const affectation = await get(
      "SELECT id, classe, enseignant_matricule FROM affectations WHERE school_id = ? AND id = ?",
      [schoolId, affectationId]
    );
    if (!affectation) {
      throw new Error("Affectation introuvable");
    }

    const slotEnd = heureFin || heureDebut;

    const classConflict = await get(
      `SELECT em.id
       FROM emplois em
       JOIN affectations a ON a.id = em.affectation_id
       WHERE em.school_id = ?
         AND a.classe = ?
         AND em.jour = ?
         AND (
           em.heure_debut = ?
           OR (? < COALESCE(em.heure_fin, em.heure_debut) AND ? > em.heure_debut)
         )`,
      [schoolId, affectation.classe, jour, heureDebut, heureDebut, slotEnd]
    );
    if (classConflict) {
      throw new Error("Ce creneau est deja occupe pour cette classe");
    }

    const teacherConflict = await get(
      `SELECT em.id
       FROM emplois em
       JOIN affectations a ON a.id = em.affectation_id
       WHERE em.school_id = ?
         AND a.enseignant_matricule = ?
         AND em.jour = ?
         AND (
           em.heure_debut = ?
           OR (? < COALESCE(em.heure_fin, em.heure_debut) AND ? > em.heure_debut)
         )`,
      [schoolId, affectation.enseignant_matricule, jour, heureDebut, heureDebut, slotEnd]
    );
    if (teacherConflict) {
      throw new Error("Cet enseignant a deja un cours sur ce creneau");
    }

    return run(
      `INSERT INTO emplois (school_id, affectation_id, jour, heure_debut, heure_fin)
       VALUES (?, ?, ?, ?, ?)`,
      [schoolId, affectationId, jour, heureDebut, heureFin || null]
    );
  },
  updateEmploi: async (schoolId, id, payload) => {
    const emploiId = Number(id);
    const affectationId = Number(payload.affectation_id);
    const jour = toTrimmed(payload.jour);
    const heureDebut = normalizeTime(payload.heure_debut);
    const heureFin = normalizeTime(payload.heure_fin);

    if (!Number.isInteger(emploiId) || emploiId <= 0) {
      throw new Error("Emploi invalide");
    }
    if (!Number.isInteger(affectationId) || affectationId <= 0) {
      throw new Error("Affectation invalide");
    }
    if (!jour || !heureDebut) {
      throw new Error("Jour et heure de debut sont obligatoires");
    }
    if (heureFin && heureFin <= heureDebut) {
      throw new Error("L'heure de fin doit etre apres l'heure de debut");
    }

    const existing = await get("SELECT id FROM emplois WHERE school_id = ? AND id = ?", [schoolId, emploiId]);
    if (!existing) throw new Error("Creneau introuvable");

    const affectation = await get(
      "SELECT id, classe, enseignant_matricule FROM affectations WHERE school_id = ? AND id = ?",
      [schoolId, affectationId]
    );
    if (!affectation) throw new Error("Affectation introuvable");

    const slotEnd = heureFin || heureDebut;
    const classConflict = await get(
      `SELECT em.id
       FROM emplois em
       JOIN affectations a ON a.id = em.affectation_id
       WHERE em.school_id = ?
         AND em.id <> ?
         AND a.classe = ?
         AND em.jour = ?
         AND (
           em.heure_debut = ?
           OR (? < COALESCE(em.heure_fin, em.heure_debut) AND ? > em.heure_debut)
         )`,
      [schoolId, emploiId, affectation.classe, jour, heureDebut, heureDebut, slotEnd]
    );
    if (classConflict) throw new Error("Ce creneau est deja occupe pour cette classe");

    const teacherConflict = await get(
      `SELECT em.id
       FROM emplois em
       JOIN affectations a ON a.id = em.affectation_id
       WHERE em.school_id = ?
         AND em.id <> ?
         AND a.enseignant_matricule = ?
         AND em.jour = ?
         AND (
           em.heure_debut = ?
           OR (? < COALESCE(em.heure_fin, em.heure_debut) AND ? > em.heure_debut)
         )`,
      [schoolId, emploiId, affectation.enseignant_matricule, jour, heureDebut, heureDebut, slotEnd]
    );
    if (teacherConflict) throw new Error("Cet enseignant a deja un cours sur ce creneau");

    return run(
      `UPDATE emplois
       SET affectation_id = ?, jour = ?, heure_debut = ?, heure_fin = ?
       WHERE school_id = ? AND id = ?`,
      [affectationId, jour, heureDebut, heureFin || null, schoolId, emploiId]
    );
  },
  deleteEmploi: async (schoolId, id) => run("DELETE FROM emplois WHERE school_id = ? AND id = ?", [schoolId, id]),

  listNotes: async (schoolId, matricule) => {
    if (matricule) {
      return all("SELECT * FROM notes WHERE school_id = ? AND eleve_matricule LIKE ? ORDER BY created_at DESC", [schoolId, `%${matricule}%`]);
    }
    return all("SELECT * FROM notes WHERE school_id = ? ORDER BY created_at DESC", [schoolId]);
  },
  listMatieresByEleveMatricule: async (schoolId, eleveMatricule) => {
    const matricule = toTrimmed(eleveMatricule);
    if (!matricule) {
      return { eleve: null, matieres: [] };
    }

    const eleve = await get(
      "SELECT matricule, nom, prenom, classe FROM eleves WHERE school_id = ? AND matricule = ?",
      [schoolId, matricule]
    );
    if (!eleve) {
      return { eleve: null, matieres: [] };
    }

    const affectationRows = await all(
      `SELECT DISTINCT matiere
       FROM affectations
       WHERE school_id = ? AND classe = ? AND TRIM(COALESCE(matiere, '')) <> ''
       ORDER BY matiere ASC`,
      [schoolId, eleve.classe]
    );

    let matieres = affectationRows.map((row) => toTrimmed(row.matiere)).filter(Boolean);

    if (!matieres.length) {
      const globalRows = await all(
        "SELECT nom FROM matieres WHERE school_id = ? ORDER BY nom ASC",
        [schoolId]
      );
      matieres = globalRows.map((row) => toTrimmed(row.nom)).filter(Boolean);
    }

    return {
      eleve,
      matieres: [...new Set(matieres)]
    };
  },
  createNote: async (schoolId, payload) => {
    const eleveMatricule = toTrimmed(payload.eleve_matricule);
    const matiere = toTrimmed(payload.matiere);
    const trimestre = toTrimmed(payload.trimestre);
    const noteType = toTrimmed(payload.note_type || "devoir").toLowerCase();
    const note = Number(payload.note);
    const annee = toTrimmed(payload.annee) || null;
    const description = toTrimmed(payload.description) || null;

    if (!eleveMatricule || !matiere || !trimestre || !Number.isFinite(note)) {
      throw new Error("Donnees de note invalides");
    }
    if (note < 0 || note > 20) {
      throw new Error("La note doit etre comprise entre 0 et 20");
    }
    if (!NOTE_TYPES.includes(noteType)) {
      throw new Error("Type de note invalide");
    }

    const enrollmentContext = await TransfersService.getOrCreateActiveEnrollmentByMatricule(schoolId, eleveMatricule);
    const matiereOptions = await SystemService.listMatieresByEleveMatricule(schoolId, eleveMatricule);
    if (!matiereOptions.eleve) {
      throw new Error("Eleve introuvable");
    }
    const allowedSet = new Set((matiereOptions.matieres || []).map((item) => item.toLowerCase()));
    if (allowedSet.size && !allowedSet.has(matiere.toLowerCase())) {
      throw new Error("Matiere invalide pour la classe de cet eleve");
    }

    if (noteType === "composition") {
      const existing = await get(
        `SELECT id FROM notes
         WHERE school_id = ? AND eleve_matricule = ? AND matiere = ? AND trimestre = ? AND note_type = 'composition'
         AND COALESCE(annee, '') = COALESCE(?, '')`,
        [schoolId, eleveMatricule, matiere, trimestre, annee]
      );
      if (existing) {
        throw new Error("Une composition existe deja pour cet eleve, cette matiere et ce trimestre");
      }
    }

    const insertResult = await run(
      `INSERT INTO notes (school_id, eleve_matricule, matiere, trimestre, note, annee, note_type, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [schoolId, eleveMatricule, matiere, trimestre, note, annee, noteType, description]
    );
    const matiereRow = await get(
      "SELECT id FROM matieres WHERE school_id = ? AND lower(trim(nom)) = lower(trim(?)) LIMIT 1",
      [schoolId, matiere]
    );
    await run(
      `INSERT INTO grades (enrollment_id, matiere_id, trimestre, note, school_year, source_note_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        enrollmentContext.enrollment.id,
        matiereRow ? matiereRow.id : null,
        trimestre,
        note,
        annee || "",
        insertResult.lastID
      ]
    );
    await run(
      "UPDATE notes SET enrollment_id = ? WHERE id = ?",
      [enrollmentContext.enrollment.id, insertResult.lastID]
    );
    return insertResult;
  },
  deleteNote: async (schoolId, id) => {
    await TransfersService.ensureNoteMutable(schoolId, id);
    await run("DELETE FROM grades WHERE source_note_id = ?", [id]);
    return run("DELETE FROM notes WHERE school_id = ? AND id = ?", [schoolId, id]);
  },
  bulletinByEleve: async (schoolId, matricule, trimestre = "1", annee = "") => {
    const eleve = await get("SELECT id, matricule, nom, prenom, classe FROM eleves WHERE school_id = ? AND matricule = ?", [schoolId, matricule]);
    if (!eleve) {
      return null;
    }

    const ownBulletin = await buildEleveBulletin(schoolId, eleve.matricule, trimestre, annee);
    const classEleves = await all("SELECT matricule FROM eleves WHERE school_id = ? AND classe = ?", [schoolId, eleve.classe]);

    const classAverages = await Promise.all(
      classEleves.map(async (row) => {
        const bulletin = await buildEleveBulletin(schoolId, row.matricule, trimestre, annee);
        return { matricule: row.matricule, average: bulletin.average };
      })
    );

    classAverages.sort((a, b) => b.average - a.average);
    const rank = classAverages.findIndex((item) => item.matricule === eleve.matricule) + 1;
    const mention = deriveMention(ownBulletin.average);
    const decision = ownBulletin.average >= 10 ? "Admis" : "Redouble";

    return {
      eleve,
      trimestre,
      annee,
      details: ownBulletin.details,
      average: ownBulletin.average,
      rank: rank > 0 ? rank : null,
      classSize: classAverages.length,
      mention,
      decision,
      appreciation: deriveAppreciation(mention)
    };
  },
  bulletinByClasse: async (schoolId, classe, trimestre = "1", annee = "") => {
    const targetClasse = toTrimmed(classe);
    if (!targetClasse) return [];
    const eleves = await all(
      "SELECT matricule, nom, prenom FROM eleves WHERE school_id = ? AND classe = ? ORDER BY nom ASC, prenom ASC",
      [schoolId, targetClasse]
    );
    const result = await Promise.all(
      eleves.map(async (eleve) => {
        const bulletin = await buildEleveBulletin(schoolId, eleve.matricule, trimestre, annee);
        return { ...eleve, moyenne_generale: bulletin.average };
      })
    );
    result.sort((a, b) => b.moyenne_generale - a.moyenne_generale);
    return result.map((row, index) => ({ ...row, rang: index + 1 }));
  },

  listPaiements: async (schoolId, options = {}) => {
    const scope = await SystemService.resolveFinanceScope(schoolId, options);
    const filter = buildScopeClause(scope, "COALESCE(date_payement, created_at)");
    return all(
      `SELECT *
       FROM paiements
       WHERE school_id = ? AND ${filter.clause}
       ORDER BY COALESCE(date_payement, created_at) DESC, created_at DESC`,
      [schoolId, ...filter.params]
    );
  },
  createPaiement: async (schoolId, payload) => {
    const eleveMatricule = toTrimmed(payload.eleve_matricule) || null;
    const montant = Number(payload.montant) || 0;
    if (montant <= 0) {
      throw new Error("Montant invalide");
    }
    await run(
      `INSERT INTO paiements (school_id, eleve_matricule, montant, mois, date_payement, mode_payement, annee_scolaire)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [schoolId, eleveMatricule, montant, payload.mois || null, payload.date_payement || null, payload.mode_payement || null, payload.annee_scolaire || null]
    );

    if (eleveMatricule) {
      await run(
        `UPDATE eleves
         SET caise = COALESCE(caise, 0) + ?
         WHERE school_id = ? AND matricule = ?`,
        [montant, schoolId, eleveMatricule]
      );

      const eleve = await get("SELECT classe FROM eleves WHERE school_id = ? AND matricule = ?", [schoolId, eleveMatricule]);
      if (eleve && eleve.classe) {
        await run(
          "UPDATE classes SET totalpaie = COALESCE(totalpaie, 0) + ? WHERE school_id = ? AND nom = ?",
          [montant, schoolId, eleve.classe]
        );
      }
    }
  },
  deletePaiement: async (schoolId, id) => run("DELETE FROM paiements WHERE school_id = ? AND id = ?", [schoolId, id]),

  listSalaires: async (schoolId, filters = {}) => {
    const matricule = toTrimmed(filters.matricule);
    const sourceType = toTrimmed(filters.source_type).toLowerCase();
    const params = [schoolId];
    let sql = `
      SELECT
        s.*,
        CASE
          WHEN p.matricule IS NOT NULL THEN 'personnel'
          WHEN e.matricule IS NOT NULL THEN 'enseignant'
          ELSE 'inconnu'
        END AS source_type,
        COALESCE(p.full_name, e.full_name, '') AS source_nom
      FROM salaires s
      LEFT JOIN personnel p ON p.school_id = s.school_id AND p.matricule = s.personnel_matricule
      LEFT JOIN enseignants e ON e.school_id = s.school_id AND e.matricule = s.personnel_matricule
      WHERE s.school_id = ?
    `;

    if (matricule) {
      sql += " AND s.personnel_matricule LIKE ? ";
      params.push(`%${matricule}%`);
    }

    if (sourceType === "personnel") {
      sql += " AND p.matricule IS NOT NULL ";
    } else if (sourceType === "enseignant") {
      sql += " AND e.matricule IS NOT NULL ";
    }

    sql += " ORDER BY s.created_at DESC";
    return all(sql, params);
  },
  createSalaire: async (schoolId, payload) => run(
    "INSERT INTO salaires (school_id, personnel_matricule, mois, montant, mode_payement, date_payement) VALUES (?, ?, ?, ?, ?, ?)",
    [schoolId, payload.personnel_matricule || null, payload.mois || null, Number(payload.montant) || 0, payload.mode_payement || null, payload.date_payement || null]
  ),
  deleteSalaire: async (schoolId, id) => run("DELETE FROM salaires WHERE school_id = ? AND id = ?", [schoolId, id]),

  listDepenses: async (schoolId) => all("SELECT * FROM depenses WHERE school_id = ? ORDER BY created_at DESC", [schoolId]),
  createDepense: async (schoolId, payload) => run(
    "INSERT INTO depenses (school_id, categorie, description, motif, montant, date_depenses, valide_par) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [schoolId, payload.categorie || null, payload.description || null, payload.motif || "depense", Number(payload.montant) || 0, payload.date_depenses || null, payload.valide_par || null]
  ),
  deleteDepense: async (schoolId, id) => run("DELETE FROM depenses WHERE school_id = ? AND id = ?", [schoolId, id]),

  listRetraitsPromoteur: async (schoolId) => all("SELECT * FROM retraits_promoteur WHERE school_id = ? ORDER BY created_at DESC", [schoolId]),
  createRetraitPromoteur: async (schoolId, payload) => run(
    "INSERT INTO retraits_promoteur (school_id, montant, date_retrait, motif, valide_par) VALUES (?, ?, ?, ?, ?)",
    [schoolId, Number(payload.montant) || 0, payload.date_retrait || null, payload.motif || null, payload.valide_par || null]
  ),
  deleteRetraitPromoteur: async (schoolId, id) => run("DELETE FROM retraits_promoteur WHERE school_id = ? AND id = ?", [schoolId, id]),

  getFinanceSummary: async (schoolId, options = {}) => {
    const scope = await SystemService.resolveFinanceScope(schoolId, options);
    const payFilter = buildScopeClause(scope, "COALESCE(date_payement, created_at)");
    const depFilter = buildScopeClause(scope, "COALESCE(date_depenses, created_at)");
    const salFilter = buildScopeClause(scope, "COALESCE(date_payement, created_at)");
    const retFilter = buildScopeClause(scope, "COALESCE(date_retrait, created_at)");

    const [paiementsRow, depensesRow, salairesRow, retraitsRow] = await Promise.all([
      get(`SELECT COALESCE(SUM(montant), 0) AS total FROM paiements WHERE school_id = ? AND ${payFilter.clause}`, [schoolId, ...payFilter.params]),
      get(`SELECT COALESCE(SUM(montant), 0) AS total FROM depenses WHERE school_id = ? AND ${depFilter.clause}`, [schoolId, ...depFilter.params]),
      get(`SELECT COALESCE(SUM(montant), 0) AS total FROM salaires WHERE school_id = ? AND ${salFilter.clause}`, [schoolId, ...salFilter.params]),
      get(`SELECT COALESCE(SUM(montant), 0) AS total FROM retraits_promoteur WHERE school_id = ? AND ${retFilter.clause}`, [schoolId, ...retFilter.params])
    ]);

    const entrees = Number(paiementsRow.total || 0);
    const sorties = Number(depensesRow.total || 0) + Number(salairesRow.total || 0) + Number(retraitsRow.total || 0);

    return {
      paiements: entrees,
      depenses: Number(depensesRow.total || 0),
      salaires: Number(salairesRow.total || 0),
      retraits: Number(retraitsRow.total || 0),
      solde: entrees - sorties,
      scope
    };
  },

  getTresorerie: async (schoolId, options = {}) => {
    const summary = await SystemService.getFinanceSummary(schoolId, options);
    const scope = summary.scope;
    const payFilter = buildScopeClause(scope, "COALESCE(date_payement, created_at)");
    const depFilter = buildScopeClause(scope, "COALESCE(date_depenses, created_at)");
    const salFilter = buildScopeClause(scope, "COALESCE(date_payement, created_at)");

    const [paiements, depenses, salaires, forecast, tuitionForecast] = await Promise.all([
      all(
        `SELECT 'paiement' AS type, montant, COALESCE(date_payement, created_at) AS date_mouvement, created_at
         FROM paiements
         WHERE school_id = ? AND ${payFilter.clause}`,
        [schoolId, ...payFilter.params]
      ),
      all(
        `SELECT 'depense' AS type, montant, COALESCE(date_depenses, created_at) AS date_mouvement, created_at
         FROM depenses
         WHERE school_id = ? AND ${depFilter.clause}`,
        [schoolId, ...depFilter.params]
      ),
      all(
        `SELECT 'salaire' AS type, montant, COALESCE(date_payement, created_at) AS date_mouvement, created_at
         FROM salaires
         WHERE school_id = ? AND ${salFilter.clause}`,
        [schoolId, ...salFilter.params]
      ),
      SystemService.getMonthlyForecast(schoolId),
      SystemService.getTuitionForecast(schoolId, { month: scope.activeMonth })
    ]);

    const mouvements = [...paiements, ...depenses, ...salaires]
      .sort((a, b) => new Date(b.date_mouvement || b.created_at) - new Date(a.date_mouvement || a.created_at))
      .slice(0, 20);

    return {
      summary,
      mouvements,
      forecast,
      tuitionForecast,
      monthOptions: scope.monthOptions || [],
      activeMonth: scope.activeMonth || "",
      activePeriod: scope.period || "annual"
    };
  },

  getMonthlyForecast: async (schoolId) => {
    const [personnelRows, enseignantsRows, depensesByMonth, retraitsByMonth] = await Promise.all([
      all(
        `SELECT matricule, full_name, role, type_payement, salaire_base, taux_horaire, statut
         FROM personnel
         WHERE school_id = ? AND COALESCE(statut, 'actif') = 'actif'`,
        [schoolId]
      ),
      all(
        `SELECT matricule, full_name, matiere, type_payement, salaire_base, taux_horaire, status
         FROM enseignants
         WHERE school_id = ? AND COALESCE(status, 'actif') = 'actif'`,
        [schoolId]
      ),
      all(
        `SELECT strftime('%Y-%m', COALESCE(date_depenses, created_at)) AS ym, SUM(montant) AS total
         FROM depenses
         WHERE school_id = ?
         GROUP BY ym`,
        [schoolId]
      ),
      all(
        `SELECT strftime('%Y-%m', COALESCE(date_retrait, created_at)) AS ym, SUM(montant) AS total
         FROM retraits_promoteur
         WHERE school_id = ?
         GROUP BY ym`,
        [schoolId]
      )
    ]);

    const personnelDetails = (personnelRows || []).map((row) => ({
      source: "personnel",
      matricule: row.matricule || "-",
      nom: row.full_name || "-",
      poste: row.role || "-",
      type_payement: row.type_payement || "mensuel",
      montant_prevu: computeMonthlyPayroll(row.type_payement, row.salaire_base, row.taux_horaire)
    }));
    const enseignantsDetails = (enseignantsRows || []).map((row) => ({
      source: "enseignant",
      matricule: row.matricule || "-",
      nom: row.full_name || "-",
      poste: row.matiere ? `Enseignant ${row.matiere}` : "Enseignant",
      type_payement: row.type_payement || "mensuel",
      montant_prevu: computeMonthlyPayroll(row.type_payement, row.salaire_base, row.taux_horaire)
    }));

    const depTotals = (depensesByMonth || []).map((row) => Number(row.total || 0));
    const retrTotals = (retraitsByMonth || []).map((row) => Number(row.total || 0));

    const avgDepenses = depTotals.length ? Number((depTotals.reduce((s, v) => s + v, 0) / depTotals.length).toFixed(2)) : 0;
    const avgRetraits = retrTotals.length ? Number((retrTotals.reduce((s, v) => s + v, 0) / retrTotals.length).toFixed(2)) : 0;
    const totalSalairesPrevus = Number(
      [...personnelDetails, ...enseignantsDetails].reduce((sum, row) => sum + Number(row.montant_prevu || 0), 0).toFixed(2)
    );

    return {
      personnelCount: personnelDetails.length,
      enseignantsCount: enseignantsDetails.length,
      totalActifs: personnelDetails.length + enseignantsDetails.length,
      totalSalairesPrevus,
      averageDepenses: avgDepenses,
      averageRetraits: avgRetraits,
      totalSortiesPrevues: Number((totalSalairesPrevus + avgDepenses + avgRetraits).toFixed(2)),
      details: [...personnelDetails, ...enseignantsDetails]
    };
  },

  getTuitionForecast: async (schoolId, options = {}) => {
    const [school, classes, monthlyForecast] = await Promise.all([
      get("SELECT daterentrer FROM schools WHERE id = ?", [schoolId]),
      all(
        `SELECT nom, niveau, annee, COALESCE(mensuel, 0) AS mensuel, COALESCE(effectif, 0) AS effectif, COALESCE(totalpaie, 0) AS totalpaie
         FROM classes
         WHERE school_id = ?
         ORDER BY nom ASC`,
        [schoolId]
      ),
      SystemService.getMonthlyForecast(schoolId)
    ]);

    const fallbackStart = new Date();
    fallbackStart.setMonth(8, 1);
    const startDate = school && school.daterentrer ? school.daterentrer : fallbackStart.toISOString().slice(0, 10);
    const monthOptions = buildSchoolMonthOptions(startDate);
    const requestedMonth = monthRange(options.month);
    const activeMonth = requestedMonth && monthOptions.some((row) => row.value === requestedMonth.month)
      ? requestedMonth.month
      : (monthOptions.length ? monthOptions[monthOptions.length - 1].value : monthKey(new Date()));
    const selectedIndex = monthOptions.findIndex((row) => row.value === activeMonth);
    const moisEcoules = Math.max(selectedIndex + 1, 1);

    const classRows = (classes || []).map((row) => {
      const mensualite = Number(row.mensuel || 0);
      const effectif = Number(row.effectif || 0);
      const attenduMensuel = mensualite * effectif;
      const attenduCumule = attenduMensuel * moisEcoules;
      const payeCumule = Number(row.totalpaie || 0);
      const resteCumule = Math.max(attenduCumule - payeCumule, 0);
      return {
        ...row,
        mensualite,
        effectif,
        attendu_mensuel: attenduMensuel,
        attendu_cumule: attenduCumule,
        paye_cumule: payeCumule,
        reste_cumule: resteCumule
      };
    });

    const totalMensuelPrevu = classRows.reduce((sum, row) => sum + Number(row.attendu_mensuel || 0), 0);
    const totalCumulePrevu = classRows.reduce((sum, row) => sum + Number(row.attendu_cumule || 0), 0);
    const totalPayeCumule = classRows.reduce((sum, row) => sum + Number(row.paye_cumule || 0), 0);
    const totalResteCumule = classRows.reduce((sum, row) => sum + Number(row.reste_cumule || 0), 0);
    const netMensuelPrevu = Number((totalMensuelPrevu - Number(monthlyForecast.totalSortiesPrevues || 0)).toFixed(2));

    return {
      startDate,
      moisEcoules,
      activeMonth,
      monthOptions,
      classes: classRows,
      totalMensuelPrevu,
      totalCumulePrevu,
      totalPayeCumule,
      totalResteCumule,
      netMensuelPrevu
    };
  },

  mutateClassToNextYear: async (schoolId, payload) => {
    const classe = toTrimmed(payload.classe);
    const fromYear = safeSchoolYear(payload.from_year || payload.annee_source || "");
    const toYear = safeSchoolYear(payload.to_year || payload.annee_cible || "");
    const trimestre = toTrimmed(payload.trimestre || "3") || "3";

    if (!classe) throw new Error("Classe requise");
    if (!fromYear) throw new Error("Annee source invalide (format AAAA-AAAA)");
    if (!toYear) throw new Error("Annee cible invalide (format AAAA-AAAA)");
    if (!["1", "2", "3"].includes(trimestre)) throw new Error("Trimestre invalide");

    const sourceClass = await get(
      "SELECT * FROM classes WHERE school_id = ? AND nom = ? LIMIT 1",
      [schoolId, classe]
    );
    if (!sourceClass) throw new Error("Classe source introuvable");

    const eleves = await all(
      "SELECT id, matricule, classe FROM eleves WHERE school_id = ? AND classe = ? ORDER BY nom ASC, prenom ASC",
      [schoolId, classe]
    );
    if (!eleves.length) {
      throw new Error("Aucun eleve dans cette classe");
    }

    const decisions = await Promise.all(
      eleves.map(async (eleve) => {
        const bulletin = await buildEleveBulletin(schoolId, eleve.matricule, trimestre, fromYear);
        const moyenne = Number(bulletin.average || 0);
        const admis = moyenne >= 10;
        const promotedName = resolvePromotedClassName(eleve.classe || classe);
        const targetClass = admis ? promotedName : (eleve.classe || classe);
        return {
          id: eleve.id,
          matricule: eleve.matricule,
          moyenne,
          admis,
          oldClass: eleve.classe || classe,
          targetClass
        };
      })
    );

    await run("BEGIN TRANSACTION");
    try {
      const impactedClasses = new Set([classe]);
      const createdClasses = [];

      for (const row of decisions) {
        impactedClasses.add(row.targetClass);
        if (row.targetClass !== row.oldClass) {
          const exists = await get(
            "SELECT id FROM classes WHERE school_id = ? AND nom = ?",
            [schoolId, row.targetClass]
          );
          if (!exists) {
            await run(
              `INSERT INTO classes (school_id, nom, niveau, annee, mensuel, frais_inscription, effectif_max, effectif, totalapaie, totalpaie)
               VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`,
              [
                schoolId,
                row.targetClass,
                sourceClass.niveau || null,
                toYear,
                Number(sourceClass.mensuel || 0),
                Number(sourceClass.frais_inscription || 0),
                Number(sourceClass.effectif_max || 50)
              ]
            );
            createdClasses.push(row.targetClass);
          } else {
            await run(
              "UPDATE classes SET annee = COALESCE(?, annee) WHERE school_id = ? AND nom = ?",
              [toYear, schoolId, row.targetClass]
            );
          }
        }

        await run(
          "UPDATE eleves SET classe = ? WHERE school_id = ? AND id = ?",
          [row.targetClass, schoolId, row.id]
        );
      }

      await run(
        "UPDATE classes SET annee = ? WHERE school_id = ? AND nom IN (" +
        Array.from(impactedClasses).map(() => "?").join(",") + ")",
        [toYear, schoolId, ...Array.from(impactedClasses)]
      );

      for (const className of impactedClasses) {
        const countRow = await get(
          "SELECT COUNT(*) AS total FROM eleves WHERE school_id = ? AND classe = ?",
          [schoolId, className]
        );
        await run(
          "UPDATE classes SET effectif = ? WHERE school_id = ? AND nom = ?",
          [Number(countRow && countRow.total ? countRow.total : 0), schoolId, className]
        );
      }

      await run("COMMIT");

      const admisCount = decisions.filter((row) => row.admis).length;
      const redoublants = decisions.length - admisCount;
      return {
        total: decisions.length,
        admis: admisCount,
        redoublants,
        createdClasses
      };
    } catch (err) {
      await run("ROLLBACK");
      throw err;
    }
  },

  mutateSchoolToNextYear: async (schoolId, payload) => {
    const fromYear = safeSchoolYear(payload.from_year || payload.annee_source || "");
    const toYear = safeSchoolYear(payload.to_year || payload.annee_cible || "");
    const adminUserId = Number(payload.admin_user_id || 0);
    const adminPassword = String(payload.admin_password || "");

    if (!fromYear) throw new Error("Annee source invalide (format AAAA-AAAA)");
    if (!toYear) throw new Error("Annee cible invalide (format AAAA-AAAA)");
    if (fromYear === toYear) throw new Error("Annee source et annee cible doivent etre differentes");
    if (!Number.isInteger(adminUserId) || adminUserId <= 0) {
      throw new Error("Administrateur de confirmation introuvable");
    }
    if (!adminPassword) throw new Error("Mot de passe administrateur requis");

    const adminUser = await get(
      `SELECT id, school_id, role, password_hash
       FROM users
       WHERE id = ? AND school_id = ?`,
      [adminUserId, schoolId]
    );
    if (!adminUser || adminUser.role !== "school_admin") {
      throw new Error("Confirmation reservee a un administrateur de l'etablissement");
    }

    const passwordOk = await bcrypt.compare(adminPassword, String(adminUser.password_hash || ""));
    if (!passwordOk) {
      throw new Error("Mot de passe administrateur invalide");
    }

    const trimestres = await all(
      `
      SELECT DISTINCT TRIM(COALESCE(trimestre, '')) AS trimestre
      FROM notes
      WHERE school_id = ? AND COALESCE(annee, '') = ?
      `,
      [schoolId, fromYear]
    );
    const tris = new Set((trimestres || []).map((r) => String(r.trimestre || "").trim()).filter(Boolean));
    const hasAllTrimestres = ["1", "2", "3"].every((tri) => tris.has(tri));
    if (!hasAllTrimestres) {
      throw new Error("Mutation annuelle impossible: les 3 trimestres ne sont pas encore completes");
    }

    const classes = await all(
      "SELECT * FROM classes WHERE school_id = ? AND COALESCE(annee, '') = ? ORDER BY nom ASC",
      [schoolId, fromYear]
    );
    if (!classes.length) {
      throw new Error("Aucune classe source trouvee pour cette annee scolaire");
    }

    const eleves = await all(
      `
      SELECT id, matricule, classe
      FROM eleves
      WHERE school_id = ?
        AND classe IN (${classes.map(() => "?").join(",")})
      ORDER BY nom ASC, prenom ASC
      `,
      [schoolId, ...classes.map((c) => c.nom)]
    );
    if (!eleves.length) {
      throw new Error("Aucun eleve a muter pour cette annee scolaire");
    }

    const classByName = new Map(classes.map((c) => [c.nom, c]));
    const decisions = await Promise.all(
      eleves.map(async (eleve) => {
        const oldClass = String(eleve.classe || "").trim();
        const moyenneAnnuelle = await buildEleveAnnualAverage(schoolId, eleve.matricule, fromYear);
        const admis = moyenneAnnuelle >= 10;
        const promotedName = resolvePromotedClassName(oldClass);
        const targetClass = admis ? promotedName : oldClass;
        return {
          id: eleve.id,
          matricule: eleve.matricule,
          oldClass,
          targetClass,
          admis,
          moyenneAnnuelle
        };
      })
    );

    await run("BEGIN TRANSACTION");
    try {
      const impactedClasses = new Set(classes.map((c) => c.nom));
      const createdClasses = [];

      for (const row of decisions) {
        impactedClasses.add(row.targetClass);
        if (row.targetClass !== row.oldClass) {
          const exists = await get(
            "SELECT id FROM classes WHERE school_id = ? AND nom = ?",
            [schoolId, row.targetClass]
          );
          if (!exists) {
            const sourceClass = classByName.get(row.oldClass) || classes[0];
            await run(
              `INSERT INTO classes (school_id, nom, niveau, annee, mensuel, frais_inscription, effectif_max, effectif, totalapaie, totalpaie)
               VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`,
              [
                schoolId,
                row.targetClass,
                sourceClass ? sourceClass.niveau : null,
                toYear,
                Number(sourceClass ? sourceClass.mensuel : 0),
                Number(sourceClass ? sourceClass.frais_inscription : 0),
                Number(sourceClass ? sourceClass.effectif_max : 50)
              ]
            );
            createdClasses.push(row.targetClass);
          }
        }

        await run(
          "UPDATE eleves SET classe = ? WHERE school_id = ? AND id = ?",
          [row.targetClass, schoolId, row.id]
        );
      }

      await run(
        "UPDATE classes SET annee = ? WHERE school_id = ? AND nom IN (" +
        Array.from(impactedClasses).map(() => "?").join(",") + ")",
        [toYear, schoolId, ...Array.from(impactedClasses)]
      );

      for (const className of impactedClasses) {
        const countRow = await get(
          "SELECT COUNT(*) AS total FROM eleves WHERE school_id = ? AND classe = ?",
          [schoolId, className]
        );
        await run(
          "UPDATE classes SET effectif = ? WHERE school_id = ? AND nom = ?",
          [Number(countRow && countRow.total ? countRow.total : 0), schoolId, className]
        );
      }

      await run(
        "UPDATE schools SET current_school_year = ? WHERE id = ?",
        [toYear, schoolId]
      );

      await run("COMMIT");

      const admisCount = decisions.filter((row) => row.admis).length;
      const redoublants = decisions.length - admisCount;
      return {
        total: decisions.length,
        admis: admisCount,
        redoublants,
        createdClasses,
        fromYear,
        toYear
      };
    } catch (err) {
      await run("ROLLBACK");
      throw err;
    }
  },

  listUsers: async (schoolId) => all("SELECT id, matricule, full_name, email, phone, role, is_active, created_at FROM users WHERE school_id = ? ORDER BY created_at DESC", [schoolId]),
  createUser: async (schoolId, payload) => {
    const hash = await bcrypt.hash(payload.password, SALT_ROUNDS);
    return run(
      `INSERT INTO users (school_id, matricule, full_name, email, phone, password_hash, role, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [schoolId, payload.matricule || null, payload.full_name, payload.email, payload.phone || null, hash, payload.role || "staff"]
    );
  },
  deleteUser: async (schoolId, id) => run("DELETE FROM users WHERE school_id = ? AND id = ?", [schoolId, id]),

  getReports: async (schoolId) => {
    const [classes, eleves, enseignants, users, finance] = await Promise.all([
      get("SELECT COUNT(*) AS total FROM classes WHERE school_id = ?", [schoolId]),
      get("SELECT COUNT(*) AS total FROM eleves WHERE school_id = ?", [schoolId]),
      get("SELECT COUNT(*) AS total FROM enseignants WHERE school_id = ?", [schoolId]),
      get("SELECT COUNT(*) AS total FROM users WHERE school_id = ?", [schoolId]),
      SystemService.getFinanceSummary(schoolId)
    ]);

    return {
      totalClasses: Number(classes.total || 0),
      totalEleves: Number(eleves.total || 0),
      totalEnseignants: Number(enseignants.total || 0),
      totalUsers: Number(users.total || 0),
      finance
    };
  },

  listNotifications: async (schoolId, filters = {}) => {
    const status = toTrimmed(filters.status).toLowerCase();
    const type = toTrimmed(filters.type).toLowerCase();
    const params = [schoolId];
    let where = " WHERE school_id = ? ";
    if (status === "read") {
      where += " AND is_read = 1 ";
    } else if (status === "unread") {
      where += " AND is_read = 0 ";
    }
    if (type) {
      where += " AND lower(trim(type)) = ? ";
      params.push(type);
    }

    const rows = await all(
      `
      SELECT *
      FROM notifications
      ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT 150
      `,
      params
    );
    return (rows || []).map((row) => {
      let metadata = null;
      if (row.metadata) {
        try {
          metadata = JSON.parse(row.metadata);
        } catch (_) {
          metadata = null;
        }
      }
      return { ...row, metadata };
    });
  },

  markNotificationRead: async (schoolId, notificationId) => {
    return run(
      `UPDATE notifications
       SET is_read = 1, read_at = CURRENT_TIMESTAMP
       WHERE school_id = ? AND id = ?`,
      [schoolId, Number(notificationId)]
    );
  },

  markAllNotificationsRead: async (schoolId) => {
    return run(
      `UPDATE notifications
       SET is_read = 1, read_at = CURRENT_TIMESTAMP
       WHERE school_id = ? AND is_read = 0`,
      [schoolId]
    );
  },

  getNotificationsUnreadCount: async (schoolId) => {
    const row = await get(
      "SELECT COUNT(*) AS total FROM notifications WHERE school_id = ? AND is_read = 0",
      [schoolId]
    );
    return Number((row && row.total) || 0);
  },

  ensureMonthlyRetardNotifications: async (schoolId) => {
    const month = monthKey(new Date());
    const data = await SystemService.listRetards(schoolId, { retard: "1" });
    const eleves = Array.isArray(data.eleves) ? data.eleves : [];
    const personnels = Array.isArray(data.personnels) ? data.personnels : [];

    for (const row of eleves) {
      const fullName = `${row.nom || ""} ${row.prenom || ""}`.trim();
      // eslint-disable-next-line no-await-in-loop
      await run(
        `INSERT OR IGNORE INTO notifications (
           school_id, type, title, message, entity_type, entity_ref, metadata, created_at, unique_key
         ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
        [
          schoolId,
          "retard_eleve",
          "Retard paiement eleve",
          `${fullName || row.matricule || "Eleve"} a un retard de ${Number(row.reste || 0)} FCFA.`,
          "eleve",
          row.matricule || null,
          JSON.stringify({
            mois: row.mois || data.mois || 1,
            classe: row.classe || null,
            total_du: Number(row.total_du || 0),
            total_paye: Number(row.total_paye || 0),
            reste: Number(row.reste || 0)
          }),
          `retard-eleve-${month}-${row.matricule || "na"}`
        ]
      );
    }

    for (const row of personnels) {
      const ref = toTrimmed(row.matricule) || toTrimmed(row.nom) || "staff";
      // eslint-disable-next-line no-await-in-loop
      await run(
        `INSERT OR IGNORE INTO notifications (
           school_id, type, title, message, entity_type, entity_ref, metadata, created_at, unique_key
         ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
        [
          schoolId,
          "retard_personnel",
          "Retard paiement personnel",
          `${row.nom || ref} (${row.type || "personnel"}) a un retard de ${Number(row.reste || 0)} FCFA.`,
          "staff",
          ref,
          JSON.stringify({
            mois: data.mois || 1,
            type: row.type || "personnel",
            poste: row.poste || null,
            total_du: Number(row.total_du || 0),
            total_paye: Number(row.total_paye || 0),
            reste: Number(row.reste || 0)
          }),
          `retard-staff-${month}-${ref}-${row.type || "personnel"}`
        ]
      );
    }
  },

  listRetards: async (schoolId, filters = {}) => {
    const matricule = toTrimmed(filters.matricule);
    const classe = toTrimmed(filters.classe);
    const retardOnly = String(filters.retard || "") === "1" || String(filters.retard || "") === "on";

    const school = await get("SELECT daterentrer FROM schools WHERE id = ?", [schoolId]);
    const fallbackStart = new Date();
    fallbackStart.setMonth(8, 1);
    const startDate = school && school.daterentrer ? school.daterentrer : fallbackStart.toISOString().slice(0, 10);
    const mois = Math.max(monthsElapsedFrom(startDate), 1);

    const params = [schoolId, schoolId];
    let sql = `
      SELECT e.matricule, e.nom, e.prenom, e.classe, e.telparent,
             COALESCE(c.mensuel, 0) AS mensuel,
             COALESCE(p.total_paye, 0) AS total_paye
      FROM eleves e
      LEFT JOIN classes c ON c.school_id = e.school_id AND c.nom = e.classe
      LEFT JOIN (
        SELECT eleve_matricule, SUM(montant) AS total_paye
        FROM paiements
        WHERE school_id = ?
        GROUP BY eleve_matricule
      ) p ON p.eleve_matricule = e.matricule
      WHERE e.school_id = ?
    `;
    if (matricule) {
      sql += " AND e.matricule LIKE ? ";
      params.push(`%${matricule}%`);
    }
    if (classe) {
      sql += " AND e.classe = ? ";
      params.push(classe);
    }
    sql += " ORDER BY e.nom ASC, e.prenom ASC";

    const [rows, personnels, enseignants, salairesByMatricule] = await Promise.all([
      all(sql, params),
      all(
        `SELECT matricule, full_name, role, type_payement, salaire_base, taux_horaire, statut
         FROM personnel
         WHERE school_id = ? AND COALESCE(statut, 'actif') = 'actif'`,
        [schoolId]
      ),
      all(
        `SELECT matricule, full_name, matiere, type_payement, salaire_base, taux_horaire, status
         FROM enseignants
         WHERE school_id = ? AND COALESCE(status, 'actif') = 'actif'`,
        [schoolId]
      ),
      all(
        `SELECT personnel_matricule AS matricule, COALESCE(SUM(montant), 0) AS total
         FROM salaires
         WHERE school_id = ? AND TRIM(COALESCE(personnel_matricule, '')) <> ''
         GROUP BY personnel_matricule`,
        [schoolId]
      )
    ]);

    let eleves = (rows || []).map((row) => {
      const totalDu = toPositiveNumber(row.mensuel, 0) * mois;
      const totalPaye = Number(row.total_paye || 0);
      const reste = Math.max(totalDu - totalPaye, 0);
      return {
        ...row,
        mois,
        total_du: totalDu,
        total_paye: totalPaye,
        reste
      };
    });

    if (retardOnly) {
      eleves = eleves.filter((row) => row.reste > 0);
    }

    const payeMap = new Map((salairesByMatricule || []).map((row) => [row.matricule, Number(row.total || 0)]));
    const staffRows = [
      ...(personnels || []).map((row) => ({
        type: "personnel",
        matricule: row.matricule || "-",
        nom: row.full_name || "-",
        poste: row.role || "-",
        type_payement: row.type_payement || "mensuel",
        montant_mensuel: computeMonthlyPayroll(row.type_payement, row.salaire_base, row.taux_horaire)
      })),
      ...(enseignants || []).map((row) => ({
        type: "enseignant",
        matricule: row.matricule || "-",
        nom: row.full_name || "-",
        poste: row.matiere ? `Enseignant ${row.matiere}` : "Enseignant",
        type_payement: row.type_payement || "mensuel",
        montant_mensuel: computeMonthlyPayroll(row.type_payement, row.salaire_base, row.taux_horaire)
      }))
    ].map((row) => {
      const totalDu = Number((row.montant_mensuel || 0) * mois);
      const totalPaye = Number(payeMap.get(row.matricule) || 0);
      const reste = Math.max(totalDu - totalPaye, 0);
      return { ...row, total_du: totalDu, total_paye: totalPaye, reste };
    });

    const retardsPersonnel = retardOnly
      ? staffRows.filter((row) => row.reste > 0)
      : staffRows;

    const classes = await all(
      "SELECT nom FROM classes WHERE school_id = ? ORDER BY nom ASC",
      [schoolId]
    );

    return {
      mois,
      startDate,
      eleves,
      personnels: retardsPersonnel,
      classes,
      query: {
        matricule,
        classe,
        retard: retardOnly ? "1" : ""
      }
    };
  }
};

module.exports = SystemService;

