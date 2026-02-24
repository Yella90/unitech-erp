const { get, all, run } = require("../utils/dbAsync");

const SubscriptionModel = {
  getPlanByCode: async (code) => {
    return get("SELECT * FROM subscription_plans WHERE code = ?", [code]);
  },

  getSchoolPlan: async (schoolId) => {
    return get(
      `
      SELECT sp.*
      FROM schools s
      JOIN subscription_plans sp ON sp.code = s.subscription_plan
      WHERE s.id = ?
      `,
      [schoolId]
    );
  },

  getLatestSchoolSubscription: async (schoolId) => {
    return get(
      `
      SELECT ss.*, sp.name AS plan_name, sp.max_students, sp.max_teachers, sp.finance_enabled, sp.price_monthly, sp.price_annual, sp.annual_discount_percent
      FROM saas_subscriptions ss
      LEFT JOIN subscription_plans sp ON sp.code = ss.plan_code
      WHERE ss.school_id = ?
      ORDER BY ss.created_at DESC, ss.id DESC
      LIMIT 1
      `,
      [schoolId]
    );
  },

  listSubscriptionsByStatus: async (status) => {
    return all(
      `
      SELECT ss.*, s.name AS school_name, s.email AS school_email, sp.name AS plan_name
      FROM saas_subscriptions ss
      JOIN schools s ON s.id = ss.school_id
      LEFT JOIN subscription_plans sp ON sp.code = ss.plan_code
      WHERE lower(trim(ss.status)) = lower(trim(?))
      ORDER BY ss.created_at DESC
      `,
      [status]
    );
  },

  updateSubscriptionStatus: async (subscriptionId, status, notes = null, actorUserId = null) => {
    return run(
      `
      UPDATE saas_subscriptions
      SET status = ?, notes = ?, validated_at = CASE WHEN ? = 'active' THEN CURRENT_TIMESTAMP ELSE validated_at END,
          validated_by = CASE WHEN ? = 'active' THEN ? ELSE validated_by END
      WHERE id = ?
      `,
      [status, notes, status, status, actorUserId, subscriptionId]
    );
  },

  createActivityLog: async ({ actorUserId, schoolId, action, details }) => {
    return run(
      "INSERT INTO activity_logs (actor_user_id, school_id, action, details) VALUES (?, ?, ?, ?)",
      [actorUserId || null, schoolId || null, action, details || null]
    );
  },

  listActivityLogs: async (limit = 20) => {
    const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 20;
    return all(
      `
      SELECT l.*, u.full_name AS actor_name, s.name AS school_name
      FROM activity_logs l
      LEFT JOIN users u ON u.id = l.actor_user_id
      LEFT JOIN schools s ON s.id = l.school_id
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT ?
      `,
      [safeLimit]
    );
  },

  listPlans: async () => {
    return all("SELECT * FROM subscription_plans ORDER BY price_monthly ASC");
  },

  updateSchoolPlan: async (schoolId, planCode) => {
    return run("UPDATE schools SET subscription_plan = ? WHERE id = ?", [planCode, schoolId]);
  },

  createSchoolSubscription: async ({ schoolId, planCode, amount, billingCycle = "monthly", status = "pending", startsAt = null, expiresAt = null, notes = null }) => {
    return run(
      `
      INSERT INTO saas_subscriptions (school_id, plan_code, amount, billing_cycle, status, starts_at, expires_at, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [schoolId, planCode, amount || 0, billingCycle || "monthly", status, startsAt, expiresAt, notes]
    );
  }
};

module.exports = SubscriptionModel;
