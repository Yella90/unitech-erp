const { all, get } = require("../utils/dbAsync");
const ClassesService = require("./classes.service");
const EleveService = require("./eleves.service");
const SystemService = require("./system/system.service");

function fromCallback(executor) {
  return new Promise((resolve, reject) => {
    executor((err, data) => {
      if (err) return reject(err);
      return resolve(data);
    });
  });
}

function toTrimmed(value) {
  return String(value || "").trim();
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function isValidDateParts(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function formatYmd(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function excelSerialToYmd(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n <= 0) return "";
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const dt = new Date(ms);
  const year = dt.getUTCFullYear();
  const month = dt.getUTCMonth() + 1;
  const day = dt.getUTCDate();
  if (!isValidDateParts(year, month, day)) return "";
  return formatYmd(year, month, day);
}

function normalizeBirthDate(value) {
  if (value === null || value === undefined || value === "") return "";

  if (typeof value === "number") return excelSerialToYmd(value);

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = value.getMonth() + 1;
    const day = value.getDate();
    return isValidDateParts(year, month, day) ? formatYmd(year, month, day) : "";
  }

  const raw = toTrimmed(value);
  if (!raw) return "";

  let m = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    return isValidDateParts(year, month, day) ? formatYmd(year, month, day) : "";
  }

  m = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    return isValidDateParts(year, month, day) ? formatYmd(year, month, day) : "";
  }

  return "";
}

function normalizeSex(value) {
  const raw = toTrimmed(value).toLowerCase();
  if (!raw) return "";
  if (["m", "masculin", "male", "homme", "garcon"].includes(raw)) return "M";
  if (["f", "feminin", "female", "femme", "fille"].includes(raw)) return "F";
  return "";
}

function inferCycleFromNiveau(niveau) {
  const lvl = toTrimmed(niveau).toLowerCase();
  if (["jardin", "1ere", "2eme", "3eme", "4eme", "5eme", "6eme"].includes(lvl)) return "primaire";
  if (["7eme", "8eme", "9eme"].includes(lvl)) return "secondaire";
  if (["10eme", "11eme", "terminale"].includes(lvl)) return "lycee";
  return "";
}

const LEVELS_BY_CYCLE = {
  primaire: ["jardin", "1ere", "2eme", "3eme", "4eme", "5eme", "6eme"],
  secondaire: ["7eme", "8eme", "9eme"],
  lycee: ["10eme", "11eme", "terminale"]
};

function normalizeCycle(value) {
  const raw = toTrimmed(value).toLowerCase();
  if (!raw) return "";
  if (raw === "lycee" || raw === "lycée") return "lycee";
  if (raw === "primaire" || raw === "secondaire") return raw;
  return "";
}

function inferNiveauFromClassName(name) {
  const normalized = toTrimmed(name).toLowerCase();
  if (!normalized) return "";
  const levels = Object.values(LEVELS_BY_CYCLE).flat();
  return levels.find((level) => normalized === level || normalized.startsWith(`${level} `)) || "";
}

function defaultSchoolYear() {
  const year = new Date().getFullYear();
  return `${year}-${year + 1}`;
}

function mapStudentRow(row) {
  const getVal = (...keys) => {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
      const found = Object.keys(row || {}).find((k) => String(k || "").toLowerCase() === String(key || "").toLowerCase());
      if (found) return row[found];
    }
    return "";
  };

  return {
    matricule: toTrimmed(getVal("Matricule", "matricule")),
    nom: toTrimmed(getVal("Nom", "nom")),
    prenom: toTrimmed(getVal("Prenom", "Prénom", "prenom", "prénom")),
    sexe: normalizeSex(getVal("Sexe", "sexe")),
    dateNaissance: getVal("Date_naissance", "date_naissance", "dateNaissance", "DateNaissance"),
    classe: toTrimmed(getVal("Classe", "classe")),
    nomparent: toTrimmed(getVal("Nom_parent", "nom_parent", "nomparent", "NomParent")),
    telparent: toTrimmed(getVal("Telephone_parent", "telparent", "telephone_parent", "TelParent"))
  };
}

function mapNoteRow(row) {
  const getVal = (...keys) => {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
      const found = Object.keys(row || {}).find((k) => String(k || "").toLowerCase() === String(key || "").toLowerCase());
      if (found) return row[found];
    }
    return "";
  };

  return {
    matricule: toTrimmed(getVal("Matricule", "matricule")),
    note: Number(getVal("Note", "note"))
  };
}

