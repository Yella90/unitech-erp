const crypto = require("crypto");
const ClassesModel = require("../models/classes.model");
const SyncService = require("./sync.service");
const { pickWinnerLastWriteWins } = require("./conflict.service");
const { logActivity } = require("./activity-log.service");

async function list({ schoolId, includeDeleted }) {
  return ClassesModel.listBySchool(schoolId, includeDeleted);
}

async function create({ schoolId, payload, actorUserId, sourceDeviceId }) {
  if (!payload.nom) throw new Error("nom is required");
  const entity = {
    ...payload,
    uuid: payload.uuid || crypto.randomUUID(),
    updated_at: payload.updated_at || new Date().toISOString(),
    created_at: payload.created_at || new Date().toISOString()
  };
  await ClassesModel.create({ schoolId, payload: entity });
  await SyncService.enqueue({
    schoolId,
    tableName: "classes",
    operation: "insert",
    recordUuid: entity.uuid,
    data: entity,
    sourceDeviceId,
    version: 1
  });
  await logActivity({
    actorUserId,
    schoolId,
    action: "class_created",
    details: { uuid: entity.uuid, nom: entity.nom }
  });
  return ClassesModel.getByUuid(schoolId, entity.uuid);
}

async function update({ schoolId, uuid, payload, actorUserId, sourceDeviceId }) {
  const local = await ClassesModel.getByUuid(schoolId, uuid);
  if (!local) throw new Error("Class not found");
  const incoming = { ...payload, uuid, updated_at: payload.updated_at || new Date().toISOString() };
  const winner = pickWinnerLastWriteWins({ localRow: local, incomingRow: incoming });
  if (winner === "local") {
    return local;
  }
  const updated = await ClassesModel.updateByUuid({ schoolId, uuid, payload: incoming });
  await SyncService.enqueue({
    schoolId,
    tableName: "classes",
    operation: "update",
    recordUuid: uuid,
    data: incoming,
    sourceDeviceId,
    version: Number(local.version || 1) + 1
  });
  await logActivity({
    actorUserId,
    schoolId,
    action: "class_updated",
    details: { uuid }
  });
  return updated;
}

async function remove({ schoolId, uuid, actorUserId, sourceDeviceId }) {
  const existing = await ClassesModel.getByUuid(schoolId, uuid);
  if (!existing) throw new Error("Class not found");
  const deletedAt = new Date().toISOString();
  await ClassesModel.softDeleteByUuid(schoolId, uuid, deletedAt);
  await SyncService.enqueue({
    schoolId,
    tableName: "classes",
    operation: "delete",
    recordUuid: uuid,
    data: { uuid, deleted_at: deletedAt, updated_at: deletedAt },
    sourceDeviceId,
    version: Number(existing.version || 1) + 1
  });
  await logActivity({
    actorUserId,
    schoolId,
    action: "class_deleted",
    details: { uuid }
  });
  return { uuid, deleted_at: deletedAt };
}

module.exports = { list, create, update, remove };
