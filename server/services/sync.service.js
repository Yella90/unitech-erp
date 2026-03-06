const SyncQueueModel = require("../models/sync-queue.model");

const allowedOps = new Set(["insert", "update", "delete"]);

async function listQueue({ schoolId, status }) {
  return SyncQueueModel.listBySchool({ schoolId, status });
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
  const normalizedTable = String(tableName || "").trim().toLowerCase();
  const normalizedOp = String(operation || "").trim().toLowerCase();
  if (!normalizedTable) throw new Error("table_name is required");
  if (!allowedOps.has(normalizedOp)) throw new Error("operation must be insert|update|delete");
  if (!recordUuid) throw new Error("uuid is required");
  return SyncQueueModel.enqueue({
    schoolId,
    tableName: normalizedTable,
    operation: normalizedOp,
    recordUuid,
    data: data || {},
    sourceDeviceId: sourceDeviceId || null,
    version: Number(version || 1)
  });
}

async function acknowledge({ schoolId, queueId, status }) {
  const normalizedStatus = String(status || "synced").trim().toLowerCase();
  if (!["synced", "failed", "pending"].includes(normalizedStatus)) {
    throw new Error("status must be synced|failed|pending");
  }
  await SyncQueueModel.setStatus({
    queueId,
    schoolId,
    status: normalizedStatus,
    lastError: normalizedStatus === "failed" ? "Sync ack marked as failed" : null
  });
  return { id: queueId, status: normalizedStatus };
}

module.exports = {
  listQueue,
  enqueue,
  acknowledge
};
