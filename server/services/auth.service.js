const bcrypt = require("bcryptjs");
const { get } = require("../../utils/dbAsync");
const { sign } = require("../utils/jwt.util");

async function issueToken(payload) {
  const email = String(payload.email || "").trim().toLowerCase();
  const password = String(payload.password || "");
  if (!email || !password) {
    throw new Error("email and password are required");
  }

  const user = await get(
    `
      SELECT u.id, u.school_id, u.role, u.password_hash, u.is_active, s.is_active AS school_is_active
      FROM users u
      LEFT JOIN schools s ON s.id = u.school_id
      WHERE lower(trim(u.email)) = ?
      LIMIT 1
    `,
    [email]
  );
  if (!user) throw new Error("Invalid credentials");
  if (Number(user.is_active) !== 1) throw new Error("User is disabled");
  if (user.role !== "superadmin" && Number(user.school_is_active) !== 1) throw new Error("School is disabled");

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw new Error("Invalid credentials");

  const token = sign({
    user_id: Number(user.id),
    school_id: user.school_id === null || user.school_id === undefined ? null : Number(user.school_id),
    role: user.role
  });
  return {
    token_type: "Bearer",
    access_token: token,
    expires_in: 60 * 60 * 8
  };
}

module.exports = { issueToken };

