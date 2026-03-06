require("dotenv").config();
require("../config/db");

const crypto = require("crypto");
const { run } = require("../utils/dbAsync");

async function main() {
  const schoolId = Number(process.argv[2] || 0);
  if (!schoolId) {
    throw new Error("Usage: node scripts/generate-school-api-key.js <school_id>");
  }

  const rawKey = crypto.randomBytes(24).toString("hex");
  const hash = crypto.createHash("sha256").update(rawKey).digest("hex");
  await run("UPDATE schools SET api_key_hash = ? WHERE id = ?", [hash, schoolId]);

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ school_id: schoolId, api_key: rawKey }, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err.message);
  process.exitCode = 1;
});
