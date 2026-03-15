const SystemService = require("../../services/system/system.service");
const PDFDocument = require("pdfkit");
const SubscriptionService = require("../../subscription/subscription.service");
const { run, get } = require("../../utils/dbAsync");
const RealtimeSyncService = require("../../services/sync/realtime-sync.service");

function parseId(req) {
  return Number(req.params.id);
}

function deriveMention(average) {
  if (average >= 16) return "Tres Bien";
  if (average >= 14) return "Bien";
  if (average >= 12) return "Assez Bien";
  if (average >= 10) return "Passable";
  return "Insuffisant";
}

function safeFilePart(value, fallback) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  return raw.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function getSafeRedirect(req, fallback = "/") {
  const redirectTo = String(req.body.redirect_to || req.get("referer") || "").trim();
  if (redirectTo.startsWith("/")) return redirectTo;
  return fallback;
}

exports.administrationPage = async (req, res) => {
  const [school, plans, latestSubscription] = await Promise.all([
    SystemService.getAdministration(req.school_id),
    SubscriptionService.listPlans(),
    SubscriptionService.getLatestSchoolSubscription(req.school_id)
  ]);
  res.render("system/administration", { school, plans, latestSubscription });
};

exports.setSchoolYear = async (req, res) => {
  const selected = String(req.body.school_year || "").trim();
  const available = Array.isArray(res.locals.schoolYears) ? res.locals.schoolYears : [];
  if (!selected || !available.includes(selected)) {
    req.flash("warning", "Annee scolaire invalide");
    return res.redirect(getSafeRedirect(req));
  }
  req.session.school_year = selected;
  await run("UPDATE schools SET current_school_year = ? WHERE id = ?", [selected, req.school_id]);
  req.flash("success", `Annee scolaire active: ${selected}`);
  return res.redirect(getSafeRedirect(req));
};

exports.administrationUpdate = async (req, res) => {
  try {
    await SystemService.updateAdministration(req.school_id, req.body);
    const selectedYear = String(req.body.current_school_year || "").trim();
    if (selectedYear) {
      req.session.school_year = selectedYear;
    }
    req.flash("success", "Informations academiques mises a jour");
  } catch (err) {
    req.flash("error", err.message);
  }
  res.redirect("/administration");
};

exports.requestSubscriptionChange = async (req, res) => {
  try {
    await SubscriptionService.requestSchoolPlanChange({
      schoolId: req.school_id,
      planCode: String(req.body.plan_code || "").trim(),
      billingCycle: String(req.body.billing_cycle || "monthly").trim(),
      actorUserId: req.session && req.session.user ? Number(req.session.user.id) : null
    });
    req.flash("success", "Demande d'abonnement envoyee au super admin");
  } catch (err) {
    req.flash("error", err.message);
  }
  return res.redirect("/administration");
};

exports.enseignantsPage = async (req, res) => {
  const [enseignants, matieres] = await Promise.all([
    SystemService.listEnseignants(req.school_id),
    SystemService.listMatieres(req.school_id)
  ]);
  res.render("system/enseignants", { enseignants, matieres });
};
exports.enseignantsCreate = async (req, res) => {
  try {
    await SystemService.createEnseignant(req.school_id, req.body);
    req.flash("success", "Enseignant ajoute");
  } catch (err) {
    req.flash("error", err.message);
  }
  res.redirect("/enseignants");
};
exports.enseignantsDelete = async (req, res) => {
  await SystemService.deleteEnseignant(req.school_id, parseId(req));
  res.redirect("/enseignants");
};

exports.personnelPage = async (req, res) => {
  const personnel = await SystemService.listPersonnel(req.school_id);
  res.render("system/personnel", { personnel });
};
exports.personnelCreate = async (req, res) => {
  try {
    await SystemService.createPersonnel(req.school_id, req.body);
    req.flash("success", "Personnel ajoute");
  } catch (err) {
    req.flash("error", err.message);
  }
  res.redirect("/personnel");
};
exports.personnelDelete = async (req, res) => {
  await SystemService.deletePersonnel(req.school_id, parseId(req));
  res.redirect("/personnel");
};

