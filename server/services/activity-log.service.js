const { run } = require("../../utils/dbAsync");

async function logActivity({ actorUserId, schoolId, action, details }) {
  await run(
    `
      INSERT INTO activity_logs (actor_user_id, school_id, action, details, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `,
    [
      actorUserId || null,
      schoolId || null,
      String(action || "").trim(),
      details ? JSON.stringify(details) : null
    ]
  );
}

module.exports = { logActivity };
