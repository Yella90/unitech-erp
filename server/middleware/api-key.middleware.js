const { get } = require("../../utils/dbAsync");
const { sha256, safeEqualHex } = require("../utils/hash.util");

async function requireSchoolApiKey(req, res, next) {
  if (req.apiUser && req.apiUser.role === "superadmin") {
    return next();
  }

  const schoolId = Number(req.apiSchoolId || 0);
  if (!schoolId) return res.status(400).json({ error: "Invalid school context" });

  const providedKey = String(req.headers["x-school-key"] || "").trim();
  if (!providedKey) {
    return res.status(401).json({ error: "x-school-key is required" });
  }

  try {
    const row = await get("SELECT api_key_hash FROM schools WHERE id = ?", [schoolId]);
    if (!row || !row.api_key_hash) {
      return res.status(401).json({ error: "School API key is not configured" });
    }
    const providedHash = sha256(providedKey);
    if (!safeEqualHex(row.api_key_hash, providedHash)) {
      return res.status(401).json({ error: "Invalid school API key" });
    }
    return next();
  } catch (err) {
    return res.status(500).json({ error: err.message || "API key validation failed" });
  }
}

module.exports = { requireSchoolApiKey };
