const AuthService = require("../services/auth.service");

exports.issueToken = async (req, res) => {
  try {
    const result = await AuthService.issueToken(req.body || {});
    return res.json(result);
  } catch (err) {
    return res.status(401).json({ error: err.message || "Authentication failed" });
  }
};
