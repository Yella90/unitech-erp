const { all } = require("../utils/dbAsync");

function defaultSchoolYear() {
  const now = new Date();
  const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-${startYear + 1}`;
}

function yearSortScore(value) {
  const match = String(value || "").match(/(\d{4})/);
  if (!match) return -1;
  return Number(match[1]);
}

async function listSchoolYears(schoolId) {
  const school = await all(
    "SELECT current_school_year FROM schools WHERE id = ?",
    [schoolId]
  );
  const rows = await all(
    `
      SELECT DISTINCT annee AS school_year
      FROM classes
      WHERE school_id = ? AND TRIM(COALESCE(annee, '')) <> ''
      UNION
      SELECT DISTINCT annee AS school_year
      FROM notes
      WHERE school_id = ? AND TRIM(COALESCE(annee, '')) <> ''
      UNION
      SELECT DISTINCT annee_scolaire AS school_year
      FROM paiements
      WHERE school_id = ? AND TRIM(COALESCE(annee_scolaire, '')) <> ''
    `,
    [schoolId, schoolId, schoolId]
  );

  const years = (rows || [])
    .map((row) => String(row.school_year || "").trim())
    .filter(Boolean);

  const currentSchoolYear = school && school[0] && school[0].current_school_year
    ? String(school[0].current_school_year).trim()
    : "";
  if (currentSchoolYear) {
    years.push(currentSchoolYear);
  }

  if (!years.length) {
    return [defaultSchoolYear()];
  }

  return [...new Set(years)].sort((a, b) => {
    const scoreDiff = yearSortScore(b) - yearSortScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return b.localeCompare(a);
  });
}

exports.injectTenantContext = async (req, res, next) => {
  try {
    const user = req.session ? req.session.user : null;

    req.currentUser = user || null;
    req.school_id = user && user.school_id ? Number(user.school_id) : null;

    let schoolYears = [];
    let activeSchoolYear = null;

    if (req.school_id) {
      schoolYears = await listSchoolYears(req.school_id);
      const sessionYear = req.session ? String(req.session.school_year || "").trim() : "";
      activeSchoolYear = schoolYears.includes(sessionYear) ? sessionYear : schoolYears[0];
      if (req.session) {
        req.session.school_year = activeSchoolYear;
      }
    }

    req.school_year = activeSchoolYear;

    res.locals.currentUser = req.currentUser;
    res.locals.currentSchoolName = user && user.school_name ? user.school_name : null;
    res.locals.currentPlan = user && user.subscription_plan ? user.subscription_plan : null;
    res.locals.schoolYears = schoolYears;
    res.locals.activeSchoolYear = activeSchoolYear;

    return next();
  } catch (err) {
    return next(err);
  }
};

exports.requireTenant = (req, res, next) => {
  if (!req.session || !req.session.user) {
    req.flash("warning", "Authentification requise");
    return res.redirect("/auth/login");
  }

  if (req.session.user.role === "superadmin") {
    req.flash("error", "Cette section est reservee aux ecoles");
    return res.redirect("/admin/dashboard");
  }

  if (!req.school_id) {
    req.flash("error", "Contexte ecole introuvable");
    return res.redirect("/auth/login");
  }

  if (Number(req.session.user.school_is_active) !== 1) {
    req.flash("error", "Ecole desactivee");
    return res.redirect("/auth/login");
  }

  return next();
};
