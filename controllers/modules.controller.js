const MODULES = [
  { slug: "administration-academique", title: "Administration academique" },
  { slug: "gestion-eleves", title: "Gestion des eleves" },
  { slug: "gestion-enseignants", title: "Gestion des enseignants" },
  { slug: "gestion-classes", title: "Gestion des classes" },
  { slug: "gestion-matieres", title: "Gestion des matieres" },
  { slug: "gestion-notes-bulletins", title: "Gestion des notes & bulletins" },
  { slug: "gestion-financiere", title: "Gestion financiere" },
  { slug: "gestion-salaires", title: "Gestion des salaires" },
  { slug: "gestion-depenses", title: "Gestion des depenses" },
  { slug: "gestion-tresorerie", title: "Gestion de la tresorerie" },
  { slug: "gestion-utilisateurs-roles", title: "Gestion des utilisateurs & roles" },
  { slug: "rapports-statistiques", title: "Rapports & statistiques" }
];

exports.list = (req, res) => {
  res.render("modules/index", { modules: MODULES });
};

exports.detail = (req, res) => {
  const moduleItem = MODULES.find((item) => item.slug === req.params.slug);

  if (!moduleItem) {
    req.flash("warning", "Module introuvable");
    return res.redirect("/modules");
  }

  return res.render("modules/detail", { moduleItem });
};
