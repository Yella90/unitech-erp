const SubscriptionService = require("../subscription/subscription.service");

exports.abonnementMiddleware = async (req, res, next) => {
  try {
    if (!req.session || !req.session.user || req.session.user.role === "superadmin") {
      return next();
    }
    if (!req.school_id) {
      req.flash("error", "Contexte ecole introuvable");
      return res.redirect("/auth/login");
    }

    const status = await SubscriptionService.getSchoolAccessStatus(req.school_id);
    res.locals.subscriptionStatus = status;

    if (!status.allowed) {
      req.flash("error", status.message || "Abonnement inactif");
      return res.redirect("/auth/login");
    }

    return next();
  } catch (err) {
    return next(err);
  }
};

exports.requireFeature = (feature) => {
  return async (req, res, next) => {
    try {
      if (!req.school_id) {
        req.flash("error", "Contexte ecole introuvable");
        return res.redirect("/auth/login");
      }
      await SubscriptionService.assertFeatureEnabled({ schoolId: req.school_id, feature });
      return next();
    } catch (err) {
      req.flash("error", err.message);
      return res.redirect("/classes");
    }
  };
};