const SetupService = {
  getSetupContext: async (schoolId) => {
    const [classes, matieres] = await Promise.all([
      all("SELECT nom, niveau, annee FROM classes WHERE school_id = ? ORDER BY nom ASC", [schoolId]),
      all("SELECT nom FROM matieres WHERE school_id = ? ORDER BY nom ASC", [schoolId])
    ]);
    return { classes, matieres };
  },

  createQuickClass: async (schoolId, payload, schoolYear) => {
    const nom = toTrimmed(payload.nom);
    const payloadCycle = normalizeCycle(payload.cycle);
    const payloadNiveau = toTrimmed(payload.niveau).toLowerCase();
    let cycle = payloadCycle;
    let niveau = payloadNiveau;

    if (!cycle && normalizeCycle(payloadNiveau)) {
      cycle = normalizeCycle(payloadNiveau);
      niveau = "";
    }
    if (!niveau) niveau = inferNiveauFromClassName(nom);
    if (!cycle) cycle = inferCycleFromNiveau(niveau);

    if (!nom || !niveau || !cycle) {
      throw new Error("Nom, niveau et cycle valides sont obligatoires");
    }

    const data = {
      nom,
      niveau,
      cycle,
      annee: toTrimmed(payload.annee) || schoolYear || defaultSchoolYear(),
      mensuel: Number(payload.mensuel || 0),
      frais_inscriptioin: Number(payload.frais_inscription || 0),
      effectif_max: Number(payload.effectif_max || 50)
    };

    await fromCallback((cb) => ClassesService.createClass(schoolId, data, cb));
  },

  previewStudentsRows: async (schoolId, rows) => {
    const mapped = (rows || []).map(mapStudentRow);
    const classes = await all("SELECT nom FROM classes WHERE school_id = ?", [schoolId]);
    const classSet = new Set((classes || []).map((c) => String(c.nom || "").trim().toLowerCase()));

    const existingMatriculesRows = await all("SELECT matricule FROM eleves WHERE school_id = ?", [schoolId]);
    const existingMatricules = new Set((existingMatriculesRows || []).map((r) => String(r.matricule || "").trim().toLowerCase()));
    const existingNamesRows = await all("SELECT lower(trim(nom)) AS nom, lower(trim(prenom)) AS prenom FROM eleves WHERE school_id = ?", [schoolId]);
    const existingNames = new Set((existingNamesRows || []).map((r) => `${r.nom}__${r.prenom}`));

    const seenMatricules = new Set();
    const seenNames = new Set();
    const validRows = [];
    const errors = [];

    mapped.forEach((row, idx) => {
      const rowNumber = idx + 2;
      if (!row.nom || !row.prenom || !row.classe) {
        errors.push(`Ligne ${rowNumber}: nom, prenom et classe sont obligatoires`);
        return;
      }
      const normalizedDate = normalizeBirthDate(row.dateNaissance);
      if (row.dateNaissance && !normalizedDate) {
        errors.push(`Ligne ${rowNumber}: format date_naissance invalide (ex: 2012-09-30 ou 30/09/2012)`);
        return;
      }
      row.dateNaissance = normalizedDate;
      if (!classSet.has(row.classe.toLowerCase())) {
        errors.push(`Ligne ${rowNumber}: classe "${row.classe}" introuvable`);
        return;
      }
      if (row.matricule) {
        const m = row.matricule.toLowerCase();
        if (existingMatricules.has(m) || seenMatricules.has(m)) {
          errors.push(`Ligne ${rowNumber}: matricule en doublon (${row.matricule})`);
          return;
        }
        seenMatricules.add(m);
      }

      const keyName = `${row.nom.toLowerCase()}__${row.prenom.toLowerCase()}`;
      if (existingNames.has(keyName) || seenNames.has(keyName)) {
        errors.push(`Ligne ${rowNumber}: nom+prenom deja existant (${row.nom} ${row.prenom})`);
        return;
      }
      seenNames.add(keyName);
      validRows.push(row);
    });

    return { validRows, errors };
  },

  commitStudentsImport: async (schoolId, rows) => {
    let inserted = 0;
    for (const row of rows || []) {
      const payload = {
        matricule: row.matricule || "",
        nom: row.nom,
        prenom: row.prenom,
        sexe: row.sexe || "",
        classe: row.classe,
        dateNaissance: row.dateNaissance || "",
        nomparent: row.nomparent || "",
        telparent: row.telparent || ""
      };
      await fromCallback((cb) => EleveService.createEleve(schoolId, payload, cb));
      inserted += 1;
    }
    return inserted;
  },

  createManualStudent: async (schoolId, payload) => {
    await fromCallback((cb) => EleveService.createEleve(schoolId, payload, cb));
  },

  listStudentsByClass: async (schoolId, classe) => {
    return all(
      "SELECT matricule, nom, prenom, classe FROM eleves WHERE school_id = ? AND classe = ? ORDER BY nom ASC, prenom ASC",
      [schoolId, classe]
    );
  },

  saveNotesBulk: async (schoolId, payload) => {
    const classe = toTrimmed(payload.classe);
    const matiere = toTrimmed(payload.matiere);
    const trimestre = toTrimmed(payload.trimestre);
    const annee = toTrimmed(payload.annee);
    const noteType = toTrimmed(payload.note_type) || "devoir";
    const rows = Array.isArray(payload.rows) ? payload.rows : [];

    if (!classe || !matiere || !trimestre || !annee) {
      throw new Error("Classe, matiere, trimestre et annee sont obligatoires");
    }

    let inserted = 0;
    const errors = [];
    for (const row of rows) {
      const matricule = toTrimmed(row.matricule);
      const note = Number(row.note);
      if (!matricule || !Number.isFinite(note)) {
        errors.push(`Ligne invalide pour matricule ${matricule || "-"}`);
        continue;
      }

      try {
        await SystemService.createNote(schoolId, {
          eleve_matricule: matricule,
          matiere,
          trimestre,
          annee,
          note,
          note_type: noteType,
          description: "import_setup"
        });
        inserted += 1;
      } catch (err) {
        errors.push(`${matricule}: ${err.message}`);
      }
    }

    return { inserted, errors };
  },

  mapStudentRow,
  mapNoteRow
};

module.exports = SetupService;
