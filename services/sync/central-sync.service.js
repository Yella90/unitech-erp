const { Pool } = require("pg");
const { get, run } = require("../../utils/dbAsync");

const localSqlite = String(process.env.DB_CLIENT || "").trim().toLowerCase() !== "postgres";
const centralUrl = String(
  process.env.CENTRAL_DATABASE_URL || process.env.DATABASE_URL || ""
).trim();
const centralSsl = String(
  process.env.CENTRAL_PGSSL || process.env.PGSSL || "true"
).trim().toLowerCase() === "true";

let pool = null;

function isEnabled() {
  return localSqlite && Boolean(centralUrl);
}

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: centralUrl,
      ssl: centralSsl ? { rejectUnauthorized: false } : false
    });
  }
  return pool;
}

async function centralGetUserByEmail(email) {
  const p = getPool();
  const q = await p.query(
    `
      SELECT
        u.id,
        u.school_id,
        u.full_name,
        u.email,
        u.password_hash,
        u.role,
        u.is_active,
        s.name AS school_name,
        s.email AS school_email,
        s.phone AS school_phone,
        s.address AS school_address,
        s.subscription_plan AS school_subscription_plan,
        s.is_active AS school_is_active
      FROM users u
      LEFT JOIN schools s ON s.id = u.school_id
      WHERE lower(trim(u.email)) = lower(trim($1))
      LIMIT 1
    `,
    [email]
  );
  return q.rows && q.rows[0] ? q.rows[0] : null;
}

async function centralGetLatestSubscriptionBySchoolEmail(schoolEmail) {
  if (!schoolEmail) return null;
  const p = getPool();
  const q = await p.query(
    `
      SELECT ss.plan_code, ss.amount, ss.billing_cycle, ss.status, ss.starts_at, ss.expires_at, ss.notes
      FROM saas_subscriptions ss
      JOIN schools s ON s.id = ss.school_id
      WHERE lower(trim(s.email)) = lower(trim($1))
      ORDER BY ss.created_at DESC, ss.id DESC
      LIMIT 1
    `,
    [schoolEmail]
  );
  return q.rows && q.rows[0] ? q.rows[0] : null;
}

async function upsertLocalSchoolFromCentral(centralUser) {
  const schoolEmail = String(centralUser.school_email || "").trim().toLowerCase();
  const centralSchoolId = Number(centralUser.school_id || 0) || null;
  const existing = await get("SELECT id FROM schools WHERE lower(trim(email)) = lower(trim(?)) LIMIT 1", [schoolEmail]);
  if (existing && existing.id) {
    await run(
      `
        UPDATE schools
        SET name = ?, phone = ?, address = ?, subscription_plan = ?, is_active = ?, central_school_id = COALESCE(?, central_school_id)
        WHERE id = ?
      `,
      [
        centralUser.school_name || "",
        centralUser.school_phone || "",
        centralUser.school_address || "",
        centralUser.school_subscription_plan || "basic",
        Number(centralUser.school_is_active || 0) === 1 ? 1 : 0,
        centralSchoolId,
        existing.id
      ]
    );
    return Number(existing.id);
  }

  const created = await run(
    `
      INSERT INTO schools (central_school_id, name, email, phone, address, subscription_plan, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      centralSchoolId,
      centralUser.school_name || "Ecole",
      schoolEmail,
      centralUser.school_phone || "",
      centralUser.school_address || "",
      centralUser.school_subscription_plan || "basic",
      Number(centralUser.school_is_active || 0) === 1 ? 1 : 0
    ]
  );
  return Number(created.lastID);
}

async function upsertLocalUserFromCentral(centralUser, schoolId) {
  const userEmail = String(centralUser.email || "").trim().toLowerCase();
  const existing = await get("SELECT id FROM users WHERE lower(trim(email)) = lower(trim(?)) LIMIT 1", [userEmail]);
  if (existing && existing.id) {
    await run(
      `
        UPDATE users
        SET school_id = ?, full_name = ?, password_hash = ?, role = ?, is_active = ?
        WHERE id = ?
      `,
      [
        schoolId,
        centralUser.full_name || "Utilisateur",
        centralUser.password_hash,
        centralUser.role || "school_admin",
        Number(centralUser.is_active || 0) === 1 ? 1 : 0,
        existing.id
      ]
    );
    return Number(existing.id);
  }

  const created = await run(
    `
      INSERT INTO users (school_id, full_name, email, password_hash, role, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      schoolId,
      centralUser.full_name || "Utilisateur",
      userEmail,
      centralUser.password_hash,
      centralUser.role || "school_admin",
      Number(centralUser.is_active || 0) === 1 ? 1 : 0
    ]
  );
  return Number(created.lastID);
}

async function upsertLocalSubscriptionBySchoolEmail(schoolId, schoolEmail) {
  const sub = await centralGetLatestSubscriptionBySchoolEmail(schoolEmail);
  if (!sub) return;

  const existing = await get(
    `
      SELECT id
      FROM saas_subscriptions
      WHERE school_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    [schoolId]
  );

  if (existing && existing.id) {
    await run(
      `
        UPDATE saas_subscriptions
        SET plan_code = ?, amount = ?, billing_cycle = ?, status = ?, starts_at = ?, expires_at = ?, notes = ?
        WHERE id = ?
      `,
      [
        sub.plan_code || "basic",
        Number(sub.amount || 0),
        sub.billing_cycle || "monthly",
        sub.status || "pending",
        sub.starts_at || null,
        sub.expires_at || null,
        sub.notes || null,
        existing.id
      ]
    );
    return;
  }

  await run(
    `
      INSERT INTO saas_subscriptions (school_id, plan_code, amount, billing_cycle, status, starts_at, expires_at, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      schoolId,
      sub.plan_code || "basic",
      Number(sub.amount || 0),
      sub.billing_cycle || "monthly",
      sub.status || "pending",
      sub.starts_at || null,
      sub.expires_at || null,
      sub.notes || null
    ]
  );
}

