const EleveService = require("../services/eleves.service");
const db = require("../config/db");
const PDFDocument = require("pdfkit");

function safeFilePart(value, fallback) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  return raw.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function resolveUploadedPath(req, field, fallback = "") {
  if (req.files && req.files[field] && req.files[field].path) {
    return req.files[field].path;
  }
  const existingField = `existing_${field}`;
  return String((req.body && req.body[existingField]) || fallback || "").trim();
}

exports.liste = (req, res) => {
  const matriculeFilter = (req.query.matricule || "").trim();
  const classeFilter = (req.query.classe || "").trim();
  const matiereFilter = (req.query.matiere || "").trim();
  const filters = { matricule: matriculeFilter, classe: classeFilter, matiere: matiereFilter };
  const exportQuery = new URLSearchParams({
    classe: classeFilter,
    matiere: matiereFilter
  }).toString();

  EleveService.listElevesByFilters(req.school_id, filters, (err, eleves) => {
    if (err) {
      req.flash("error", "Erreur base de donnees");
      return res.redirect("/");
    }

    return db.all("SELECT nom FROM classes WHERE school_id = ? ORDER BY nom ASC", [req.school_id], (classesErr, classes) => {
      if (classesErr) {
        req.flash("error", "Erreur base de donnees");
        return res.redirect("/");
      }

      return db.all("SELECT nom FROM matieres WHERE school_id = ? ORDER BY nom ASC", [req.school_id], (matieresErr, matieres) => {
        if (matieresErr) {
          req.flash("error", "Erreur base de donnees");
          return res.redirect("/");
        }

        return res.render("eleves", {
          eleves,
          classes: classes || [],
          matieres: matieres || [],
          filters,
          exportQuery
        });
      });
    });
  });
};

