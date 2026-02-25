const bcrypt = require("bcrypt");
const db = require("../../config/db");
const { run, get } = require("../../utils/dbAsync");
const SchoolModel = require("../../models/schools.model");
const UserModel = require("../../models/users.model");
const pool = require("../../config/postgres"); // chemin selon ton projet
const usePostgres = process.env.DB_TYPE === "postgres"; 

const SALT_ROUNDS = 10;

async function ensureSuperAdmin() {
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;

  if (!email || !password) return;

  const existing = await UserModel.findByEmail(email);
  if (existing) return;

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  await UserModel.create({
    school_id: null,
    full_name: "Super Admin",
    email,
    password_hash: hash,
    role: "superadmin"
  });
}

const AuthService = {
  ensureSuperAdmin,

  registerSchoolWithAdmin: async (payload) => {
    const {
      schoolName,
      schoolEmail,
      schoolPhone,
      schoolAddress,
      subscriptionPlan,
      billingCycle,
      adminName,
      adminEmail,
      adminPassword
    } = payload;

    const existingSchool = await SchoolModel.findByEmail(schoolEmail);
    if (existingSchool) {
      throw new Error("Une ecole existe deja avec cet email");
    }

    const existingAdmin = await UserModel.findByEmail(adminEmail);
    if (existingAdmin) {
      throw new Error("Un utilisateur existe deja avec cet email");
    }

    const passwordHash = await bcrypt.hash(adminPassword, SALT_ROUNDS);

    await run("BEGIN TRANSACTION");
    pool.query("BEGIN");

    try {
      const schoolInsert = await SchoolModel.create({
        name: schoolName,
        email: schoolEmail,
        phone: schoolPhone,
        address: schoolAddress,
        subscription_plan: subscriptionPlan || "basic"
      });

      const schoolId = schoolInsert.id;

      await UserModel.create({
        school_id: schoolId,
        full_name: adminName,
        email: adminEmail,
        password_hash: passwordHash,
        role: "school_admin"
      });

      const plan = await get(
        "SELECT code, price_monthly, price_annual, annual_discount_percent FROM subscription_plans WHERE code = ?",
        [subscriptionPlan || "basic"]
      );
      const cycle = String(billingCycle || "").trim().toLowerCase() === "annual" ? "annual" : "monthly";
      const startsAt = new Date();
      const expiresAt = new Date(startsAt);
      if (cycle === "annual") {
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      } else {
        expiresAt.setMonth(expiresAt.getMonth() + 1);
      }
      const amount = cycle === "annual"
        ? Number((plan && (plan.price_annual || Math.round(Number(plan.price_monthly || 0) * 12 * 0.85))) || 0)
        : Number((plan && plan.price_monthly) || 0);
      if (usePostgres) {
  // PostgreSQL : utilise $1, $2, $3...
  await pool.query(
    `INSERT INTO saas_subscriptions
      (school_id, plan_code, amount, billing_cycle, status, starts_at, expires_at, notes)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)`,
    [
      schoolId,
      plan ? plan.code : "basic",
      amount,
      cycle,
      startsAt.toISOString().slice(0, 10),
      expiresAt.toISOString().slice(0, 10),
      "En attente de validation super admin"
    ]
  );
} else {
  // SQLite : continue d'utiliser run()
  await run(
    `INSERT INTO saas_subscriptions
      (school_id, plan_code, amount, billing_cycle, status, starts_at, expires_at, notes)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [
      schoolId,
      plan ? plan.code : "basic",
      amount,
      cycle,
      startsAt.toISOString().slice(0, 10),
      expiresAt.toISOString().slice(0, 10),
      "En attente de validation super admin"
    ]
  );
}

      await run("COMMIT");
      pool.query("COMMIT");

      const createdAdmin = await UserModel.findByEmail(adminEmail);
      return createdAdmin;
    } catch (err) {
      await run("ROLLBACK");
      throw err;
    }
  },

  login: async ({ email, password }) => {
    const user = await UserModel.findByEmail(email);
    if (!user) {
      throw new Error("Identifiants invalides");
    }

    if (Number(user.is_active) !== 1) {
      throw new Error("Compte utilisateur desactive");
    }

    if (user.role !== "superadmin" && Number(user.school_is_active) !== 1) {
      throw new Error("Ecole desactivee. Contactez le support");
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      throw new Error("Identifiants invalides");
    }

    return user;
  }
};

module.exports = AuthService;
