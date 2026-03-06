const fs = require("fs");
const path = require("path");
const SetupService = require("../services/setup.service");
const {
  parseWorkbookRows,
  extractTextFromImageOcr,
  parseStudentsFromOcrText,
  parseNotesFromOcrText
} = require("../utils/setup-import.util");

function safeJsonParse(value, fallback = []) {
  const htmlDecoded = (input) =>
    String(input || "")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");

  try {
    const raw = String(value || "[]");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (err) {
    try {
      const decoded = decodeURIComponent(String(value || "[]"));
      const parsed = JSON.parse(decoded);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch (err2) {
      try {
        const decodedHtml = htmlDecoded(String(value || "[]"));
        const parsed = JSON.parse(decodedHtml);
        return Array.isArray(parsed) ? parsed : fallback;
      } catch (err3) {
        return fallback;
      }
    }
  }
}

function absoluteFromPublicPath(publicPath) {
  if (!publicPath) return "";
  const normalized = String(publicPath).replace(/^\/+/, "");
  return path.join(process.cwd(), "public", normalized);
}

exports.classesPage = async (req, res) => {
  const ctx = await SetupService.getSetupContext(req.school_id);
  return res.render("setup/classes", {
    ...ctx,
    previewRows: [],
    previewErrors: []
  });
};

exports.createClass = async (req, res) => {
  try {
    await SetupService.createQuickClass(req.school_id, req.body || {}, req.school_year || "");
    req.flash("success", "Classe ajoutee");
  } catch (err) {
    req.flash("error", err.message);
  }
  return res.redirect("/setup/classes");
};

exports.importClassesExcel = async (req, res) => {
  try {
    const file = req.files && req.files.classes_file ? req.files.classes_file : null;
    if (!file || !file.path) throw new Error("Fichier Excel classes requis");
    const rows = parseWorkbookRows(absoluteFromPublicPath(file.path));
    if (!rows.length) throw new Error("Aucune ligne detectee dans le fichier");

    let inserted = 0;
    const errors = [];
    for (const row of rows) {
      try {
        await SetupService.createQuickClass(req.school_id, {
          nom: row.Nom || row.nom,
          niveau: row.Niveau || row.niveau,
          annee: row.Annee || row.annee,
          mensuel: row.Mensuel || row.mensuel,
          frais_inscription: row.Frais_inscription || row.frais_inscription,
          effectif_max: row.Effectif_max || row.effectif_max
        }, req.school_year || "");
        inserted += 1;
      } catch (err) {
        errors.push(err.message);
      }
    }
    req.flash("success", `${inserted} classes importees`);
    if (errors.length) req.flash("warning", `${errors.length} lignes ignorees`);
  } catch (err) {
    req.flash("error", err.message);
  }
  return res.redirect("/setup/classes");
};

exports.elevesPage = async (req, res) => {
  const ctx = await SetupService.getSetupContext(req.school_id);
  return res.render("setup/eleves", {
    ...ctx,
    previewRows: [],
    previewErrors: [],
    ocrPreviewRows: [],
    ocrRawText: ""
  });
};

exports.createEleveManual = async (req, res) => {
  try {
    await SetupService.createManualStudent(req.school_id, req.body || {});
    req.flash("success", "Eleve ajoute");
  } catch (err) {
    req.flash("error", err.message);
  }
  return res.redirect("/setup/eleves");
};

exports.previewElevesExcel = async (req, res) => {
  try {
    const file = req.files && req.files.eleves_file ? req.files.eleves_file : null;
    if (!file || !file.path) throw new Error("Fichier eleves requis");
    const rawRows = parseWorkbookRows(absoluteFromPublicPath(file.path));
    const preview = await SetupService.previewStudentsRows(req.school_id, rawRows);
    const ctx = await SetupService.getSetupContext(req.school_id);
    return res.render("setup/eleves", {
      ...ctx,
      previewRows: preview.validRows,
      previewErrors: preview.errors,
      ocrPreviewRows: [],
      ocrRawText: ""
    });
  } catch (err) {
    req.flash("error", err.message);
    return res.redirect("/setup/eleves");
  }
};

exports.commitElevesPreview = async (req, res) => {
  try {
    const rows = safeJsonParse(req.body.preview_rows_json, []);
    if (!rows.length) throw new Error("Aucune ligne a importer");
    const inserted = await SetupService.commitStudentsImport(req.school_id, rows);
    req.flash("success", `${inserted} eleves importes`);
  } catch (err) {
    req.flash("error", err.message);
  }
  return res.redirect("/setup/eleves");
};

exports.previewElevesPhoto = async (req, res) => {
  try {
    const file = req.files && req.files.eleves_photo ? req.files.eleves_photo : null;
    if (!file || !file.path) throw new Error("Photo requise pour OCR");
    const ocrText = await extractTextFromImageOcr(absoluteFromPublicPath(file.path));
    const rawRows = parseStudentsFromOcrText(ocrText);
    if (!rawRows.length) {
      throw new Error("OCR: aucune ligne exploitable. Utilisez un format lisible (Nom;Prenom;Sexe;Date;Classe) et une image nette.");
    }
    const preview = await SetupService.previewStudentsRows(req.school_id, rawRows);
    const ctx = await SetupService.getSetupContext(req.school_id);
    return res.render("setup/eleves", {
      ...ctx,
      previewRows: preview.validRows,
      previewErrors: preview.errors,
      ocrPreviewRows: rawRows,
      ocrRawText: ocrText || ""
    });
  } catch (err) {
    req.flash("error", err.message);
    return res.redirect("/setup/eleves");
  }
};

exports.notesPage = async (req, res) => {
  const ctx = await SetupService.getSetupContext(req.school_id);
  return res.render("setup/notes", {
    ...ctx,
    selectedClasse: "",
    elevesClasse: [],
    previewNoteRows: [],
    previewNoteErrors: [],
    ocrRawText: "",
    noteImportMeta: {
      classe: "",
      matiere: "",
      trimestre: "1",
      note_type: "devoir",
      annee: req.school_year || ""
    }
  });
};

exports.notesClasseOptions = async (req, res) => {
  try {
    const classe = String(req.query.classe || "").trim();
    if (!classe) return res.json({ ok: true, rows: [] });
    const rows = await SetupService.listStudentsByClass(req.school_id, classe);
    return res.json({ ok: true, rows });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
};

exports.saveNotesDynamic = async (req, res) => {
  try {
    const rows = safeJsonParse(req.body.rows_json, []);
    const result = await SetupService.saveNotesBulk(req.school_id, {
      ...req.body,
      rows
    });
    req.flash("success", `${result.inserted} notes enregistrees`);
    if (result.errors.length) {
      req.flash("warning", `${result.errors.length} lignes en erreur`);
    }
  } catch (err) {
    req.flash("error", err.message);
  }
  return res.redirect("/setup/notes");
};

exports.previewNotesExcel = async (req, res) => {
  try {
    const file = req.files && req.files.notes_file ? req.files.notes_file : null;
    if (!file || !file.path) throw new Error("Fichier notes requis");
    const rows = parseWorkbookRows(absoluteFromPublicPath(file.path)).map(SetupService.mapNoteRow);
    const validRows = rows.filter((r) => r.matricule && Number.isFinite(r.note));
    const errors = rows.length - validRows.length;
    const result = await SetupService.saveNotesBulk(req.school_id, {
      ...req.body,
      rows: validRows
    });
    req.flash("success", `${result.inserted} notes importees`);
    if (result.errors.length || errors) {
      req.flash("warning", `${result.errors.length + errors} lignes en erreur`);
    }
  } catch (err) {
    req.flash("error", err.message);
  }
  return res.redirect("/setup/notes");
};

exports.previewNotesPhoto = async (req, res) => {
  try {
    const file = req.files && req.files.notes_photo ? req.files.notes_photo : null;
    if (!file || !file.path) throw new Error("Photo notes requise");
    const text = await extractTextFromImageOcr(absoluteFromPublicPath(file.path));
    const rawRows = parseNotesFromOcrText(text);
    const parsedRows = rawRows.map(SetupService.mapNoteRow);
    if (!parsedRows.length) {
      throw new Error("OCR: aucune ligne note detectee. Format conseille: Matricule;Note (une ligne par eleve).");
    }
    const validRows = parsedRows.filter((r) => r.matricule && Number.isFinite(r.note) && r.note >= 0 && r.note <= 20);
    const dropped = parsedRows.length - validRows.length;

    const ctx = await SetupService.getSetupContext(req.school_id);
    return res.render("setup/notes", {
      ...ctx,
      selectedClasse: String(req.body.classe || "").trim(),
      elevesClasse: [],
      previewNoteRows: validRows,
      previewNoteErrors: dropped ? [`${dropped} ligne(s) OCR ignoree(s) car invalides`] : [],
      ocrRawText: text || "",
      noteImportMeta: {
        classe: String(req.body.classe || "").trim(),
        matiere: String(req.body.matiere || "").trim(),
        trimestre: String(req.body.trimestre || "1").trim(),
        note_type: String(req.body.note_type || "devoir").trim(),
        annee: String(req.body.annee || req.school_year || "").trim()
      }
    });
  } catch (err) {
    req.flash("error", err.message);
  }
  return res.redirect("/setup/notes");
};

exports.commitNotesPreview = async (req, res) => {
  try {
    const rows = safeJsonParse(req.body.preview_rows_json, []);
    if (!rows.length) throw new Error("Aucune ligne OCR a importer");

    const payload = {
      classe: String(req.body.classe || "").trim(),
      matiere: String(req.body.matiere || "").trim(),
      trimestre: String(req.body.trimestre || "1").trim(),
      note_type: String(req.body.note_type || "devoir").trim(),
      annee: String(req.body.annee || req.school_year || "").trim(),
      rows
    };

    const result = await SetupService.saveNotesBulk(req.school_id, payload);
    req.flash("success", `${result.inserted} notes OCR enregistrees`);
    if (result.errors.length) {
      req.flash("warning", `${result.errors.length} lignes OCR en erreur`);
    }
  } catch (err) {
    req.flash("error", err.message);
  }
  return res.redirect("/setup/notes");
};
