const { get, all, run } = require("../../utils/dbAsync");

const SuperAdminModel = {
  stats: async () => {
    const totalSchoolsRow = await get("SELECT COUNT(*) AS total FROM schools");
    const activeSubsRow = await get(
      `
      SELECT COUNT(*) AS total
      FROM schools s
      JOIN saas_subscriptions ss ON ss.id = (
        SELECT x.id
        FROM saas_subscriptions x
        WHERE x.school_id = s.id
        ORDER BY x.created_at DESC, x.id DESC
        LIMIT 1
      )
      WHERE lower(trim(COALESCE(ss.status, ''))) = 'active'
        AND (ss.expires_at IS NULL OR date(ss.expires_at) >= date('now'))
      `
    );
    const expiredSubsRow = await get(
      `
      SELECT COUNT(*) AS total
      FROM schools s
      JOIN saas_subscriptions ss ON ss.id = (
        SELECT x.id
        FROM saas_subscriptions x
        WHERE x.school_id = s.id
        ORDER BY x.created_at DESC, x.id DESC
        LIMIT 1
      )
      WHERE lower(trim(COALESCE(ss.status, ''))) = 'expired'
         OR (ss.expires_at IS NOT NULL AND date(ss.expires_at) < date('now'))
      `
    );
    const pendingSubsRow = await get(
      `
      SELECT COUNT(*) AS total
      FROM schools s
      JOIN saas_subscriptions ss ON ss.id = (
        SELECT x.id
        FROM saas_subscriptions x
        WHERE x.school_id = s.id
        ORDER BY x.created_at DESC, x.id DESC
        LIMIT 1
      )
      WHERE lower(trim(COALESCE(ss.status, ''))) = 'pending'
      `
    );
    const revenueRow = await get(
      `
      SELECT COALESCE(SUM(ss.amount), 0) AS total
      FROM schools s
      JOIN saas_subscriptions ss ON ss.id = (
        SELECT x.id
        FROM saas_subscriptions x
        WHERE x.school_id = s.id
        ORDER BY x.created_at DESC, x.id DESC
        LIMIT 1
      )
      WHERE lower(trim(COALESCE(ss.status, ''))) = 'active'
        AND (ss.expires_at IS NULL OR date(ss.expires_at) >= date('now'))
      `
    );

    return {
      totalSchools: totalSchoolsRow ? totalSchoolsRow.total : 0,
      saasRevenue: revenueRow ? revenueRow.total : 0,
      activeSubscriptions: activeSubsRow ? activeSubsRow.total : 0,
      expiredSubscriptions: expiredSubsRow ? expiredSubsRow.total : 0,
      pendingSubscriptions: pendingSubsRow ? pendingSubsRow.total : 0
    };
  },

  listSchools: async () => {
    return all(
      `
      SELECT s.*, sp.name AS plan_name, sp.price_monthly, sp.price_annual,
             ss.id AS subscription_id, ss.status AS subscription_status, ss.expires_at AS subscription_expires_at, ss.billing_cycle
      FROM schools s
      LEFT JOIN subscription_plans sp ON sp.code = s.subscription_plan
      LEFT JOIN saas_subscriptions ss ON ss.id = (
        SELECT id
        FROM saas_subscriptions x
        WHERE x.school_id = s.id
        ORDER BY x.created_at DESC, x.id DESC
        LIMIT 1
      )
      ORDER BY s.created_at DESC
      `
    );
  },

  listPendingSubscriptions: async () => {
    return all(
      `
      SELECT ss.*, s.name AS school_name, s.email AS school_email, sp.name AS plan_name, sp.price_monthly, sp.price_annual
      FROM saas_subscriptions ss
      JOIN schools s ON s.id = ss.school_id
      LEFT JOIN subscription_plans sp ON sp.code = ss.plan_code
      WHERE lower(trim(ss.status)) = 'pending'
      ORDER BY ss.created_at DESC
      `
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

  setSchoolStatus: async (schoolId, isActive) => {
    return run("UPDATE schools SET is_active = ? WHERE id = ?", [isActive ? 1 : 0, schoolId]);
  },

  updateSubscriptionStatus: async (subscriptionId, status, actorUserId = null, notes = null) => {
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

  changeSchoolPlan: async (schoolId, planCode) => {
    return run("UPDATE schools SET subscription_plan = ? WHERE id = ?", [planCode, schoolId]);
  },

  createSubscriptionRecord: async ({ schoolId, planCode, amount, billingCycle = "monthly", status, startsAt, expiresAt, notes }) => {
    return run(
      `
      INSERT INTO saas_subscriptions (school_id, plan_code, amount, billing_cycle, status, starts_at, expires_at, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [schoolId, planCode, amount || 0, billingCycle || "monthly", status || "active", startsAt || null, expiresAt || null, notes || null]
    );
  },

  logActivity: async ({ actorUserId, schoolId, action, details }) => {
    return run(
      "INSERT INTO activity_logs (actor_user_id, school_id, action, details) VALUES (?, ?, ?, ?)",
      [actorUserId || null, schoolId || null, action, details || null]
    );
  },

  getPlanByCode: async (planCode) => {
    return get("SELECT * FROM subscription_plans WHERE code = ?", [planCode]);
  },

  getSubscriptionById: async (subscriptionId) => {
    return get("SELECT * FROM saas_subscriptions WHERE id = ?", [subscriptionId]);
  },

  updateSchoolInfo: async (schoolId, payload) => {
    return run(
      `
      UPDATE schools
      SET name = ?, email = ?, phone = ?, address = ?, localisation = ?, code_postal = ?, logo_url = ?,
          promoter_name = ?, director_name = ?
      WHERE id = ?
      `,
      [
        payload.name,
        payload.email,
        payload.phone || "",
        payload.address || "",
        payload.localisation || "",
        payload.code_postal || "",
        payload.logo_url || "",
        payload.promoter_name || "",
        payload.director_name || "",
        schoolId
      ]
    );
  },

  getSchoolAdminUser: async (schoolId) => {
    return get(
      `
      SELECT id, full_name, email
      FROM users
      WHERE school_id = ? AND role = 'school_admin'
      ORDER BY created_at ASC, id ASC
      LIMIT 1
      `,
      [schoolId]
    );
  },

  updateUserPassword: async (userId, passwordHash) => {
    return run("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, userId]);
  },

  createSuperAdmin: async ({ fullName, email, passwordHash }) => {
    return run(
      `
      INSERT INTO users (school_id, full_name, email, password_hash, role, is_active)
      VALUES (NULL, ?, ?, ?, 'superadmin', 1)
      `,
      [fullName, email, passwordHash]
    );
  },

  listSuperAdmins: async () => {
    return all(
      `
      SELECT id, full_name, email, is_active, created_at
      FROM users
      WHERE role = 'superadmin'
      ORDER BY created_at DESC, id DESC
      `
    );
  },

  listPlans: async () => {
    return all("SELECT code, name, price_monthly, price_annual, annual_discount_percent FROM subscription_plans ORDER BY price_monthly ASC");
  }
};

module.exports = SuperAdminModel;
