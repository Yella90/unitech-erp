const { run, get, all } = require("../utils/dbAsync");

const SchoolModel = {
  create: async ({ name, email, phone, address, subscription_plan }) => {
    const sql = `
      INSERT INTO schools (name, email, phone, address, subscription_plan, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `;
    return run(sql, [name, email, phone || "", address || "", subscription_plan || "basic"]);
  },

  findByEmail: async (email) => {
    return get("SELECT * FROM schools WHERE email = ?", [email]);
  },

  findById: async (id) => {
    return get("SELECT * FROM schools WHERE id = ?", [id]);
  },

  listAll: async () => {
    return all("SELECT * FROM schools ORDER BY created_at DESC");
  },

  setActive: async (schoolId, isActive) => {
    return run("UPDATE schools SET is_active = ? WHERE id = ?", [isActive ? 1 : 0, schoolId]);
  }
};

module.exports = SchoolModel;
