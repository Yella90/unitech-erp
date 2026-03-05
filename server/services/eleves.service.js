const crypto = require("crypto");
const ElevesModel = require("../models/eleves.model");
const SyncService = require("./sync.service");
const { pickWinnerLastWriteWins } = require("./conflict.service");
const { logActivity } = require("./activity-log.service");

async function list({ schoolId, includeDeleted }) {
  return ElevesModel.listBySchool(schoolId, includeDeleted);
}

async function create({ schoolId, payload, actorUserId, sourceDeviceId }) {
  if (!payload.matricule || !payload.nom || !payload.prenom) {
    throw new Error("matricule, nom and prenom are required");
  }
  const entity = {
    ...payload,
    uuid: payload.uuid || crypto.randomUUID(),
    updated_at: payload.updated_at || new Date().toISOString(),
    created_at: payload.created_at || new Date().toISOString()
  };
  await ElevesModel.create({ schoolId, payload: entity });
  await SyncService.enqueue({
    schoolId,
    tableName: "eleves",
    operation: "insert",
    recordUuid: entity.uuid,
    data: entity,
    sourceDeviceId,
    version: 1
  });
  await logActivity({
    actorUserId,
    schoolId,
    action: "student_created",
    details: { uuid: entity.uuid, matricule: entity.matricule }
  });
  return ElevesModel.getByUuid(schoolId, entity.uuid);
}

async function update({ schoolId, uuid, payload, actorUserId, sourceDeviceId }) {
  const local = await ElevesModel.getByUuid(schoolId, uuid);
  if (!local) throw new Error("Student not found");
  const incoming = { ...payload, uuid, updated_at: payload.updated_at || new Date().toISOString() };
  const winner = pickWinnerLastWriteWins({ localRow: local, incomingRow: incoming });
  if (winner === "local") {
    return local;
  }
  const updated = await ElevesModel.updateByUuid({ schoolId, uuid, payload: incoming });
  await SyncService.enqueue({
    schoolId,
    tableName: "eleves",
    operation: "update",
    recordUuid: uuid,
    data: incoming,
    sourceDeviceId,
    version: Number(local.version || 1) + 1
  });
  await logActivity({
    actorUserId,
    schoolId,
    action: "student_updated",
    details: { uuid }
  });
  return updated;
}

async function remove({ schoolId, uuid, actorUserId, sourceDeviceId }) {
  const existing = await ElevesModel.getByUuid(schoolId, uuid);
  if (!existing) throw new Error("Student not found");
  const deletedAt = new Date().toISOString();
  await ElevesModel.softDeleteByUuid(schoolId, uuid, deletedAt);
  await SyncService.enqueue({
    schoolId,
    tableName: "eleves",
    operation: "delete",
    recordUuid: uuid,
    data: { uuid, deleted_at: deletedAt, updated_at: deletedAt },
    sourceDeviceId,
    version: Number(existing.version || 1) + 1
  });
  await logActivity({
    actorUserId,
    schoolId,
    action: "student_deleted",
    details: { uuid }
  });
  return { uuid, deleted_at: deletedAt };
}

module.exports = { list, create, update, remove };
