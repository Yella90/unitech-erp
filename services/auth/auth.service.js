const bcrypt = require("bcrypt");
const { run, get } = require("../../utils/dbAsync");
const SchoolModel = require("../../models/schools.model");
const UserModel = require("../../models/users.model");
const { pool ,query} = require("../../config/postgres"); // PostgreSQL
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
  ensureSuperAdmin: async () => {
    const email = process.env.SUPERADMIN_EMAIL;
    const password = process.env.SUPERADMIN_PASSWORD;
    if (!email || !password) return;

    const existing = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
    if (existing.rows.length > 0) return;

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await pool.query(
      "INSERT INTO users (school_id, full_name, email, password_hash, role, is_active) VALUES ($1,$2,$3,$4,$5,$6)",
      [null, "Super Admin", email, hash, "superadmin", 1]
    );
  },

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

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Vérifier si école ou admin existe déjà
      const existingSchool = await client.query("SELECT * FROM schools WHERE email=$1", [schoolEmail]);
      if (existingSchool.rows.length) throw new Error("Une école existe déjà avec cet email");

      const existingAdmin = await client.query("SELECT * FROM users WHERE email=$1", [adminEmail]);
      if (existingAdmin.rows.length) throw new Error("Un utilisateur existe déjà avec cet email");

      // Créer l'école
      const schoolResult = await client.query(
        "INSERT INTO schools (name,email,phone,address,subscription_plan,is_active) VALUES ($1,$2,$3,$4,$5,1) RETURNING id",
        [schoolName, schoolEmail, schoolPhone || "", schoolAddress || "", subscriptionPlan || "basic"]
      );
      const schoolId = schoolResult.rows[0].id;

      // Créer admin
      const passwordHash = await bcrypt.hash(adminPassword, SALT_ROUNDS);
      await client.query(
        "INSERT INTO users (school_id, full_name, email, password_hash, role, is_active) VALUES ($1,$2,$3,$4,'school_admin',1)",
        [schoolId, adminName, adminEmail, passwordHash]
      );

      // Abonnement
      const planResult = await client.query("SELECT code, price_monthly, price_annual FROM subscription_plans WHERE code=$1", [subscriptionPlan || "basic"]);
      const plan = planResult.rows[0];
      const cycle = String(billingCycle || "").toLowerCase() === "annual" ? "annual" : "monthly";
      const startsAt = new Date();
      const expiresAt = new Date(startsAt);
      if (cycle === "annual") expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      else expiresAt.setMonth(expiresAt.getMonth() + 1);
      const amount = cycle === "annual" ? (plan?.price_annual || Math.round((plan?.price_monthly || 0) * 12 * 0.85)) : (plan?.price_monthly || 0);

      await client.query(
        `INSERT INTO saas_subscriptions (school_id, plan_code, amount, billing_cycle, status, starts_at, expires_at, notes)
         VALUES ($1,$2,$3,$4,'pending',$5,$6,$7)`,
        [schoolId, plan?.code || "basic", amount, cycle, startsAt.toISOString().slice(0,10), expiresAt.toISOString().slice(0,10), "En attente de validation super admin"]
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
  ,
  login: async ({ email, password }) => {
    const result = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
    const user = result.rows[0];
    if (!user) throw new Error("Identifiants invalides");

    if (Number(user.is_active) !== 1) throw new Error("Compte utilisateur désactivé");

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw new Error("Identifiants invalides");

    return user;
  }
};


module.exports = AuthService;