async function pullUserAndSchoolByEmail(email) {
  if (!isEnabled()) return false;
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return false;

  let centralUser;
  try {
    centralUser = await centralGetUserByEmail(normalized);
  } catch {
    return false;
  }
  if (!centralUser) return false;

  if (String(centralUser.role || "").trim() === "superadmin") {
    const existing = await get("SELECT id FROM users WHERE lower(trim(email)) = lower(trim(?)) LIMIT 1", [normalized]);
    if (existing && existing.id) {
      await run(
        "UPDATE users SET full_name = ?, password_hash = ?, role = ?, is_active = ? WHERE id = ?",
        [
          centralUser.full_name || "Super Admin",
          centralUser.password_hash,
          "superadmin",
          Number(centralUser.is_active || 0) === 1 ? 1 : 0,
          existing.id
        ]
      );
      return true;
    }
    await run(
      "INSERT INTO users (school_id, full_name, email, password_hash, role, is_active) VALUES (NULL, ?, ?, ?, 'superadmin', ?)",
      [
        centralUser.full_name || "Super Admin",
        normalized,
        centralUser.password_hash,
        Number(centralUser.is_active || 0) === 1 ? 1 : 0
      ]
    );
    return true;
  }

  if (!centralUser.school_email) return false;

  await run("BEGIN TRANSACTION");
  try {
    const schoolId = await upsertLocalSchoolFromCentral(centralUser);
    await upsertLocalUserFromCentral(centralUser, schoolId);
    await upsertLocalSubscriptionBySchoolEmail(schoolId, centralUser.school_email);
    await run("COMMIT");
    return true;
  } catch (err) {
    await run("ROLLBACK");
    throw err;
  }
}

async function pushLocalRegistrationToCentral(adminEmail) {
  if (!isEnabled()) return false;
  const normalized = String(adminEmail || "").trim().toLowerCase();
  if (!normalized) return false;

  const local = await get(
    `
      SELECT
        u.full_name AS admin_name,
        u.email AS admin_email,
        u.password_hash,
        u.role,
        u.is_active AS user_is_active,
        s.name AS school_name,
        s.email AS school_email,
        s.phone AS school_phone,
        s.address AS school_address,
        s.subscription_plan,
        s.is_active AS school_is_active,
        ss.plan_code,
        ss.amount,
        ss.billing_cycle,
        ss.status,
        ss.starts_at,
        ss.expires_at,
        ss.notes
      FROM users u
      LEFT JOIN schools s ON s.id = u.school_id
      LEFT JOIN saas_subscriptions ss ON ss.school_id = s.id
      WHERE lower(trim(u.email)) = lower(trim(?))
      ORDER BY ss.created_at DESC, ss.id DESC
      LIMIT 1
    `,
    [normalized]
  );
  if (!local || !local.school_email) return false;

  const p = getPool();
  const client = await p.connect();
  try {
    await client.query("BEGIN");

    const schoolRes = await client.query(
      `
        INSERT INTO schools (name, email, phone, address, subscription_plan, is_active)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (email)
        DO UPDATE SET
          name = EXCLUDED.name,
          phone = EXCLUDED.phone,
          address = EXCLUDED.address,
          subscription_plan = EXCLUDED.subscription_plan,
          is_active = EXCLUDED.is_active
        RETURNING id
      `,
      [
        local.school_name || "Ecole",
        String(local.school_email).toLowerCase(),
        local.school_phone || "",
        local.school_address || "",
        local.subscription_plan || "basic",
        Number(local.school_is_active || 0) === 1 ? 1 : 0
      ]
    );
    const schoolId = Number(schoolRes.rows[0].id);

    await client.query(
      `
        INSERT INTO users (school_id, full_name, email, password_hash, role, is_active)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (email)
        DO UPDATE SET
          school_id = EXCLUDED.school_id,
          full_name = EXCLUDED.full_name,
          password_hash = EXCLUDED.password_hash,
          role = EXCLUDED.role,
          is_active = EXCLUDED.is_active
      `,
      [
        schoolId,
        local.admin_name || "Admin",
        String(local.admin_email).toLowerCase(),
        local.password_hash,
        local.role || "school_admin",
        Number(local.user_is_active || 0) === 1 ? 1 : 0
      ]
    );

    if (local.plan_code) {
      await client.query(
        `
          INSERT INTO saas_subscriptions (school_id, plan_code, amount, billing_cycle, status, starts_at, expires_at, notes)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          schoolId,
          local.plan_code || "basic",
          Number(local.amount || 0),
          local.billing_cycle || "monthly",
          local.status || "pending",
          local.starts_at || null,
          local.expires_at || null,
          local.notes || null
        ]
      );
    }

    await client.query("COMMIT");
    return true;
  } catch {
    await client.query("ROLLBACK");
    return false;
  } finally {
    client.release();
  }
}

module.exports = {
  isEnabled,
  pullUserAndSchoolByEmail,
  pushLocalRegistrationToCentral
};
