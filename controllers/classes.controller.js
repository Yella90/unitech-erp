const ClassesService = require("../services/classes.service");

exports.index = (req, res) => {
  ClassesService.listClasses(req.school_id, (err, classes) => {
    if (err) {
      req.flash("error", "Erreur base de donnees");
      return res.redirect("/");
    }
    return res.render("classes", { classes });
  });
};

exports.add = (req, res) => {
  return res.render("classe_add");
};

exports.create = (req, res) => {
  const payload = {
    ...req.body,
    annee: (req.school_year || "").trim() || String(req.body.annee || "").trim()
  };

  ClassesService.createClass(req.school_id, payload, (err) => {
    if (err) {
      req.flash("error", err.message);
      return res.redirect("/classes/add");
    }

    req.flash("success", "Classe creee avec succes");
    return res.redirect("/classes");
  });
};

exports.delete = (req, res) => {
  const id = Number(req.params.id);

  ClassesService.deleteClass(req.school_id, id, (err, changes) => {
    if (err) {
      req.flash("error", err.message);
      return res.redirect("/classes");
    }

    if (!changes) {
      req.flash("warning", "Classe introuvable ou acces refuse");
      return res.redirect("/classes");
    }

    return res.redirect("/classes");
  });
};
