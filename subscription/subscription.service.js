const SubscriptionModel = require("../models/subscription.model");

const PLAN_CAPABILITIES = {
  basic: {
    code: "basic",
    max_students: 1000000,
    max_teachers: 1000000,
    max_users: 1,
    finance_enabled: 1,
    setup_assistant: 0,
    excel_import: 0,
    ocr_import: 0,
    dashboard_smart: 0,
    stats_advanced: 0,
    export_advanced: 0,
    multi_users_advanced: 0
  },
  pro: {
    code: "pro",
    max_students: 1000000,
    max_teachers: 1000000,
    max_users: 3,
    finance_enabled: 1,
    setup_assistant: 1,
    excel_import: 1,
    ocr_import: 0,
    dashboard_smart: 1,
    stats_advanced: 0,
    export_advanced: 0,
    multi_users_advanced: 1
  },
  smart: {
    code: "smart",
    max_students: 1000000,
    max_teachers: 1000000,
    max_users: 3,
    finance_enabled: 1,
    setup_assistant: 1,
    excel_import: 1,
    ocr_import: 0,
    dashboard_smart: 1,
    stats_advanced: 0,
    export_advanced: 0,
    multi_users_advanced: 1
  },
  premium: {
    code: "premium",
    max_students: 1000000,
    max_teachers: 1000000,
    max_users: 1000000,
    finance_enabled: 1,
    setup_assistant: 1,
    excel_import: 1,
    ocr_import: 1,
    dashboard_smart: 1,
    stats_advanced: 1,
    export_advanced: 1,
    multi_users_advanced: 1
  }
};

const FEATURE_MESSAGES = {
  finance_enabled: "Module financier indisponible pour ce plan",
  setup_assistant: "Assistant setup reserve aux plans Smart et Premium",
  excel_import: "Import Excel reserve aux plans Smart et Premium",
  ocr_import: "Import OCR photo reserve au plan Premium",
  dashboard_smart: "Dashboard intelligent reserve aux plans Smart et Premium",
  stats_advanced: "Statistiques avancees reservees au plan Premium",
  export_advanced: "Exports avances reserves au plan Premium",
  multi_users_advanced: "Multi-utilisateurs avance reserve aux plans Smart et Premium"
};

function resolvePlanCapabilities(plan) {
  const code = String((plan && plan.code) || "").trim().toLowerCase();
  const base = PLAN_CAPABILITIES[code] || PLAN_CAPABILITIES.basic;
  return {
    ...base,
    ...(plan || {}),
    code: code || base.code
  };
}

function resolveBillingCycle(raw) {
  const cycle = String(raw || "").trim().toLowerCase();
  return cycle === "annual" ? "annual" : "monthly";
}

function computeSubscriptionAmount(plan, billingCycle) {
  if (billingCycle === "annual") {
    const annual = Number(plan.price_annual || 0);
    if (annual > 0) return annual;
    const monthly = Number(plan.price_monthly || 0);
    return Math.round(monthly * 12 * 0.85);
  }
  return Number(plan.price_monthly || 0);
}

function computeExpiresAt(startsAt, billingCycle) {
  const dt = new Date(startsAt);
  if (billingCycle === "annual") {
    dt.setFullYear(dt.getFullYear() + 1);
  } else {
    dt.setMonth(dt.getMonth() + 1);
  }
  return dt.toISOString().slice(0, 10);
}

