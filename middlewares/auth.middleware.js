const { get } = require("../utils/dbAsync");

exports.requireAuth = async (req, res, next) => {
  try {
    if (!req.session || !req.session.user || !req.session.user.id) {
      req.flash("warning", "Veuillez vous connecter");
      return res.redirect("/auth/login");
    }

    const sessionUserId = Number(req.session.user.id);
    const freshUser = await get(
      `
      SELECT u.id, u.role, u.is_active, u.school_id, s.name AS school_name, s.subscription_plan, s.is_active AS school_is_active
      FROM users u
      LEFT JOIN schools s ON s.id = u.school_id
      WHERE u.id = ?
      `,
      [sessionUserId]
    );

    if (!freshUser || Number(freshUser.is_active) !== 1) {
      if (req.session) {
        req.session.destroy(() => {});
      }
      req.flash("warning", "Session invalide ou expiree");
      return res.redirect("/auth/login");
    }

    req.session.user = {
      id: freshUser.id,
      role: freshUser.role,
      school_id: freshUser.school_id,
      school_name: freshUser.school_name,
      subscription_plan: freshUser.subscription_plan,
      school_is_active: freshUser.school_is_active
    };

    return next();
  } catch (err) {
    return next(err);
  }
};

exports.requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      req.flash("warning", "Authentification requise");
      return res.redirect("/auth/login");
    }

    if (!roles.includes(req.session.user.role)) {
      req.flash("error", "Acces refuse");
      return res.redirect("/");
    }

    return next();
  };
};

exports.requireSuperAdmin = (req, res, next) => {
  if (!req.session || !req.session.user) {
    req.flash("warning", "Authentification requise");
    return res.redirect("/auth/login");
  }

  if (req.session.user.role !== "superadmin") {
    req.flash("error", "Acces superadmin requis");
    return res.redirect("/");
  }

  return next();
};

exports.checkRole = (...roles) => {
  const normalized = (roles || []).map((role) => {
    const value = String(role || "").trim().toLowerCase();
    if (value === "admin_ecole") return "school_admin";
    return value;
  }).filter(Boolean);
  return exports.requireRole(...normalized);
};

exports.authMiddleware = exports.requireAuth;
exports.roleMiddleware = (role) => exports.requireRole(role);
