const { Pool } = require("pg");

function buildPgConfig() {
  const connectionString = process.env.DATABASE_URL || "";
  if (connectionString) {
    return {
      connectionString,
      ssl: String(process.env.PGSSL || "true").toLowerCase() === "true"
        ? { rejectUnauthorized: false }
        : false
    };
  }

  return {
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "",
    database: process.env.PGDATABASE || "unitech_erp",
    ssl: String(process.env.PGSSL || "false").toLowerCase() === "true"
      ? { rejectUnauthorized: false }
      : false
  };
}

const pool = new Pool(buildPgConfig());

pool.on("error", (err) => {
  console.error("PostgreSQL pool error:", err.message);
});

module.exports = {
  pool,
  query: (text, params = []) => pool.query(text, params),
  getConfig: buildPgConfig
};
