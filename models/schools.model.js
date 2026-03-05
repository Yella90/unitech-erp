const { run, get, all } = require("../utils/dbAsync");

const usePostgres = String(process.env.DB_CLIENT || "")
  .trim()
  .toLowerCase() === "postgres";
const { pool } = usePostgres ? require("../config/postgres") : { pool: null };

const SchoolModel = {
  create: async ({ name, email, phone, address, subscription_plan }) => {
    if (usePostgres) {
      const result = await pool.query(
        `INSERT INTO schools (name, email, phone, address, subscription_plan, is_active)
         VALUES ($1, $2, $3, $4, $5, 1)
         RETURNING id`,
        [name, email, phone || "", address || "", subscription_plan || "basic"]
      );

      return { id: result.rows[0].id };
    }

    const sql = `
      INSERT INTO schools (name, email, phone, address, subscription_plan, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `;

    const result = await run(sql, [
      name,
      email,
      phone || "",
      address || "",
      subscription_plan || "basic"
    ]);

    return { id: result.lastID };
  },

  findByEmail: async (email) => {
    if (usePostgres) {
      const result = await pool.query(
        "SELECT * FROM schools WHERE email = $1",
        [email]
      );
      return result.rows[0];
    }

    return get("SELECT * FROM schools WHERE email = ?", [email]);
  },

  findById: async (id) => {
    if (usePostgres) {
      const result = await pool.query(
        "SELECT * FROM schools WHERE id = $1",
        [id]
      );
      return result.rows[0];
    }

    return get("SELECT * FROM schools WHERE id = ?", [id]);
  },

  listAll: async () => {
    if (usePostgres) {
      const result = await pool.query(
        "SELECT * FROM schools ORDER BY created_at DESC"
      );
      return result.rows;
    }

    return all("SELECT * FROM schools ORDER BY created_at DESC");
  },

  setActive: async (schoolId, isActive) => {
    if (usePostgres) {
      return pool.query(
        "UPDATE schools SET is_active = $1 WHERE id = $2",
        [isActive ? 1 : 0, schoolId]
      );
    }

    return run(
      "UPDATE schools SET is_active = ? WHERE id = ?",
      [isActive ? 1 : 0, schoolId]
    );
  }
};

module.exports = SchoolModel;