const SubscriptionService = {
  getSchoolPlan: async (schoolId) => {
    return SubscriptionModel.getSchoolPlan(schoolId);
  },

  listPlans: async () => {
    return SubscriptionModel.listPlans();
  },

  getLatestSchoolSubscription: async (schoolId) => {
    return SubscriptionModel.getLatestSchoolSubscription(schoolId);
  },

  getSchoolAccessStatus: async (schoolId) => {
    const subscription = await SubscriptionModel.getLatestSchoolSubscription(schoolId);
    if (!subscription) {
      return {
        allowed: false,
        status: "none",
        message: "Aucun abonnement trouve pour cette ecole"
      };
    }

    const now = new Date();
    const expiresAt = subscription.expires_at ? new Date(subscription.expires_at) : null;
    const status = String(subscription.status || "").trim().toLowerCase() || "pending";

    if (status === "suspended") {
      return { allowed: false, status, message: "Abonnement suspendu. Contactez l'administration." };
    }
    if (status === "pending") {
      return { allowed: false, status, message: "Abonnement en attente de validation super admin." };
    }
    if (status === "expired") {
      return { allowed: false, status, message: "Abonnement expire." };
    }
    if (expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt < now) {
      return { allowed: false, status: "expired", message: "Abonnement expire." };
    }

    return {
      allowed: true,
      status: "active",
      message: "Abonnement actif",
      planCode: subscription.plan_code,
      planName: subscription.plan_name,
      expiresAt: subscription.expires_at || null,
      maxStudents: Number(subscription.max_students || 0),
      maxTeachers: Number(subscription.max_teachers || 0),
      maxUsers: Number(resolvePlanCapabilities({ code: subscription.plan_code }).max_users || 0)
    };
  },

  assertUnderLimit: async ({ schoolId, entity, currentCount }) => {
    const status = await SubscriptionService.getSchoolAccessStatus(schoolId);
    if (!status.allowed) {
      throw new Error(status.message || "Abonnement inactif");
    }

    const plan = await SubscriptionModel.getSchoolPlan(schoolId);
    if (!plan) {
      throw new Error("Plan d'abonnement introuvable pour cette ecole");
    }

    const cap = resolvePlanCapabilities(plan);

    if (entity === "students" && Number(cap.max_students || 0) > 0 && currentCount >= Number(cap.max_students || 0)) {
      throw new Error(`Limite atteinte: plan ${plan.code} (${cap.max_students} eleves max)`);
    }

    if (entity === "teachers" && Number(cap.max_teachers || 0) > 0 && currentCount >= Number(cap.max_teachers || 0)) {
      throw new Error(`Limite atteinte: plan ${plan.code} (${cap.max_teachers} enseignants max)`);
    }

    if (entity === "users" && Number(cap.max_users || 0) > 0 && currentCount >= Number(cap.max_users || 0)) {
      throw new Error(`Limite atteinte: plan ${plan.code} (${cap.max_users} comptes utilisateurs max)`);
    }

    return plan;
  },

  assertFeatureEnabled: async ({ schoolId, feature }) => {
    const plan = await SubscriptionModel.getSchoolPlan(schoolId);
    if (!plan) {
      throw new Error("Plan d'abonnement introuvable");
    }
    const cap = resolvePlanCapabilities(plan);
    if (Number(cap[feature] || 0) !== 1) {
      throw new Error(FEATURE_MESSAGES[feature] || "Fonctionnalite indisponible pour ce plan");
    }

    return plan;
  },

  getPlanCapabilities: async (schoolId) => {
    const plan = await SubscriptionModel.getSchoolPlan(schoolId);
    if (!plan) return resolvePlanCapabilities(null);
    return resolvePlanCapabilities(plan);
  },

  requestSchoolPlanChange: async ({ schoolId, planCode, billingCycle, actorUserId = null }) => {
    const code = String(planCode || "").trim().toLowerCase();
    const cycle = resolveBillingCycle(billingCycle);
    const plan = await SubscriptionModel.getPlanByCode(code);
    if (!plan) {
      throw new Error("Plan d'abonnement invalide");
    }

    const latest = await SubscriptionModel.getLatestSchoolSubscription(schoolId);
    if (latest && String(latest.status || "").trim().toLowerCase() === "pending") {
      throw new Error("Une demande d'abonnement est deja en attente de validation");
    }

    const startsAt = new Date().toISOString().slice(0, 10);
    const amount = computeSubscriptionAmount(plan, cycle);
    const expiresAt = computeExpiresAt(new Date(), cycle);

    await SubscriptionModel.createSchoolSubscription({
      schoolId,
      planCode: plan.code,
      amount,
      billingCycle: cycle,
      status: "pending",
      startsAt,
      expiresAt,
      notes: "Demande envoyee par l'admin ecole"
    });

    await SubscriptionModel.createActivityLog({
      actorUserId,
      schoolId,
      action: "subscription_request_created",
      details: `Demande plan ${plan.code} (${cycle})`
    });
  },

  listPendingSubscriptions: async () => {
    return SubscriptionModel.listSubscriptionsByStatus("pending");
  },

  listActivityLogs: async (limit = 20) => {
    return SubscriptionModel.listActivityLogs(limit);
  },

  validateSubscription: async ({ subscriptionId, actorUserId }) => {
    const pending = await SubscriptionModel.listSubscriptionsByStatus("pending");
    const target = (pending || []).find((row) => Number(row.id) === Number(subscriptionId));
    if (!target) {
      throw new Error("Abonnement en attente introuvable");
    }
    await SubscriptionModel.updateSubscriptionStatus(subscriptionId, "active", "Valide par super admin", actorUserId);
    await SubscriptionModel.createActivityLog({
      actorUserId,
      schoolId: target.school_id,
      action: "subscription_validated",
      details: `Abonnement ${subscriptionId} valide`
    });
  },

  suspendSchoolSubscription: async ({ schoolId, actorUserId, reason }) => {
    const latest = await SubscriptionModel.getLatestSchoolSubscription(schoolId);
    if (!latest) throw new Error("Aucun abonnement pour cette ecole");
    await SubscriptionModel.updateSubscriptionStatus(latest.id, "suspended", reason || "Suspendu par super admin", actorUserId);
    await SubscriptionModel.createActivityLog({
      actorUserId,
      schoolId,
      action: "school_suspended",
      details: reason || "Ecole suspendue"
    });
  },

  activateSchoolSubscription: async ({ schoolId, actorUserId }) => {
    const latest = await SubscriptionModel.getLatestSchoolSubscription(schoolId);
    if (!latest) throw new Error("Aucun abonnement pour cette ecole");
    await SubscriptionModel.updateSubscriptionStatus(latest.id, "active", "Reactivation super admin", actorUserId);
    await SubscriptionModel.createActivityLog({
      actorUserId,
      schoolId,
      action: "school_activated",
      details: "Ecole reactivee"
    });
  },

  changeSchoolPlan: async ({ schoolId, planCode, actorUserId }) => {
    const plan = await SubscriptionModel.getPlanByCode(planCode);
    if (!plan) throw new Error("Plan invalide");

    await SubscriptionModel.updateSchoolPlan(schoolId, plan.code);
    const now = new Date();
    const expires = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
    await SubscriptionModel.createSchoolSubscription({
      schoolId,
      planCode: plan.code,
      amount: Number(plan.price_monthly || 0),
      status: "active",
      startsAt: now.toISOString().slice(0, 10),
      expiresAt: expires.toISOString().slice(0, 10),
      notes: "Mise a jour plan par super admin"
    });

    await SubscriptionModel.createActivityLog({
      actorUserId,
      schoolId,
      action: "plan_changed",
      details: `Nouveau plan: ${plan.code}`
    });
  }
};

module.exports = SubscriptionService;
