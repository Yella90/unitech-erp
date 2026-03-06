const { all, get, run } = require("../../utils/dbAsync");

async function listBySchool(schoolId, includeDeleted = false) {
  const sql = includeDeleted
    ? "SELECT * FROM eleves WHERE school_id = ? ORDER BY updated_at DESC, id DESC"
    : "SELECT * FROM eleves WHERE school_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC";
  return all(sql, [schoolId]);
}

async function getByUuid(schoolId, uuid) {
  return get(
    "SELECT * FROM eleves WHERE school_id = ? AND uuid = ? LIMIT 1",
    [schoolId, uuid]
  );
}

async function create({ schoolId, payload }) {
  const now = new Date().toISOString();
  const result = await run(
    `
      INSERT INTO eleves (
        school_id, uuid, student_uuid, matricule, nom, prenom, classe, sexe, dateNaissance, telparent,
        nomParent, photo_profil, photo_acte_naissance, statut, caise, created_at, updated_at, deleted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `,
    [
      schoolId,
      payload.uuid,
      payload.student_uuid || null,
      payload.matricule,
      payload.nom,
      payload.prenom,
      payload.classe || null,
      payload.sexe || null,
      payload.dateNaissance || null,
      payload.telparent || null,
      payload.nomParent || payload.nomparent || null,
      payload.photo_profil || null,
      payload.photo_acte_naissance || null,
      payload.statut || "actif",
      Number(payload.caise || 0),
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
      UPDATE eleves
      SET matricule = COALESCE(?, matricule),
          nom = COALESCE(?, nom),
          prenom = COALESCE(?, prenom),
          classe = COALESCE(?, classe),
          sexe = COALESCE(?, sexe),
          dateNaissance = COALESCE(?, dateNaissance),
          telparent = COALESCE(?, telparent),
          nomParent = COALESCE(?, nomParent),
          statut = COALESCE(?, statut),
          caise = COALESCE(?, caise),
          updated_at = ?,
          deleted_at = COALESCE(?, deleted_at)
      WHERE school_id = ? AND uuid = ?
    `,
    [
      payload.matricule || null,
      payload.nom || null,
      payload.prenom || null,
      payload.classe || null,
      payload.sexe || null,
      payload.dateNaissance || null,
      payload.telparent || null,
      payload.nomParent || payload.nomparent || null,
      payload.statut || null,
      payload.caise !== undefined ? Number(payload.caise) : null,
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
    "UPDATE eleves SET deleted_at = ?, updated_at = ? WHERE school_id = ? AND uuid = ?",
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