exports.matieresPage = async (req, res) => {
  const matieres = await SystemService.listMatieres(req.school_id);
  res.render("system/matieres", { matieres });
};
exports.matieresCreate = async (req, res) => {
  try {
    await SystemService.createMatiere(req.school_id, req.body);
    req.flash("success", "Matiere ajoutee");
  } catch (err) {
    req.flash("error", err.message);
  }
  res.redirect("/matieres");
};
exports.matieresDelete = async (req, res) => {
  await SystemService.deleteMatiere(req.school_id, parseId(req));
  res.redirect("/matieres");
};

exports.affectationsPage = async (req, res) => {
  const [affectations, classes, matieres, enseignants] = await Promise.all([
    SystemService.listAffectations(req.school_id),
    SystemService.listClasses(req.school_id),
    SystemService.listMatieres(req.school_id),
    SystemService.listEnseignants(req.school_id)
  ]);
  res.render("system/affectations", { affectations, classes, matieres, enseignants });
};
exports.affectationsCreate = async (req, res) => {
  try {
    await SystemService.createAffectation(req.school_id, req.body);
    req.flash("success", "Affectation enregistree");
  } catch (err) {
    req.flash("error", err.message);
  }
  res.redirect("/affectations");
};
exports.affectationsDelete = async (req, res) => {
  await SystemService.deleteAffectation(req.school_id, parseId(req));
  res.redirect("/affectations");
};

