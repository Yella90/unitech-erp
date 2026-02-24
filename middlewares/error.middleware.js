exports.notFound = (req, res) => {
  res.status(404).render("auth/login", { error: "Page introuvable" });
};

exports.errorHandler = (err, req, res, next) => {
  console.error(err);
  req.flash("error", "Erreur interne serveur");
  res.status(500).redirect("/");
};
