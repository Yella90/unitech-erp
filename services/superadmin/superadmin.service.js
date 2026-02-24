const bcrypt = require("bcrypt");
const SuperAdminModel = require("../../models/superadmin/dashboard.model");

const SALT_ROUNDS = 10;

const SuperAdminService = {
  getDashboard: async () => {
    const [stats, schools, pendingSubscriptions, logs, plans, superAdmins] = await Promise.all([
      SuperAdminModel.stats(),
      SuperAdminModel.listSchools(),
      SuperAdminModel.listPendingSubscriptions(),
      SuperAdminModel.listActivityLogs(25),
      SuperAdminModel.listPlans(),
      SuperAdminModel.listSuperAdmins()
    ]);

    return { stats, schools, pendingSubscriptions, logs, plans, superAdmins };
  },

  toggleSchoolStatus: async (schoolId, isActive, actorUserId = null) => {
    await SuperAdminModel.setSchoolStatus(schoolId, isActive);
    return SuperAdminModel.logActivity({
      actorUserId,
      schoolId,
      action: isActive ? "school_activated" : "school_suspended",
      details: isActive ? "Ecole activee" : "Ecole suspendue"
    });
  },

  validateSubscription: async ({ subscriptionId, actorUserId }) => {
    const target = await SuperAdminModel.getSubscriptionById(subscriptionId);
    if (!target) {
      throw new Error("Abonnement introuvable");
    }
    await SuperAdminModel.updateSubscriptionStatus(subscriptionId, "active", actorUserId, "Valide par super admin");
    await SuperAdminModel.changeSchoolPlan(target.school_id, target.plan_code);
    return SuperAdminModel.logActivity({
      actorUserId,
      schoolId: target.school_id,
      action: "subscription_validated",
      details: `Abonnement ${subscriptionId} valide (${target.plan_code})`
    });
  },

  setSubscriptionStatus: async ({ subscriptionId, status, actorUserId }) => {
    const target = await SuperAdminModel.getSubscriptionById(subscriptionId);
    if (!target) {
      throw new Error("Abonnement introuvable");
    }

    const safeStatus = String(status || "").trim().toLowerCase();
    if (!["active", "suspended"].includes(safeStatus)) {
      throw new Error("Statut abonnement invalide");
    }

    await SuperAdminModel.updateSubscriptionStatus(
      subscriptionId,
      safeStatus,
      actorUserId,
      safeStatus === "active" ? "Abonnement reactive" : "Abonnement suspendu"
    );

    return SuperAdminModel.logActivity({
      actorUserId,
      schoolId: target.school_id,
      action: safeStatus === "active" ? "subscription_reactivated" : "subscription_suspended",
      details: `Abonnement ${subscriptionId} -> ${safeStatus}`
    });
  },

  updateSchoolPlan: async ({ schoolId, planCode, billingCycle = "monthly", actorUserId }) => {
    const plan = await SuperAdminModel.getPlanByCode(planCode);
    if (!plan) {
      throw new Error("Plan introuvable");
    }

    const cycle = String(billingCycle || "").trim().toLowerCase() === "annual" ? "annual" : "monthly";
    const amount = cycle === "annual"
      ? Number(plan.price_annual || Math.round(Number(plan.price_monthly || 0) * 12 * 0.85))
      : Number(plan.price_monthly || 0);

    await SuperAdminModel.changeSchoolPlan(schoolId, plan.code);
    const now = new Date();
    const expires = new Date(now);
    if (cycle === "annual") {
      expires.setFullYear(expires.getFullYear() + 1);
    } else {
      expires.setMonth(expires.getMonth() + 1);
    }
    await SuperAdminModel.createSubscriptionRecord({
      schoolId,
      planCode: plan.code,
      amount,
      billingCycle: cycle,
      status: "active",
      startsAt: now.toISOString().slice(0, 10),
      expiresAt: expires.toISOString().slice(0, 10),
      notes: "Plan modifie par super admin"
    });

    return SuperAdminModel.logActivity({
      actorUserId,
      schoolId,
      action: "plan_changed",
      details: `Nouveau plan ${plan.code}`
    });
  },

  updateSchoolInformation: async ({ schoolId, payload, actorUserId }) => {
    const name = String(payload.name || "").trim();
    const email = String(payload.email || "").trim().toLowerCase();
    if (!name || !email) {
      throw new Error("Nom et email de l'etablissement sont obligatoires");
    }

    try {
      await SuperAdminModel.updateSchoolInfo(schoolId, {
        ...payload,
        name,
        email
      });
    } catch (err) {
      if (String(err && err.message || "").toLowerCase().includes("unique")) {
        throw new Error("Email etablissement deja utilise");
      }
      throw err;
    }

    return SuperAdminModel.logActivity({
      actorUserId,
      schoolId,
      action: "school_info_updated",
      details: "Informations etablissement modifiees"
    });
  },

  resetSchoolAdminPassword: async ({ schoolId, newPassword, actorUserId }) => {
    const password = String(newPassword || "");
    if (password.length < 8) {
      throw new Error("Mot de passe minimum 8 caracteres");
    }
    const adminUser = await SuperAdminModel.getSchoolAdminUser(schoolId);
    if (!adminUser) {
      throw new Error("Aucun administrateur ecole trouve");
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await SuperAdminModel.updateUserPassword(adminUser.id, hash);

    return SuperAdminModel.logActivity({
      actorUserId,
      schoolId,
      action: "school_admin_password_reset",
      details: `Mot de passe admin ecole reinitialise (${adminUser.email})`
    });
  },

  createAdditionalSuperAdmin: async ({ fullName, email, password, actorUserId }) => {
    const name = String(fullName || "").trim();
    const userEmail = String(email || "").trim().toLowerCase();
    const pwd = String(password || "");
    if (!name || !userEmail || pwd.length < 8) {
      throw new Error("Nom, email et mot de passe (8+ caracteres) sont obligatoires");
    }

    const hash = await bcrypt.hash(pwd, SALT_ROUNDS);
    try {
      await SuperAdminModel.createSuperAdmin({
        fullName: name,
        email: userEmail,
        passwordHash: hash
      });
    } catch (err) {
      if (String(err && err.message || "").toLowerCase().includes("unique")) {
        throw new Error("Un compte existe deja avec cet email");
      }
      throw err;
    }

    return SuperAdminModel.logActivity({
      actorUserId,
      schoolId: null,
      action: "superadmin_created",
      details: `Nouveau superadmin: ${userEmail}`
    });
  }
};

module.exports = SuperAdminService;
