const SuperAdminService = require("../../services/superadmin/superadmin.service");

exports.dashboard = async (req, res) => {
  try {
    const data = await SuperAdminService.getDashboard();
    return res.render("superadmin/dashboard", data);
  } catch (err) {
    req.flash("error", err.message);
    return res.redirect("/");
  }
};

exports.activateSchool = async (req, res) => {
  try {
    await SuperAdminService.toggleSchoolStatus(
      Number(req.params.id),
      true,
      req.session && req.session.user ? Number(req.session.user.id) : null
    );
    req.flash("success", "Ecole activee");
    return res.redirect("/admin/dashboard");
  } catch (err) {
    req.flash("error", err.message);
    return res.redirect("/admin/dashboard");
  }
};

exports.validateSubscription = async (req, res) => {
  try {
    await SuperAdminService.validateSubscription({
      subscriptionId: Number(req.params.id),
      actorUserId: req.session && req.session.user ? Number(req.session.user.id) : null
    });
    req.flash("success", "Abonnement valide");
  } catch (err) {
    req.flash("error", err.message);
  }
  return res.redirect("/admin/dashboard");
};

exports.changePlan = async (req, res) => {
  try {
    await SuperAdminService.updateSchoolPlan({
      schoolId: Number(req.params.id),
      planCode: String(req.body.plan_code || "").trim(),
      billingCycle: String(req.body.billing_cycle || "monthly").trim(),
      actorUserId: req.session && req.session.user ? Number(req.session.user.id) : null
    });
    req.flash("success", "Plan modifie avec succes");
  } catch (err) {
    req.flash("error", err.message);
  }
  return res.redirect("/admin/dashboard");
};

exports.suspendSubscription = async (req, res) => {
  try {
    await SuperAdminService.setSubscriptionStatus({
      subscriptionId: Number(req.params.id),
      status: "suspended",
      actorUserId: req.session && req.session.user ? Number(req.session.user.id) : null
    });
    req.flash("success", "Abonnement suspendu");
  } catch (err) {
    req.flash("error", err.message);
  }
  return res.redirect("/admin/dashboard");
};

exports.activateSubscription = async (req, res) => {
  try {
    await SuperAdminService.setSubscriptionStatus({
      subscriptionId: Number(req.params.id),
      status: "active",
      actorUserId: req.session && req.session.user ? Number(req.session.user.id) : null
    });
    req.flash("success", "Abonnement reactive");
  } catch (err) {
    req.flash("error", err.message);
  }
  return res.redirect("/admin/dashboard");
};

exports.updateSchoolInfo = async (req, res) => {
  try {
    await SuperAdminService.updateSchoolInformation({
      schoolId: Number(req.params.id),
      payload: req.body || {},
      actorUserId: req.session && req.session.user ? Number(req.session.user.id) : null
    });
    req.flash("success", "Informations de l'etablissement mises a jour");
  } catch (err) {
    req.flash("error", err.message);
  }
  return res.redirect("/admin/dashboard");
};

exports.resetSchoolAdminPassword = async (req, res) => {
  try {
    await SuperAdminService.resetSchoolAdminPassword({
      schoolId: Number(req.params.id),
      newPassword: req.body ? req.body.new_password : "",
      actorUserId: req.session && req.session.user ? Number(req.session.user.id) : null
    });
    req.flash("success", "Mot de passe admin ecole reinitialise");
  } catch (err) {
    req.flash("error", err.message);
  }
  return res.redirect("/admin/dashboard");
};

exports.createSuperAdmin = async (req, res) => {
  try {
    await SuperAdminService.createAdditionalSuperAdmin({
      fullName: req.body ? req.body.full_name : "",
      email: req.body ? req.body.email : "",
      password: req.body ? req.body.password : "",
      actorUserId: req.session && req.session.user ? Number(req.session.user.id) : null
    });
    req.flash("success", "Nouveau super admin cree");
  } catch (err) {
    req.flash("error", err.message);
  }
  return res.redirect("/admin/dashboard");
};

exports.deactivateSchool = async (req, res) => {
  try {
    await SuperAdminService.toggleSchoolStatus(
      Number(req.params.id),
      false,
      req.session && req.session.user ? Number(req.session.user.id) : null
    );
    req.flash("success", "Ecole desactivee");
    return res.redirect("/admin/dashboard");
  } catch (err) {
    req.flash("error", err.message);
    return res.redirect("/admin/dashboard");
  }
};