exports.exportClasseMatierePdf = (req, res) => {
  const classe = (req.query.classe || "").trim();
  const matiere = (req.query.matiere || "").trim();
  const annee = (req.query.annee || req.school_year || "").trim();

  if (!classe || !matiere) {
    req.flash("warning", "Classe et matiere sont obligatoires pour exporter le PDF");
    return res.redirect("/eleves/liste");
  }

  return EleveService.listElevesByClasse(
    req.school_id,
    classe,
    (err, rows) => {
      if (err) {
        req.flash("error", "Erreur lors de la generation du PDF");
        return res.redirect("/eleves/liste");
      }

      const fileName = `eleves-${safeFilePart(classe, "classe")}-${safeFilePart(matiere, "matiere")}.pdf`;
      const doc = new PDFDocument({ margin: 36, size: "A4" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
      doc.pipe(res);

      doc.fontSize(16).text("Fiche de saisie des notes", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Date: ${new Date().toLocaleDateString("fr-FR")}`, { align: "right" });
      doc.text(`Classe: ${classe}`);
      doc.text(`Matiere: ${matiere}`);
      if (annee) doc.text(`Annee scolaire: ${annee}`);
      doc.text(`Effectif: ${(rows || []).length}`);
      doc.moveDown(0.8);

      const cols = { matricule: 36, nomComplet: 170, note: 470 };
      let y = doc.y;
      doc.font("Helvetica-Bold").fontSize(9);
      doc.text("Matricule", cols.matricule, y);
      doc.text("Nom complet", cols.nomComplet, y);
      doc.text("Note", cols.note, y);
      doc.moveTo(36, y + 12).lineTo(560, y + 12).stroke();

      y += 20;
      doc.font("Helvetica").fontSize(9);
      (rows || []).forEach((row) => {
        if (y > 760) {
          doc.addPage();
          y = 40;
          doc.font("Helvetica-Bold").fontSize(9);
          doc.text("Matricule", cols.matricule, y);
          doc.text("Nom complet", cols.nomComplet, y);
          doc.text("Note", cols.note, y);
          doc.moveTo(36, y + 12).lineTo(560, y + 12).stroke();
          y += 20;
          doc.font("Helvetica").fontSize(9);
        }
        const nomComplet = `${row.nom || ""} ${row.prenom || ""}`.trim() || "-";
        doc.text(row.matricule || "-", cols.matricule, y, { width: 120 });
        doc.text(nomComplet, cols.nomComplet, y, { width: 280 });
        doc.rect(cols.note, y - 2, 70, 14).stroke();
        y += 20;
      });

      doc.end();
      return null;
    }
  );
};

exports.add = (req, res) => {
  db.all("SELECT * FROM classes WHERE school_id = ? ORDER BY nom", [req.school_id], (err, classes) => {
    if (err) {
      req.flash("error", "Erreur base de donnees");
      return res.redirect("/");
    }

    return res.render("inscription", {
      classes,
      old: {},
      isEdit: false,
      overflowPrompt: null
    });
  });
};

exports.create = (req, res) => {
  const payload = {
    ...req.body,
    photo_profil: resolveUploadedPath(req, "photo_profil"),
    photo_acte_naissance: resolveUploadedPath(req, "photo_acte_naissance")
  };

  EleveService.createEleve(req.school_id, payload, (err, result) => {
    if (err) {
      if (err.code === "CLASS_FULL_CONFIRM_REQUIRED") {
        return db.all("SELECT * FROM classes WHERE school_id = ? ORDER BY nom", [req.school_id], (classesErr, classes) => {
          if (classesErr) {
            req.flash("error", "Erreur base de donnees");
            return res.redirect("/eleves/add");
          }

          return res.render("inscription", {
            classes,
            old: payload || {},
            isEdit: false,
            overflowPrompt: {
              message: err.message,
              suggestedClassName: err.suggestedClassName || null
            }
          });
        });
      }

      req.flash("error", err.message);
      return res.redirect("/eleves/add");
    }

    if (result && result.createdClassName) {
      req.flash("success", `Eleve cree. Classe ${result.createdClassName} creee automatiquement.`);
    } else {
      req.flash("success", "Eleve cree");
    }
    return res.redirect("/eleves/liste");
  });
};

exports.delete = (req, res) => {
  const matricule = req.params.matricule;

  EleveService.deleteEleve(req.school_id, matricule, (err) => {
    if (err) {
      req.flash("error", err.message);
      return res.redirect("/eleves/liste");
    }

    return res.redirect("/eleves/liste");
  });
};

exports.edit = (req, res) => {
  const matricule = req.params.matricule;

  EleveService.getEleveByMatricule(req.school_id, matricule, (err, eleve) => {
    if (err) {
      req.flash("error", "Erreur base de donnees");
      return res.redirect("/eleves/liste");
    }

    if (!eleve) {
      req.flash("warning", "Eleve introuvable");
      return res.redirect("/eleves/liste");
    }

    db.all("SELECT * FROM classes WHERE school_id = ? ORDER BY nom", [req.school_id], (classesErr, classes) => {
      if (classesErr) {
        req.flash("error", "Erreur base de donnees");
        return res.redirect("/eleves/liste");
      }

      return res.render("inscription", {
        classes,
        old: eleve,
        isEdit: true,
        overflowPrompt: null
      });
    });
  });
};

exports.profile = (req, res) => {
  const matricule = req.params.matricule;
  EleveService.getEleveProfileByMatricule(req.school_id, matricule, (err, profileData) => {
    if (err) {
      req.flash("error", "Erreur base de donnees");
      return res.redirect("/eleves/liste");
    }

    if (!profileData || !profileData.eleve) {
      req.flash("warning", "Eleve introuvable");
      return res.redirect("/eleves/liste");
    }

    return res.render("eleve-profile", {
      eleve: profileData.eleve,
      notes: profileData.notes || [],
      notesSummary: profileData.notesSummary || []
    });
  });
};

exports.update = (req, res) => {
  const matricule = req.params.matricule;
  const payload = {
    ...req.body,
    photo_profil: resolveUploadedPath(req, "photo_profil"),
    photo_acte_naissance: resolveUploadedPath(req, "photo_acte_naissance")
  };

  EleveService.updateEleve(req.school_id, matricule, payload, (err) => {
    if (err) {
      req.flash("error", err.message);
      return res.redirect(`/eleves/edit/${matricule}`);
    }

    req.flash("success", "Eleve modifie");
    return res.redirect("/eleves/liste");
  });
};
