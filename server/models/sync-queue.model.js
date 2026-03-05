const { all, run } = require("../../utils/dbAsync");

async function listBySchool({ schoolId, status }) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized) {
    return all(
      "SELECT * FROM sync_queue WHERE school_id = ? AND status = ? ORDER BY id ASC LIMIT 500",
      [schoolId, normalized]
    );
  }
  return all(
    "SELECT * FROM sync_queue WHERE school_id = ? ORDER BY id ASC LIMIT 500",
    [schoolId]
  );
}

async function enqueue({
  schoolId,
  tableName,
  operation,
  recordUuid,
  data,
  sourceDeviceId,
  version
}) {
  const now = new Date().toISOString();
  const result = await run(
    `
      INSERT INTO sync_queue (
        school_id, table_name, operation, data, uuid, status, retry_count,
        source_device_id, version, created_at, updated_at, last_error
      )
      VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, NULL)
    `,
    [
      schoolId,
      tableName,
      operation,
      JSON.stringify(data || {}),
      recordUuid,
      sourceDeviceId || null,
      Number(version || 1),
      now,
      now
    ]
  );
  return { id: result.lastID };
}

async function setStatus({ queueId, schoolId, status, lastError }) {
  const now = new Date().toISOString();
  if (status === "failed") {
    await run(
      `
        UPDATE sync_queue
        SET status = ?, retry_count = retry_count + 1, updated_at = ?, last_error = ?
        WHERE id = ? AND school_id = ?
      `,
      [status, now, String(lastError || ""), queueId, schoolId]
    );
    return;
  }

  await run(
    "UPDATE sync_queue SET status = ?, updated_at = ?, last_error = NULL WHERE id = ? AND school_id = ?",
    [status, now, queueId, schoolId]
  );
}

async function markFailedStuckAsPending(maxRetry = 12) {
  const now = new Date().toISOString();
  await run(
    `
      UPDATE sync_queue
      SET status = 'pending', updated_at = ?
      WHERE status = 'failed' AND retry_count < ?
    `,
    [now, Number(maxRetry)]
  );
}

module.exports = {
  listBySchool,
  enqueue,
  setStatus,
  markFailedStuckAsPending
};