exports.emploisPage = async (req, res) => {
  const classe = (req.query.classe || "").trim();
  const jour = (req.query.jour || "").trim();
  const [emplois, affectations, classes] = await Promise.all([
    SystemService.listEmplois(req.school_id, { classe, jour }),
    SystemService.listAffectations(req.school_id),
    SystemService.listClasses(req.school_id)
  ]);
  const exportQuery = new URLSearchParams({ classe, jour }).toString();
  res.render("system/emplois", { emplois, affectations, classes, filters: { classe, jour }, exportQuery });
};
exports.emploisCreate = async (req, res) => {
  try {
    await SystemService.createEmploi(req.school_id, req.body);
    req.flash("success", "Creneau ajoute");
  } catch (err) {
    req.flash("error", err.message);
  }
  res.redirect("/emplois");
};
exports.emploisEditPage = async (req, res) => {
  const id = parseId(req);
  const [emploi, affectations] = await Promise.all([
    SystemService.getEmploiById(req.school_id, id),
    SystemService.listAffectations(req.school_id)
  ]);
  if (!emploi) {
    req.flash("warning", "Creneau introuvable");
    return res.redirect("/emplois");
  }
  return res.render("system/emploi-edit", { emploi, affectations });
};
exports.emploisUpdate = async (req, res) => {
  try {
    await SystemService.updateEmploi(req.school_id, parseId(req), req.body);
    req.flash("success", "Creneau modifie");
  } catch (err) {
    req.flash("error", err.message);
    return res.redirect(`/emplois/edit/${parseId(req)}`);
  }
  return res.redirect("/emplois");
};
exports.emploisDelete = async (req, res) => {
  await SystemService.deleteEmploi(req.school_id, parseId(req));
  res.redirect("/emplois");
};
exports.emploisExportPdf = async (req, res) => {
  const classe = (req.query.classe || "").trim();
  const jour = (req.query.jour || "").trim();
  const emplois = await SystemService.listEmplois(req.school_id, { classe, jour });

  const fileName = `emplois-${safeFilePart(classe || "toutes-classes", "classes")}-${safeFilePart(jour || "tous-jours", "jours")}.pdf`;
  const doc = new PDFDocument({ margin: 36, size: "A4" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
  doc.pipe(res);

  doc.fontSize(16).text("Export emplois du temps", { align: "center" });
  doc.moveDown(0.4);
  doc.fontSize(10).text(`Date: ${new Date().toLocaleDateString("fr-FR")}`, { align: "right" });
  doc.text(`Filtre classe: ${classe || "Toutes"}`);
  doc.text(`Filtre jour: ${jour || "Tous"}`);
  doc.text(`Lignes: ${emplois.length}`);
  doc.moveDown(0.6);

  const cols = { classe: 36, jour: 120, heure: 180, matiere: 275, enseignant: 395 };
  let y = doc.y;
  doc.font("Helvetica-Bold").fontSize(9);
  doc.text("Classe", cols.classe, y);
  doc.text("Jour", cols.jour, y);
  doc.text("Heure", cols.heure, y);
  doc.text("Matiere", cols.matiere, y);
  doc.text("Enseignant", cols.enseignant, y);
  doc.moveTo(36, y + 12).lineTo(560, y + 12).stroke();

  y += 18;
  doc.font("Helvetica").fontSize(9);
  (emplois || []).forEach((row) => {
    if (y > 780) {
      doc.addPage();
      y = 40;
    }
    const slot = row.heure_fin ? `${row.heure_debut} - ${row.heure_fin}` : `${row.heure_debut || "-"}`;
    doc.text(row.classe || "-", cols.classe, y, { width: 80 });
    doc.text(row.jour || "-", cols.jour, y, { width: 55 });
    doc.text(slot, cols.heure, y, { width: 90 });
    doc.text(row.matiere || "-", cols.matiere, y, { width: 110 });
    doc.text(row.enseignant_nom || row.enseignant_matricule || "-", cols.enseignant, y, { width: 160 });
    y += 16;
  });

  doc.end();
};

exports.notesPage = async (req, res) => {
  const matricule = (req.query.matricule || "").trim();
  const trimestre = (req.query.trimestre || "1").trim();
  const annee = (req.query.annee || req.school_year || "").trim();
  const classe = (req.query.classe || "").trim();

  const [notes, bulletin, classes, classRows, eleves] = await Promise.all([
    SystemService.listNotes(req.school_id, matricule),
    matricule ? SystemService.bulletinByEleve(req.school_id, matricule, trimestre, annee) : Promise.resolve(null),
    SystemService.listClasses(req.school_id),
    classe ? SystemService.bulletinByClasse(req.school_id, classe, trimestre, annee) : Promise.resolve([]),
    SystemService.listElevesForSelect(req.school_id)
  ]);

  const classBulletins = (classRows || []).map((row) => {
    const avg = Number(row.moyenne_generale || 0);
    const mention = deriveMention(avg);
    return {
      ...row,
      mention,
      decision: avg >= 10 ? "Admis" : "Redouble",
      appreciation: mention === "Tres Bien"
        ? "Excellent travail"
        : mention === "Bien"
          ? "Bon travail"
          : mention === "Assez Bien"
            ? "Resultats satisfaisants"
            : mention === "Passable"
              ? "Efforts a renforcer"
              : "Niveau insuffisant"
    };
  });

  res.render("system/notes", {
    notes,
    bulletin,
    classes,
    eleves,
    classBulletins,
    filters: { matricule, trimestre, annee, classe }
  });
};
exports.notesMatieresOptions = async (req, res) => {
  try {
    const matricule = String(req.query.matricule || "").trim();
    const data = await SystemService.listMatieresByEleveMatricule(req.school_id, matricule);
    return res.json({
      ok: true,
      eleve: data.eleve,
      matieres: data.matieres || []
    });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
};
exports.notesCreate = async (req, res) => {
  try {
    if (!req.body.annee && req.school_year) {
      req.body.annee = req.school_year;
    }
    await SystemService.createNote(req.school_id, req.body);
    req.flash("success", "Note enregistree");
  } catch (err) {
    req.flash("error", err.message);
  }
  res.redirect("/notes");
};
exports.notesDelete = async (req, res) => {
  await SystemService.deleteNote(req.school_id, parseId(req));
  res.redirect("/notes");
};

exports.bulletinsClassePage = async (req, res) => {
  const classe = (req.query.classe || "").trim();
  const trimestre = (req.query.trimestre || "1").trim();
  const annee = (req.query.annee || req.school_year || "").trim();

  const [classes, rows] = await Promise.all([
    SystemService.listClasses(req.school_id),
    classe ? SystemService.bulletinByClasse(req.school_id, classe, trimestre, annee) : Promise.resolve([])
  ]);

  const bulletins = (rows || []).map((row) => ({
    ...row,
    mention: deriveMention(Number(row.moyenne_generale || 0)),
    decision: Number(row.moyenne_generale || 0) >= 10 ? "Admis" : "Redouble"
  }));

  const averageClass = bulletins.length
    ? Number((bulletins.reduce((sum, row) => sum + Number(row.moyenne_generale || 0), 0) / bulletins.length).toFixed(2))
    : 0;

  res.render("system/bulletins-classe", {
    classes,
    bulletins,
    summary: {
      total: bulletins.length,
      averageClass,
      admis: bulletins.filter((row) => row.decision === "Admis").length
    },
    filters: { classe, trimestre, annee }
  });
};

exports.bulletinsClasseMutation = async (req, res) => {
  try {
    const result = await SystemService.mutateClassToNextYear(req.school_id, req.body || {});
    req.flash(
      "success",
      `Mutation annuelle terminee: ${result.admis} admis, ${result.redoublants} redoublants, ${result.total} eleves traites.`
    );
    if (result.createdClasses && result.createdClasses.length) {
      req.flash("warning", `Classes creees automatiquement: ${result.createdClasses.join(", ")}`);
    }
  } catch (err) {
    req.flash("error", err.message);
  }
  const classe = encodeURIComponent(String(req.body.classe || "").trim());
  const trimestre = encodeURIComponent(String(req.body.trimestre || "3").trim());
  const annee = encodeURIComponent(String(req.body.to_year || req.school_year || "").trim());
  res.redirect(`/bulletins/classe?classe=${classe}&trimestre=${trimestre}&annee=${annee}`);
};

exports.bulletinsSchoolMutation = async (req, res) => {
  try {
    const payload = {
      ...(req.body || {}),
      admin_user_id: req.session && req.session.user ? req.session.user.id : null
    };
    const result = await SystemService.mutateSchoolToNextYear(req.school_id, payload);
    if (req.session) {
      req.session.school_year = result.toYear;
    }
    req.flash(
      "success",
      `Mutation annuelle etablissement terminee: ${result.admis} admis, ${result.redoublants} redoublants, ${result.total} eleves traites.`
    );
    if (result.createdClasses && result.createdClasses.length) {
      req.flash("warning", `Classes creees automatiquement: ${result.createdClasses.join(", ")}`);
    }
  } catch (err) {
    req.flash("error", err.message);
  }
  const annee = encodeURIComponent(String(req.body.to_year || req.school_year || "").trim());
  return res.redirect(`/bulletins/classe?annee=${annee}`);
};

exports.bulletinEleveExportPdf = async (req, res) => {
  const matricule = (req.query.matricule || "").trim();
  const trimestre = (req.query.trimestre || "1").trim();
  const annee = (req.query.annee || req.school_year || "").trim();

  if (!matricule) {
    req.flash("warning", "Matricule requis pour exporter le bulletin");
    return res.redirect("/notes");
  }

  const bulletin = await SystemService.bulletinByEleve(req.school_id, matricule, trimestre, annee);
  if (!bulletin) {
    req.flash("warning", "Aucun bulletin trouve pour cet eleve");
    return res.redirect("/notes");
  }

  const fileName = `bulletin-${safeFilePart(matricule, "eleve")}-T${safeFilePart(trimestre, "1")}.pdf`;
  const doc = new PDFDocument({ margin: 36, size: "A4" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
  doc.pipe(res);

  doc.fontSize(16).text("Bulletin scolaire", { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(10).text(`Date: ${new Date().toLocaleDateString("fr-FR")}`, { align: "right" });
  doc.moveDown(0.8);

  doc.fontSize(11).text(`Nom: ${bulletin.eleve.nom} ${bulletin.eleve.prenom}`);
  doc.text(`Matricule: ${bulletin.eleve.matricule}`);
  doc.text(`Classe: ${bulletin.eleve.classe}`);
  doc.text(`Trimestre: ${trimestre}`);
  if (annee) doc.text(`Annee scolaire: ${annee}`);
  doc.moveDown(0.8);

  const startY = doc.y;
  const cols = { matiere: 36, devoirs: 190, composition: 275, coef: 365, moyenne: 430 };
  doc.font("Helvetica-Bold").fontSize(9);
  doc.text("Matiere", cols.matiere, startY);
  doc.text("Devoirs", cols.devoirs, startY);
  doc.text("Composition", cols.composition, startY);
  doc.text("Coef", cols.coef, startY);
  doc.text("Moyenne", cols.moyenne, startY);
  doc.moveTo(36, startY + 12).lineTo(560, startY + 12).stroke();

  let y = startY + 18;
  doc.font("Helvetica").fontSize(9);
  (bulletin.details || []).forEach((d) => {
    if (y > 780) {
      doc.addPage();
      y = 40;
    }
    doc.text(d.matiere || "-", cols.matiere, y, { width: 145 });
    doc.text(String(d.avgDevoirs ?? "-"), cols.devoirs, y, { width: 70 });
    doc.text(d.composition === null ? "-" : String(d.composition), cols.composition, y, { width: 70 });
    doc.text(String(d.coefficient ?? 1), cols.coef, y, { width: 45 });
    doc.text(String(d.moyenneMatiere ?? 0), cols.moyenne, y, { width: 80 });
    y += 16;
  });

  y += 10;
  doc.moveTo(36, y).lineTo(560, y).stroke();
  y += 10;
  doc.font("Helvetica-Bold").fontSize(11);
  doc.text(`Moyenne generale: ${bulletin.average}/20`, 36, y);
  doc.text(`Rang: ${bulletin.rank || "-"} / ${bulletin.classSize || "-"}`, 260, y);
  y += 18;
  doc.text(`Mention: ${bulletin.mention}`, 36, y);
  doc.text(`Decision: ${bulletin.decision}`, 260, y);
  y += 16;
  doc.font("Helvetica").fontSize(10).text(`Appreciation: ${bulletin.appreciation}`, 36, y, { width: 520 });
  doc.end();
};

exports.bulletinsClasseExportPdf = async (req, res) => {
  const classe = (req.query.classe || "").trim();
  const trimestre = (req.query.trimestre || "1").trim();
  const annee = (req.query.annee || req.school_year || "").trim();

  if (!classe) {
    req.flash("warning", "Classe requise pour exporter les bulletins");
    return res.redirect("/bulletins/classe");
  }

  const rows = await SystemService.bulletinByClasse(req.school_id, classe, trimestre, annee);
  const bulletins = (rows || []).map((row) => ({
    ...row,
    mention: deriveMention(Number(row.moyenne_generale || 0)),
    decision: Number(row.moyenne_generale || 0) >= 10 ? "Admis" : "Redouble"
  }));

  const fileName = `bulletins-${safeFilePart(classe, "classe")}-T${safeFilePart(trimestre, "1")}.pdf`;
  const doc = new PDFDocument({ margin: 36, size: "A4" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
  doc.pipe(res);

  doc.fontSize(16).text("Bulletins de classe", { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(11).text(`Classe: ${classe}`);
  doc.text(`Trimestre: ${trimestre}`);
  if (annee) doc.text(`Annee scolaire: ${annee}`);
  doc.text(`Effectif: ${bulletins.length}`);
  doc.moveDown(0.8);

  const startY = doc.y;
  const cols = { rang: 36, matricule: 90, nom: 170, moyenne: 345, mention: 420, decision: 495 };
  doc.font("Helvetica-Bold").fontSize(9);
  doc.text("Rang", cols.rang, startY);
  doc.text("Matricule", cols.matricule, startY);
  doc.text("Nom complet", cols.nom, startY);
  doc.text("Moyenne", cols.moyenne, startY);
  doc.text("Mention", cols.mention, startY);
  doc.text("Decision", cols.decision, startY);
  doc.moveTo(36, startY + 12).lineTo(560, startY + 12).stroke();

  let y = startY + 18;
  let total = 0;
  let admis = 0;
  doc.font("Helvetica").fontSize(9);
  bulletins.forEach((row) => {
    if (y > 780) {
      doc.addPage();
      y = 40;
    }
    const fullName = `${row.nom || ""} ${row.prenom || ""}`.trim();
    const avg = Number(row.moyenne_generale || 0);
    total += avg;
    if (row.decision === "Admis") admis += 1;
    doc.text(String(row.rang || "-"), cols.rang, y, { width: 35 });
    doc.text(row.matricule || "-", cols.matricule, y, { width: 75 });
    doc.text(fullName || "-", cols.nom, y, { width: 170 });
    doc.text(`${avg}/20`, cols.moyenne, y, { width: 60 });
    doc.text(row.mention, cols.mention, y, { width: 70 });
    doc.text(row.decision, cols.decision, y, { width: 65 });
    y += 16;
  });

  const moyenneClasse = bulletins.length ? Number((total / bulletins.length).toFixed(2)) : 0;
  y += 10;
  doc.moveTo(36, y).lineTo(560, y).stroke();
  y += 10;
  doc.font("Helvetica-Bold").fontSize(11);
  doc.text(`Moyenne de classe: ${moyenneClasse}/20`, 36, y);
  doc.text(`Admis: ${admis}/${bulletins.length}`, 300, y);
  doc.end();
};

exports.financesPage = async (req, res) => {
  const period = String(req.query.period || "annual").trim().toLowerCase() === "monthly" ? "monthly" : "annual";
  const month = String(req.query.month || "").trim();
  const [summary, paiements, tuitionForecast, monthData] = await Promise.all([
    SystemService.getFinanceSummary(req.school_id, { period, month, schoolYear: req.school_year }),
    SystemService.listPaiements(req.school_id, { period, month, schoolYear: req.school_year }),
    SystemService.getTuitionForecast(req.school_id, { month }),
    SystemService.getSchoolMonthOptions(req.school_id)
  ]);
  res.render("system/finances", {
    summary,
    paiements,
    tuitionForecast,
    monthOptions: monthData.monthOptions || [],
    activeMonth: (summary.scope && summary.scope.activeMonth) || monthData.activeMonth || "",
    activePeriod: (summary.scope && summary.scope.period) || period
  });
};
exports.financesCreatePaiement = async (req, res) => {
  try {
    if (!req.body.annee_scolaire && req.school_year) {
      req.body.annee_scolaire = req.school_year;
    }
    await SystemService.createPaiement(req.school_id, req.body);
    req.flash("success", "Paiement ajoute");
  } catch (err) {
    req.flash("error", err.message);
  }
  res.redirect("/finances");
};
exports.financesDeletePaiement = async (req, res) => {
  await SystemService.deletePaiement(req.school_id, parseId(req));
  res.redirect("/finances");
};

exports.salairesPage = async (req, res) => {
  const filters = {
    source_type: String(req.query.source_type || "").trim().toLowerCase(),
    matricule: String(req.query.matricule || "").trim()
  };

  const [salaires, monthData, personnels, enseignants] = await Promise.all([
    SystemService.listSalaires(req.school_id, filters),
    SystemService.getSchoolMonthOptions(req.school_id),
    SystemService.listPersonnel(req.school_id),
    SystemService.listEnseignants(req.school_id)
  ]);

  const staffOptions = [
    ...(personnels || []).map((p) => ({ type: "personnel", matricule: p.matricule, full_name: p.full_name })),
    ...(enseignants || []).map((e) => ({ type: "enseignant", matricule: e.matricule, full_name: e.full_name }))
  ];

  res.render("system/salaires", {
    salaires,
    monthOptions: monthData.monthOptions || [],
    activeMonth: monthData.activeMonth || "",
    filters,
    staffOptions
  });
};
exports.salairesCreate = async (req, res) => {
  try {
    await SystemService.createSalaire(req.school_id, req.body);
    req.flash("success", "Salaire enregistre");
  } catch (err) {
    req.flash("error", err.message);
  }
  res.redirect("/salaires");
};
exports.salairesDelete = async (req, res) => {
  await SystemService.deleteSalaire(req.school_id, parseId(req));
  res.redirect("/salaires");
};

exports.depensesPage = async (req, res) => {
  const depenses = await SystemService.listDepenses(req.school_id);
  res.render("system/depenses", { depenses });
};
exports.depensesCreate = async (req, res) => {
  try {
    await SystemService.createDepense(req.school_id, req.body);
    req.flash("success", "Depense ajoutee");
  } catch (err) {
    req.flash("error", err.message);
  }
  res.redirect("/depenses");
};
exports.depensesDelete = async (req, res) => {
  await SystemService.deleteDepense(req.school_id, parseId(req));
  res.redirect("/depenses");
};

exports.retraitsPromoteurPage = async (req, res) => {
  const retraits = await SystemService.listRetraitsPromoteur(req.school_id);
  res.render("system/retraits-promoteur", { retraits });
};
exports.retraitsPromoteurCreate = async (req, res) => {
  try {
    await SystemService.createRetraitPromoteur(req.school_id, req.body);
    req.flash("success", "Retrait enregistre");
  } catch (err) {
    req.flash("error", err.message);
  }
  res.redirect("/retraits-promoteur");
};
exports.retraitsPromoteurDelete = async (req, res) => {
  await SystemService.deleteRetraitPromoteur(req.school_id, parseId(req));
  res.redirect("/retraits-promoteur");
};

exports.tresoreriePage = async (req, res) => {
  const period = String(req.query.period || "annual").trim().toLowerCase() === "monthly" ? "monthly" : "annual";
  const month = String(req.query.month || "").trim();
  const data = await SystemService.getTresorerie(req.school_id, { period, month, schoolYear: req.school_year });
  res.render("system/tresorerie", data);
};

exports.utilisateursPage = async (req, res) => {
  if (req.currentUser && String(req.currentUser.email || "").toLowerCase() === "demo@gmail.com") {
    req.flash("warning", "Gestion des utilisateurs desactivee pour le compte demo.");
    return res.redirect("/dashboard");
  }
  const users = await SystemService.listUsers(req.school_id);
  res.render("system/utilisateurs", { users });
};
exports.utilisateursCreate = async (req, res) => {
  if (req.currentUser && String(req.currentUser.email || "").toLowerCase() === "demo@gmail.com") {
    req.flash("warning", "Gestion des utilisateurs desactivee pour le compte demo.");
    return res.redirect("/utilisateurs");
  }
  try {
    if (!req.body.password || req.body.password.length < 8) {
      throw new Error("Mot de passe minimum 8 caracteres");
    }
    const usersRow = await get("SELECT COUNT(*) AS total FROM users WHERE school_id = ?", [req.school_id]);
    await SubscriptionService.assertUnderLimit({
      schoolId: req.school_id,
      entity: "users",
      currentCount: Number((usersRow && usersRow.total) || 0)
    });
    await SystemService.createUser(req.school_id, req.body);
    req.flash("success", "Utilisateur cree");
  } catch (err) {
    req.flash("error", err.message);
  }
  res.redirect("/utilisateurs");
};
exports.utilisateursDelete = async (req, res) => {
  if (req.currentUser && String(req.currentUser.email || "").toLowerCase() === "demo@gmail.com") {
    req.flash("warning", "Gestion des utilisateurs desactivee pour le compte demo.");
    return res.redirect("/utilisateurs");
  }
  await SystemService.deleteUser(req.school_id, parseId(req));
  res.redirect("/utilisateurs");
};

exports.rapportsPage = async (req, res) => {
  const reports = await SystemService.getReports(req.school_id);
  res.render("system/rapports", { reports });
};

exports.syncStatusPage = async (req, res) => {
  const details = await RealtimeSyncService.getDetailedStatus(req.school_id);
  res.render("system/sync-status", { details });
};
exports.syncStatusData = async (req, res) => {
  try {
    const details = await RealtimeSyncService.getDetailedStatus(req.school_id);
    return res.json({ ok: true, details });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
};

exports.syncNow = async (req, res) => {
  try {
    if (!RealtimeSyncService.isEnabled()) {
      req.flash("warning", "Sync indisponible: central non configure ou mode serveur.");
      return res.redirect("/sync-status");
    }
    const online = await RealtimeSyncService.canReachCentral();
    if (!online) {
      req.flash("warning", "Central hors ligne, reessayez plus tard.");
      return res.redirect("/sync-status");
    }
    await RealtimeSyncService.syncTick();
    await run(
      `
        INSERT INTO sync_state (table_name, last_pulled_at)
        VALUES (?, ?)
        ON CONFLICT(table_name) DO UPDATE SET last_pulled_at = excluded.last_pulled_at
      `,
      ["__manual_sync_at", new Date().toISOString()]
    );
    req.flash("success", "Synchronisation lancee avec succes.");
  } catch (err) {
    req.flash("error", err.message || "Erreur pendant la synchronisation.");
  }
  return res.redirect("/sync-status");
};

exports.notificationsPage = async (req, res) => {
  await SystemService.ensureMonthlyRetardNotifications(req.school_id);
  const [data, notifications, unreadCount] = await Promise.all([
    SystemService.listRetards(req.school_id, req.query || {}),
    SystemService.listNotifications(req.school_id, req.query || {}),
    SystemService.getNotificationsUnreadCount(req.school_id)
  ]);
  const exportQuery = new URLSearchParams(data.query || {}).toString();
  res.render("system/notifications", {
    ...data,
    notifications: notifications || [],
    unreadCount: Number(unreadCount || 0),
    notificationFilters: {
      status: String(req.query.status || "").trim(),
      type: String(req.query.type || "").trim()
    },
    exportQuery
  });
};

exports.notificationsReadOne = async (req, res) => {
  try {
    await SystemService.markNotificationRead(req.school_id, parseId(req));
  } catch (err) {
    req.flash("error", err.message);
  }
  return res.redirect("/notifications");
};

exports.notificationsReadAll = async (req, res) => {
  try {
    await SystemService.markAllNotificationsRead(req.school_id);
    req.flash("success", "Toutes les notifications sont marquees comme lues");
  } catch (err) {
    req.flash("error", err.message);
  }
  return res.redirect("/notifications");
};

exports.notificationsExportPdf = async (req, res) => {
  const data = await SystemService.listRetards(req.school_id, req.query || {});
  const { eleves, personnels } = data;

  const doc = new PDFDocument({ margin: 36, size: "A4" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=rapport-retards.pdf");
  doc.pipe(res);

  doc.fontSize(16).text("Rapport des retards de paiement", { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(10).text(`Date: ${new Date().toLocaleDateString("fr-FR")}`, { align: "right" });
  doc.text(`Nombre d'eleves: ${eleves.length}`, { align: "right" });
  doc.moveDown(1);

  const startY = doc.y;
  const cols = {
    matricule: 36,
    nom: 115,
    classe: 255,
    paye: 320,
    du: 390,
    reste: 460
  };

  doc.font("Helvetica-Bold").fontSize(9);
  doc.text("Matricule", cols.matricule, startY);
  doc.text("Nom", cols.nom, startY);
  doc.text("Classe", cols.classe, startY);
  doc.text("Paye", cols.paye, startY);
  doc.text("Total du", cols.du, startY);
  doc.text("Reste", cols.reste, startY);
  doc.moveTo(36, startY + 12).lineTo(560, startY + 12).stroke();

  let y = startY + 18;
  let totalPaye = 0;
  let totalDu = 0;
  let totalReste = 0;

  doc.font("Helvetica").fontSize(9);
  eleves.forEach((row) => {
    if (y > 780) {
      doc.addPage();
      y = 40;
    }
    const nomComplet = `${row.nom || ""} ${row.prenom || ""}`.trim();
    totalPaye += Number(row.total_paye || 0);
    totalDu += Number(row.total_du || 0);
    totalReste += Number(row.reste || 0);
    doc.text(row.matricule || "-", cols.matricule, y);
    doc.text(nomComplet || "-", cols.nom, y, { width: 130 });
    doc.text(row.classe || "-", cols.classe, y, { width: 55 });
    doc.text(`${Number(row.total_paye || 0)} FCFA`, cols.paye, y, { width: 65 });
    doc.text(`${Number(row.total_du || 0)} FCFA`, cols.du, y, { width: 65 });
    doc.text(`${Number(row.reste || 0)} FCFA`, cols.reste, y, { width: 80 });
    y += 16;
  });

  y += 12;
  doc.moveTo(36, y).lineTo(560, y).stroke();
  y += 8;
  doc.font("Helvetica-Bold");
  doc.text(`Total paye: ${totalPaye} FCFA`, 36, y);
  doc.text(`Total du: ${totalDu} FCFA`, 220, y);
  doc.text(`Total reste: ${totalReste} FCFA`, 390, y);

  y += 28;
  if (y > 760) {
    doc.addPage();
    y = 40;
  }

  doc.font("Helvetica-Bold").fontSize(12).text("Retards personnel et enseignants", 36, y);
  y += 18;
  doc.font("Helvetica-Bold").fontSize(9);
  doc.text("Type", 36, y);
  doc.text("Matricule", 85, y);
  doc.text("Nom", 150, y);
  doc.text("Mensuel", 330, y);
  doc.text("Paye", 400, y);
  doc.text("Reste", 470, y);
  doc.moveTo(36, y + 12).lineTo(560, y + 12).stroke();
  y += 18;

  let totalStaffReste = 0;
  doc.font("Helvetica").fontSize(9);
  (personnels || []).forEach((row) => {
    if (y > 780) {
      doc.addPage();
      y = 40;
    }
    const nom = row.nom || "-";
    totalStaffReste += Number(row.reste || 0);
    doc.text(row.type || "-", 36, y);
    doc.text(row.matricule || "-", 85, y, { width: 60 });
    doc.text(nom, 150, y, { width: 170 });
    doc.text(`${Number(row.montant_mensuel || 0)} FCFA`, 330, y, { width: 65 });
    doc.text(`${Number(row.total_paye || 0)} FCFA`, 400, y, { width: 65 });
    doc.text(`${Number(row.reste || 0)} FCFA`, 470, y, { width: 80 });
    y += 16;
  });

  y += 8;
  doc.font("Helvetica-Bold").text(`Total reste personnel: ${totalStaffReste} FCFA`, 36, y);
  doc.end();
};
