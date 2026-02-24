require("dotenv").config();

const { pool, query, getConfig } = require("../config/postgres");

async function main() {
  try {
    const cfg = getConfig();
    const result = await query("SELECT NOW() AS now, current_database() AS db, current_user AS user");
    const row = result.rows && result.rows[0] ? result.rows[0] : {};

    console.log("PostgreSQL connected");
    console.log(`host=${cfg.host} port=${cfg.port} db=${row.db || cfg.database} user=${row.user || cfg.user}`);
    console.log(`server_time=${row.now || "-"}`);
  } catch (err) {
    console.error("PostgreSQL connection failed:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
