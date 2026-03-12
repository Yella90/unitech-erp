const AuthService = require("../../services/auth/auth.service");
const SubscriptionService = require("../../subscription/subscription.service");
const { get } = require("../../utils/dbAsync");
const RealtimeSyncService = require("../../services/sync/realtime-sync.service");

exports.showRegisterSchool = async (req, res) => {
  try {
    const plans = await SubscriptionService.listPlans();
    res.render("auth/register_school", { plans });
  } catch (err) {
    req.flash("error", err.message);
    res.redirect("/auth/login");
  }
};

exports.registerSchool = async (req, res) => {
  try {
    const required = ["schoolName", "schoolEmail", "adminName", "adminEmail", "adminPassword"];
    for (const key of required) {
      if (!req.body[key]) throw new Error(`Champ requis manquant: ${key}`);
    }

    const countRow = await get("SELECT COUNT(*) AS total FROM schools", []);
    const isFirstSetup = Number((countRow && countRow.total) || 0) === 0;
    if (isFirstSetup) {
      const online = await RealtimeSyncService.canReachCentral();
      if (!online) {
        throw new Error("Connexion internet requise pour creer le premier etablissement (activation en ligne)");
      }
    }

    await AuthService.registerSchoolWithAdmin(req.body);

    req.flash("success", "Ecole creee. Abonnement en attente de validation super admin.");
    return res.redirect("/auth/login");
  } catch (err) {
    req.flash("error", err.message);
    return res.redirect("/auth/register-school");
  }
};

exports.showLogin = (req, res) => {
  res.render("auth/login");
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) throw new Error("Email et mot de passe requis");

    const user = await AuthService.login({ email, password });

    req.session.user = {
      id: user.id,
      role: user.role,
      school_id: user.school_id,
      school_name: user.school_name,
      subscription_plan: user.subscription_plan,
      school_is_active: user.school_is_active
    };

    const shouldBootstrap = RealtimeSyncService.isEnabled();
    if (shouldBootstrap) {
      RealtimeSyncService.syncTick().catch(() => {});
    }

    if (user.role === "superadmin") {
      return res.redirect("/admin/dashboard");
    }

    return res.redirect("/dashboard");
  } catch (err) {
    req.flash("error", err.message);
    return res.redirect("/auth/login");
  }
};

exports.logout = (req, res) => {
  req.session.destroy(() => {
    res.redirect("/auth/login");
  });
};
