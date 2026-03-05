const { all, get, run } = require("../../utils/dbAsync");

async function listBySchool(schoolId, includeDeleted = false) {
  const sql = includeDeleted
    ? "SELECT * FROM classes WHERE school_id = ? ORDER BY updated_at DESC, id DESC"
    : "SELECT * FROM classes WHERE school_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC";
  return all(sql, [schoolId]);
}

async function getByUuid(schoolId, uuid) {
  return get(
    "SELECT * FROM classes WHERE school_id = ? AND uuid = ? LIMIT 1",
    [schoolId, uuid]
  );
}

async function create({ schoolId, payload }) {
  const now = new Date().toISOString();
  const result = await run(
    `
      INSERT INTO classes (
        school_id, uuid, nom, cycle, niveau, annee, mensuel, frais_inscription, effectif_max,
        created_at, updated_at, deleted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `,
    [
      schoolId,
      payload.uuid,
      payload.nom,
      payload.cycle || null,
      payload.niveau || null,
      payload.annee || null,
      Number(payload.mensuel || 0),
      Number(payload.frais_inscription || 0),
      Number(payload.effectif_max || 50),
      payload.created_at || now,
      payload.updated_at || now
    ]
  );
  return { id: result.lastID };
}

async function updateByUuid({ schoolId, uuid, payload }) {
  const now = new Date().toISOString();
  await run(
    `
      UPDATE classes
      SET nom = COALESCE(?, nom),
          cycle = COALESCE(?, cycle),
          niveau = COALESCE(?, niveau),
          annee = COALESCE(?, annee),
          mensuel = COALESCE(?, mensuel),
          frais_inscription = COALESCE(?, frais_inscription),
          effectif_max = COALESCE(?, effectif_max),
          updated_at = ?,
          deleted_at = COALESCE(?, deleted_at)
      WHERE school_id = ? AND uuid = ?
    `,
    [
      payload.nom || null,
      payload.cycle || null,
      payload.niveau || null,
      payload.annee || null,
      payload.mensuel !== undefined ? Number(payload.mensuel) : null,
      payload.frais_inscription !== undefined ? Number(payload.frais_inscription) : null,
      payload.effectif_max !== undefined ? Number(payload.effectif_max) : null,
      payload.updated_at || now,
      payload.deleted_at || null,
      schoolId,
      uuid
    ]
  );
  return getByUuid(schoolId, uuid);
}

async function softDeleteByUuid(schoolId, uuid, deletedAt) {
  await run(
    "UPDATE classes SET deleted_at = ?, updated_at = ? WHERE school_id = ? AND uuid = ?",
    [deletedAt, deletedAt, schoolId, uuid]
  );
}

module.exports = {
  listBySchool,
  getByUuid,
  create,
  updateByUuid,
  softDeleteByUuid
};
