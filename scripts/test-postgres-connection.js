require("dotenv").config();

const { pool, query, getConfig } = require("../config/postgres");

async function main() {
  try {
    const cfg = getConfig();
    const result = await query("SELECT NOW() AS now, current_database() AS db, current_user AS user");
    const row = result.rows && result.rows[0] ? result.rows[0] : {};
    const parsedUrl = cfg.connectionString ? new URL(cfg.connectionString) : null;
    const host = cfg.host || (parsedUrl ? parsedUrl.hostname : undefined);
    const port = cfg.port || (parsedUrl ? parsedUrl.port : undefined);
    const database = cfg.database || (parsedUrl ? String(parsedUrl.pathname || "").replace(/^\//, "") : undefined);
    const user = cfg.user || (parsedUrl ? decodeURIComponent(parsedUrl.username || "") : undefined);

    console.log("PostgreSQL connected");
    console.log(`host=${host} port=${port} db=${row.db || database} user=${row.user || user}`);
    console.log(`server_time=${row.now || "-"}`);
  } catch (err) {
    console.error("PostgreSQL connection failed:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
