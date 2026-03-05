const { verify } = require("../utils/jwt.util");

function readBearerToken(req) {
  const raw = String(req.headers.authorization || "");
  if (!raw.toLowerCase().startsWith("bearer ")) return null;
  return raw.slice(7).trim();
}

function requireApiAuth(req, res, next) {
  if (req.session && req.session.user && req.session.user.id) {
    req.apiUser = {
      id: Number(req.session.user.id),
      school_id: req.session.user.school_id ? Number(req.session.user.school_id) : null,
      role: req.session.user.role
    };
    return next();
  }

  const token = readBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Missing bearer token" });
  }

  try {
    const payload = verify(token);
    req.apiUser = {
      id: Number(payload.user_id),
      school_id: payload.school_id !== null && payload.school_id !== undefined ? Number(payload.school_id) : null,
      role: String(payload.role || "").trim()
    };
    return next();
  } catch (err) {
    return res.status(401).json({ error: err.message || "Invalid token" });
  }
}

function requireApiSchoolContext(req, res, next) {
  if (!req.apiUser) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (!req.apiUser.school_id && req.apiUser.role !== "superadmin") {
    return res.status(403).json({ error: "No school context found" });
  }

  if (req.apiUser.role === "superadmin") {
    const fromHeader = req.headers["x-school-id"];
    if (!fromHeader) return res.status(400).json({ error: "x-school-id is required for superadmin API calls" });
    req.apiSchoolId = Number(fromHeader);
    return next();
  }

  req.apiSchoolId = Number(req.apiUser.school_id);
  return next();
}

module.exports = { requireApiAuth, requireApiSchoolContext };
