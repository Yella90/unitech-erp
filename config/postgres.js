const { Pool } = require("pg");

function parseFamily() {
  const raw = Number(process.env.PG_FAMILY || 4);
  if (raw === 4 || raw === 6) return raw;
  return 4;
}

function buildPgConfig() {
  const connectionString = process.env.DATABASE_URL || "";
  const family = parseFamily();
  const sslEnabled = String(process.env.PGSSL || "true").toLowerCase() === "true";

  if (connectionString) {
    const cfg = {
      connectionString,
      ssl: sslEnabled ? { rejectUnauthorized: false } : false
    };
    if (family) cfg.family = family;
    return cfg;
  }

  const cfg = {
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "",
    database: process.env.PGDATABASE || "unitech_erp",
    ssl: sslEnabled ? { rejectUnauthorized: false } : false
  };
  if (family) cfg.family = family;
  return cfg;
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
