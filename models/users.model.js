const { run, get, all } = require("../utils/dbAsync");

const UserModel = {
  create: async ({ school_id, full_name, email, password_hash, role }) => {
    const sql = `
      INSERT INTO users (school_id, full_name, email, password_hash, role, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `;
    return run(sql, [school_id || null, full_name, email, password_hash, role]);
  },

  findByEmail: async (email) => {
    return get(
      `
      SELECT u.*, s.name AS school_name, s.subscription_plan, s.is_active AS school_is_active
      FROM users u
      LEFT JOIN schools s ON s.id = u.school_id
      WHERE u.email = ?
      `,
      [email]
    );
  },

  findById: async (id) => {
    return get("SELECT * FROM users WHERE id = ?", [id]);
  },

  countBySchoolAndRole: async (schoolId, role) => {
    const row = await get(
      "SELECT COUNT(*) AS total FROM users WHERE school_id = ? AND role = ?",
      [schoolId, role]
    );
    return row ? row.total : 0;
  },

  listBySchool: async (schoolId) => {
    return all("SELECT * FROM users WHERE school_id = ? ORDER BY created_at DESC", [schoolId]);
  }
};

module.exports = UserModel;
