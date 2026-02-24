const { get } = require("../../utils/dbAsync");
const TransfersService = require("../../services/transfers.service");

function currentUserId(req) {
  return req.session && req.session.user ? Number(req.session.user.id) : null;
}

exports.requestForm = async (req, res) => {
  const matricule = String(req.params.matricule || req.query.matricule || "").trim();
  if (!matricule) {
    req.flash("warning", "Matricule eleve requis");
    return res.redirect("/eleves/liste");
  }

  try {
    const eleve = await get(
      "SELECT * FROM eleves WHERE school_id = ? AND matricule = ? LIMIT 1",
      [req.school_id, matricule]
    );
    if (!eleve) {
      req.flash("error", "Eleve introuvable");
      return res.redirect("/eleves/liste");
    }

    const schools = await TransfersService.listTargetSchools(req.school_id);
    return res.render("system/transfers-request", {
      eleve,
      schools: schools || []
    });
  } catch (err) {
    req.flash("error", err.message);
    return res.redirect("/eleves/liste");
  }
};

exports.requestCreate = async (req, res) => {
  try {
    await TransfersService.requestTransfer({
      sourceSchoolId: req.school_id,
      toSchoolId: req.body.to_ecole_id,
      matricule: req.body.matricule,
      requestedBy: currentUserId(req)
    });
    req.flash("success", "Demande de transfert envoyee");
  } catch (err) {
    req.flash("error", err.message);
  }
  return res.redirect("/eleves/liste");
};

exports.incomingPage = async (req, res) => {
  const status = String(req.query.status || "pending").trim();
  try {
    const transfers = await TransfersService.listIncomingTransfers({
      schoolId: req.school_id,
      status
    });
    return res.render("system/transfers-incoming", {
      transfers: transfers || [],
      filters: { status }
    });
  } catch (err) {
    req.flash("error", err.message);
    return res.redirect("/dashboard");
  }
};

exports.detailPage = async (req, res) => {
  try {
    const transfer = await TransfersService.getTransferDetailForSchool({
      schoolId: req.school_id,
      transferId: Number(req.params.id)
    });
    return res.render("system/transfers-detail", {
      transfer
    });
  } catch (err) {
    req.flash("error", err.message);
    return res.redirect("/transfers/incoming");
  }
};

exports.accept = async (req, res) => {
  try {
    await TransfersService.acceptTransfer({
      transferId: Number(req.params.id),
      schoolId: req.school_id,
      responseBy: currentUserId(req)
    });
    req.flash("success", "Transfert accepte");
  } catch (err) {
    req.flash("error", err.message);
  }
  return res.redirect("/transfers/incoming");
};

exports.reject = async (req, res) => {
  try {
    await TransfersService.rejectTransfer({
      transferId: Number(req.params.id),
      schoolId: req.school_id,
      responseBy: currentUserId(req)
    });
    req.flash("success", "Transfert refuse");
  } catch (err) {
    req.flash("error", err.message);
  }
  return res.redirect("/transfers/incoming");
};

exports.studentHistoryPage = async (req, res) => {
  try {
    const history = await TransfersService.getStudentHistoryForSchool({
      schoolId: req.school_id,
      studentId: Number(req.params.id)
    });
    return res.render("system/student-history", {
      history
    });
  } catch (err) {
    req.flash("error", err.message);
    return res.redirect("/eleves/liste");
  }
};
