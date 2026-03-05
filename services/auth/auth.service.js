const bcrypt = require("bcryptjs");
const { run, get } = require("../../utils/dbAsync");
const SchoolModel = require("../../models/schools.model");
const UserModel = require("../../models/users.model");
const CentralSyncService = require("../sync/central-sync.service");

const SALT_ROUNDS = 10;
const usePostgres = String(process.env.DB_CLIENT || "").trim().toLowerCase() === "postgres";

function resolveBillingCycle(raw) {
  return String(raw || "").trim().toLowerCase() === "annual" ? "annual" : "monthly";
}

function computeAmount(plan, cycle) {
  if (cycle === "annual") {
    const annual = Number(plan && plan.price_annual ? plan.price_annual : 0);
    if (annual > 0) return annual;
    return Math.round(Number(plan && plan.price_monthly ? plan.price_monthly : 0) * 12 * 0.85);
  }
  return Number(plan && plan.price_monthly ? plan.price_monthly : 0);
}

async function registerWithPostgres({
  schoolName,
  schoolEmail,
  schoolPhone,
  schoolAddress,
  planCode,
  cycle,
  adminName,
  adminEmail,
  adminPassword
}) {
  const { pool } = require("../../config/postgres");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const schoolResult = await client.query(
      `
        INSERT INTO schools (name, email, phone, address, subscription_plan, is_active)
        VALUES ($1, $2, $3, $4, $5, 1)
        RETURNING id
      `,
      [schoolName, schoolEmail, schoolPhone || "", schoolAddress || "", planCode]
    );
    const schoolId = Number(schoolResult.rows[0].id);

    const passwordHash = await bcrypt.hash(String(adminPassword || ""), SALT_ROUNDS);
    await client.query(
      `
        INSERT INTO users (school_id, full_name, email, password_hash, role, is_active)
        VALUES ($1, $2, $3, $4, 'school_admin', 1)
      `,
      [schoolId, adminName, adminEmail, passwordHash]
    );

    const planResult = await client.query(
      "SELECT code, price_monthly, price_annual FROM subscription_plans WHERE code = $1",
      [planCode]
    );
    const plan = planResult.rows[0] || { code: "basic", price_monthly: 0, price_annual: 0 };

    const startsAt = new Date();
    const expiresAt = new Date(startsAt);
    if (cycle === "annual") expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    else expiresAt.setMonth(expiresAt.getMonth() + 1);

    await client.query(
      `
        INSERT INTO saas_subscriptions (school_id, plan_code, amount, billing_cycle, status, starts_at, expires_at, notes)
        VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)
      `,
      [
        schoolId,
        plan.code || "basic",
        computeAmount(plan, cycle),
        cycle,
        startsAt.toISOString().slice(0, 10),
        expiresAt.toISOString().slice(0, 10),
        "En attente de validation super admin"
      ]
    );

    await client.query("COMMIT");
    return { schoolId, adminEmail };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function registerWithSqlite({
  schoolName,
  schoolEmail,
  schoolPhone,
  schoolAddress,
  planCode,
  cycle,
  adminName,
  adminEmail,
  adminPassword
}) {
  await run("BEGIN TRANSACTION");
  try {
    const school = await SchoolModel.create({
      name: schoolName,
      email: schoolEmail,
      phone: schoolPhone || "",
      address: schoolAddress || "",
      subscription_plan: planCode
    });
    const schoolId = Number(school.id);

    const passwordHash = await bcrypt.hash(String(adminPassword || ""), SALT_ROUNDS);
    await UserModel.create({
      school_id: schoolId,
      full_name: adminName,
      email: adminEmail,
      password_hash: passwordHash,
      role: "school_admin"
    });

    const plan = await get(
      "SELECT code, price_monthly, price_annual FROM subscription_plans WHERE code = ?",
      [planCode]
    );
    const resolvedPlan = plan || { code: "basic", price_monthly: 0, price_annual: 0 };

    const startsAt = new Date();
    const expiresAt = new Date(startsAt);
    if (cycle === "annual") expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    else expiresAt.setMonth(expiresAt.getMonth() + 1);

    await run(
      `
        INSERT INTO saas_subscriptions (school_id, plan_code, amount, billing_cycle, status, starts_at, expires_at, notes)
        VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
      `,
      [
        schoolId,
        resolvedPlan.code || "basic",
        computeAmount(resolvedPlan, cycle),
        cycle,
        startsAt.toISOString().slice(0, 10),
        expiresAt.toISOString().slice(0, 10),
        "En attente de validation super admin"
      ]
    );

    await run("COMMIT");
    return { schoolId, adminEmail };
  } catch (err) {
    await run("ROLLBACK");
    throw err;
  }
}

const AuthService = {
  ensureSuperAdmin: async () => {
    const email = String(process.env.SUPERADMIN_EMAIL || "").trim().toLowerCase();
    const password = String(process.env.SUPERADMIN_PASSWORD || "");
    if (!email || !password) return;

    const existing = await UserModel.findByEmail(email);
    const hash = await bcrypt.hash(password, SALT_ROUNDS);

    // In desktop minimal bootstrap mode, keep superadmin credentials deterministic.
    // This avoids login failure after reinstall/update when DB already exists.
    const desktopBootstrap = String(process.env.DB_MINIMAL_BOOTSTRAP || "0") === "1";
    if (existing && desktopBootstrap) {
      await run(
        `
          UPDATE users
          SET school_id = NULL,
              full_name = 'Super Admin',
              password_hash = ?,
              role = 'superadmin',
              is_active = 1
          WHERE id = ?
        `,
        [hash, existing.id]
      );
      return;
    }

    if (existing) return;

    await UserModel.create({
      school_id: null,
      full_name: "Super Admin",
      email,
      password_hash: hash,
      role: "superadmin"
    });
  },

  registerSchoolWithAdmin: async (payload) => {
    const schoolName = String(payload.schoolName || "").trim();
    const schoolEmail = String(payload.schoolEmail || "").trim().toLowerCase();
    const schoolPhone = String(payload.schoolPhone || "").trim();
    const schoolAddress = String(payload.schoolAddress || "").trim();
    const planCode = String(payload.subscriptionPlan || "basic").trim().toLowerCase();
    const cycle = resolveBillingCycle(payload.billingCycle);
    const adminName = String(payload.adminName || "").trim();
    const adminEmail = String(payload.adminEmail || "").trim().toLowerCase();
    const adminPassword = String(payload.adminPassword || "");

    const existingSchool = await SchoolModel.findByEmail(schoolEmail);
    if (existingSchool) throw new Error("Une ecole existe deja avec cet email");

    const existingAdmin = await UserModel.findByEmail(adminEmail);
    if (existingAdmin) throw new Error("Un utilisateur existe deja avec cet email");

    if (usePostgres) {
      return registerWithPostgres({
        schoolName,
        schoolEmail,
        schoolPhone,
        schoolAddress,
        planCode,
        cycle,
        adminName,
        adminEmail,
        adminPassword
      });
    }

    const created = await registerWithSqlite({
      schoolName,
      schoolEmail,
      schoolPhone,
      schoolAddress,
      planCode,
      cycle,
      adminName,
      adminEmail,
      adminPassword
    });

    CentralSyncService.pushLocalRegistrationToCentral(adminEmail).catch(() => {});
    return created;
  },

  login: async ({ email, password }) => {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    let user = await UserModel.findByEmail(normalizedEmail);

    if (!user && CentralSyncService.isEnabled()) {
      await CentralSyncService.pullUserAndSchoolByEmail(normalizedEmail);
      user = await UserModel.findByEmail(normalizedEmail);
    }
    if (!user) throw new Error("Identifiants invalides");

    if (user.role !== "superadmin" && CentralSyncService.isEnabled()) {
      await CentralSyncService.pullUserAndSchoolByEmail(normalizedEmail);
      user = await UserModel.findByEmail(normalizedEmail);
    }

    if (Number(user.is_active) !== 1) {
      throw new Error("Compte utilisateur desactive");
    }

    if (user.role !== "superadmin" && Number(user.school_is_active) !== 1) {
      throw new Error("Ecole desactivee");
    }

    const ok = await bcrypt.compare(String(password || ""), user.password_hash);
    if (!ok) throw new Error("Identifiants invalides");

    return user;
  }
};

module.exports = AuthService;
