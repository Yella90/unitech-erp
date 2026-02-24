const crypto = require("crypto");
const { all, get, run } = require("../utils/dbAsync");

function toTrimmed(value) {
  return String(value || "").trim();
}

function safeUuid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

async function logAudit(action, userId, entityType, entityId, details) {
  await run(
    `INSERT INTO audit_logs (action, user_id, entity_type, entity_id, details, timestamp)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [action, userId || null, entityType, entityId || null, details ? JSON.stringify(details) : null]
  );
}

async function createSchoolNotification(schoolId, payload = {}) {
  const type = toTrimmed(payload.type) || "system";
  const title = toTrimmed(payload.title) || "Notification";
  const message = toTrimmed(payload.message) || "";
  if (!message) return;

  const uniqueKey = toTrimmed(payload.uniqueKey) || null;
  await run(
    `INSERT OR IGNORE INTO notifications (
       school_id, type, title, message, entity_type, entity_id, entity_ref, metadata, created_at, unique_key
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
    [
      Number(schoolId),
      type,
      title,
      message,
      toTrimmed(payload.entityType) || null,
      Number.isFinite(Number(payload.entityId)) ? Number(payload.entityId) : null,
      toTrimmed(payload.entityRef) || null,
      payload.metadata ? JSON.stringify(payload.metadata) : null,
      uniqueKey
    ]
  );
}

async function findClasseIdByName(schoolId, className) {
  const name = toTrimmed(className);
  if (!name) return null;
  const exact = await get(
    "SELECT id FROM classes WHERE school_id = ? AND lower(trim(nom)) = lower(trim(?)) LIMIT 1",
    [schoolId, name]
  );
  if (exact) return Number(exact.id);

  const token = name.toLowerCase();
  const byPrefix = await get(
    `SELECT id
     FROM classes
     WHERE school_id = ?
       AND lower(trim(nom)) LIKE ?
     ORDER BY length(trim(nom)) ASC, id ASC
     LIMIT 1`,
    [schoolId, `${token}%`]
  );
  if (byPrefix) return Number(byPrefix.id);

  const byContains = await get(
    `SELECT id
     FROM classes
     WHERE school_id = ?
       AND lower(trim(nom)) LIKE ?
     ORDER BY length(trim(nom)) ASC, id ASC
     LIMIT 1`,
    [schoolId, `%${token}%`]
  );
  return byContains ? Number(byContains.id) : null;
}

async function buildUniqueMatriculeForSchool(schoolId, baseMatricule) {
  const base = toTrimmed(baseMatricule).replace(/[^a-zA-Z0-9]/g, "") || `EL${Date.now()}`;
  const firstTry = base.toUpperCase();
  const exists = await get(
    "SELECT id FROM eleves WHERE school_id = ? AND matricule = ? LIMIT 1",
    [schoolId, firstTry]
  );
  if (!exists) return firstTry;

  for (let i = 1; i <= 9999; i += 1) {
    const candidate = `${firstTry}T${String(i).padStart(2, "0")}`;
    // eslint-disable-next-line no-await-in-loop
    const conflict = await get(
      "SELECT id FROM eleves WHERE school_id = ? AND matricule = ? LIMIT 1",
      [schoolId, candidate]
    );
    if (!conflict) return candidate;
  }
  return `${firstTry}${Date.now()}`;
}

async function getOrCreateStudentFromEleve(schoolId, matricule) {
  const eleve = await get(
    "SELECT * FROM eleves WHERE school_id = ? AND matricule = ? LIMIT 1",
    [schoolId, toTrimmed(matricule)]
  );
  if (!eleve) {
    throw new Error("Eleve introuvable dans cette ecole");
  }

  let studentUuid = toTrimmed(eleve.student_uuid);
  if (!studentUuid) {
    studentUuid = safeUuid();
    await run(
      "UPDATE eleves SET student_uuid = ? WHERE school_id = ? AND matricule = ?",
      [studentUuid, schoolId, eleve.matricule]
    );
    eleve.student_uuid = studentUuid;
  }

  let student = await get("SELECT * FROM students WHERE uuid = ? LIMIT 1", [studentUuid]);
  if (!student) {
    const result = await run(
      `INSERT INTO students (uuid, nom, prenom, date_naissance, sexe, created_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [studentUuid, eleve.nom, eleve.prenom, eleve.dateNaissance || null, eleve.sexe || null]
    );
    student = await get("SELECT * FROM students WHERE id = ?", [result.lastID]);
  } else {
    await run(
      `UPDATE students
       SET nom = ?, prenom = ?, date_naissance = ?, sexe = ?
       WHERE id = ?`,
      [eleve.nom, eleve.prenom, eleve.dateNaissance || null, eleve.sexe || null, student.id]
    );
    student = await get("SELECT * FROM students WHERE id = ?", [student.id]);
  }

  let enrollment = await get(
    `SELECT *
     FROM enrollments
     WHERE student_id = ? AND ecole_id = ? AND statut = 'actif'
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [student.id, schoolId]
  );

  const classeId = await findClasseIdByName(schoolId, eleve.classe);
  if (!enrollment) {
    const created = await run(
      `INSERT INTO enrollments (student_id, ecole_id, classe_id, date_entree, statut, created_at)
       VALUES (?, ?, ?, date('now'), 'actif', CURRENT_TIMESTAMP)`,
      [student.id, schoolId, classeId]
    );
    enrollment = await get("SELECT * FROM enrollments WHERE id = ?", [created.lastID]);
  } else if (classeId && Number(enrollment.classe_id || 0) !== Number(classeId)) {
    await run(
      "UPDATE enrollments SET classe_id = ? WHERE id = ?",
      [classeId, enrollment.id]
    );
    enrollment = { ...enrollment, classe_id: classeId };
  }

  return { eleve, student, enrollment };
}

async function getOrCreateActiveEnrollmentByMatricule(schoolId, matricule) {
  const context = await getOrCreateStudentFromEleve(schoolId, matricule);
  if (!context.enrollment || context.enrollment.statut !== "actif") {
    throw new Error("Aucune inscription active pour cet eleve");
  }
  return context;
}

async function ensureNoteMutable(schoolId, noteId) {
  const note = await get(
    `SELECT n.id, n.school_id, n.eleve_matricule, n.enrollment_id, en.statut AS enrollment_statut
     FROM notes n
     LEFT JOIN enrollments en ON en.id = n.enrollment_id
     WHERE n.school_id = ? AND n.id = ?`,
    [schoolId, Number(noteId)]
  );
  if (!note) {
    throw new Error("Note introuvable");
  }

  if (note.enrollment_id && String(note.enrollment_statut || "").toLowerCase() !== "actif") {
    throw new Error("Notes historiques en lecture seule (inscription non active)");
  }

  if (!note.enrollment_id) {
    const context = await getOrCreateActiveEnrollmentByMatricule(schoolId, note.eleve_matricule);
    await run("UPDATE notes SET enrollment_id = ? WHERE id = ?", [context.enrollment.id, note.id]);
  }

  return note;
}

const TransfersService = {
  listTargetSchools: async (sourceSchoolId) => {
    return all(
      `SELECT id, name
       FROM schools
       WHERE is_active = 1 AND id <> ?
       ORDER BY name ASC`,
      [sourceSchoolId]
    );
  },

  getOrCreateActiveEnrollmentByMatricule,
  ensureNoteMutable,

  requestTransfer: async ({ sourceSchoolId, toSchoolId, matricule, requestedBy }) => {
    const targetSchoolId = Number(toSchoolId);
    if (!Number.isFinite(targetSchoolId) || targetSchoolId <= 0) {
      throw new Error("Ecole cible invalide");
    }
    if (Number(sourceSchoolId) === targetSchoolId) {
      throw new Error("Le transfert vers la meme ecole est impossible");
    }

    const targetSchool = await get("SELECT id, name FROM schools WHERE id = ? LIMIT 1", [targetSchoolId]);
    if (!targetSchool) {
      throw new Error("Ecole cible introuvable");
    }

    const context = await getOrCreateActiveEnrollmentByMatricule(sourceSchoolId, matricule);
    const pending = await get(
      `SELECT id
       FROM transfers
       WHERE student_id = ? AND status = 'pending'
       ORDER BY date_request DESC, id DESC
       LIMIT 1`,
      [context.student.id]
    );
    if (pending) {
      throw new Error("Une demande de transfert en attente existe deja pour cet eleve");
    }

    const created = await run(
      `INSERT INTO transfers (
         student_id, from_ecole_id, to_ecole_id, requested_by, status, date_request, created_at
       ) VALUES (?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [context.student.id, sourceSchoolId, targetSchoolId, requestedBy]
    );

    await logAudit("transfer_requested", requestedBy, "transfer", created.lastID, {
      student_id: context.student.id,
      from_ecole_id: sourceSchoolId,
      to_ecole_id: targetSchoolId,
      matricule: context.eleve.matricule
    });
    await createSchoolNotification(targetSchoolId, {
      type: "transfer_requested",
      title: "Nouvelle demande de transfert",
      message: `Transfert demande pour ${context.student.nom} ${context.student.prenom} depuis votre ecole partenaire.`,
      entityType: "transfer",
      entityId: created.lastID,
      entityRef: context.eleve.matricule,
      uniqueKey: `transfer-request-target-${created.lastID}`
    });
    await createSchoolNotification(sourceSchoolId, {
      type: "transfer_requested",
      title: "Demande de transfert envoyee",
      message: `Votre demande de transfert pour ${context.student.nom} ${context.student.prenom} a ete envoyee.`,
      entityType: "transfer",
      entityId: created.lastID,
      entityRef: context.eleve.matricule,
      uniqueKey: `transfer-request-source-${created.lastID}`
    });

    return { transferId: created.lastID };
  },

  listIncomingTransfers: async ({ schoolId, status }) => {
    const normalized = toTrimmed(status).toLowerCase();
    const params = [schoolId];
    let statusClause = "";
    if (normalized && ["pending", "accepted", "rejected"].includes(normalized)) {
      statusClause = " AND t.status = ? ";
      params.push(normalized);
    }

    return all(
      `
      SELECT
        t.*,
        s.nom,
        s.prenom,
        from_sc.name AS from_school_name,
        to_sc.name AS to_school_name,
        req.full_name AS requested_by_name,
        resp.full_name AS response_by_name
      FROM transfers t
      JOIN students s ON s.id = t.student_id
      JOIN schools from_sc ON from_sc.id = t.from_ecole_id
      JOIN schools to_sc ON to_sc.id = t.to_ecole_id
      LEFT JOIN users req ON req.id = t.requested_by
      LEFT JOIN users resp ON resp.id = t.response_by
      WHERE t.to_ecole_id = ?
      ${statusClause}
      ORDER BY t.date_request DESC, t.id DESC
      `,
      params
    );
  },

  getTransferDetailForSchool: async ({ schoolId, transferId }) => {
    const transfer = await get(
      `
      SELECT
        t.*,
        s.uuid AS student_uuid,
        s.nom,
        s.prenom,
        s.date_naissance,
        s.sexe,
        from_sc.name AS from_school_name,
        to_sc.name AS to_school_name,
        req.full_name AS requested_by_name,
        resp.full_name AS response_by_name
      FROM transfers t
      JOIN students s ON s.id = t.student_id
      JOIN schools from_sc ON from_sc.id = t.from_ecole_id
      JOIN schools to_sc ON to_sc.id = t.to_ecole_id
      LEFT JOIN users req ON req.id = t.requested_by
      LEFT JOIN users resp ON resp.id = t.response_by
      WHERE t.id = ?
        AND (t.from_ecole_id = ? OR t.to_ecole_id = ?)
      LIMIT 1
      `,
      [Number(transferId), schoolId, schoolId]
    );
    if (!transfer) {
      throw new Error("Transfert introuvable");
    }

    let sourceClassName = null;
    let targetClassName = null;
    let targetClassFrais = 0;

    const sourceEnrollment = await get(
      `SELECT en.classe_id
       FROM enrollments en
       WHERE en.student_id = ? AND en.ecole_id = ?
       ORDER BY CASE en.statut WHEN 'actif' THEN 0 ELSE 1 END ASC, en.created_at DESC, en.id DESC
       LIMIT 1`,
      [transfer.student_id, transfer.from_ecole_id]
    );
    if (sourceEnrollment && sourceEnrollment.classe_id) {
      const sourceClass = await get("SELECT nom FROM classes WHERE id = ?", [sourceEnrollment.classe_id]);
      sourceClassName = sourceClass ? sourceClass.nom : null;
    }
    if (!sourceClassName && transfer.student_uuid) {
      const sourceEleve = await get(
        `SELECT classe
         FROM eleves
         WHERE school_id = ? AND student_uuid = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [transfer.from_ecole_id, transfer.student_uuid]
      );
      sourceClassName = sourceEleve ? toTrimmed(sourceEleve.classe) || null : null;
    }

    if (sourceClassName) {
      const targetClassId = await findClasseIdByName(transfer.to_ecole_id, sourceClassName);
      const targetClass = targetClassId
        ? await get(
          `SELECT id, nom, COALESCE(frais_inscription, 0) AS frais_inscription
           FROM classes
           WHERE id = ?
           LIMIT 1`,
          [targetClassId]
        )
        : null;
      if (targetClass) {
        targetClassName = targetClass.nom;
        targetClassFrais = Number(targetClass.frais_inscription || 0);
      }
    }

    return {
      ...transfer,
      source_class_name: sourceClassName,
      target_class_name: targetClassName,
      estimated_frais_inscription: Math.max(targetClassFrais, 0)
    };
  },

  acceptTransfer: async ({ transferId, schoolId, responseBy }) => {
    await run("BEGIN IMMEDIATE TRANSACTION");
    try {
      const transfer = await get(
        "SELECT * FROM transfers WHERE id = ? LIMIT 1",
        [Number(transferId)]
      );
      if (!transfer) throw new Error("Transfert introuvable");
      if (transfer.status !== "pending") throw new Error("Transfert deja traite");
      if (Number(transfer.to_ecole_id) !== Number(schoolId)) {
        throw new Error("Transfert non autorise pour cette ecole");
      }

      const currentEnrollment = await get(
        `SELECT *
         FROM enrollments
         WHERE student_id = ? AND ecole_id = ? AND statut = 'actif'
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [transfer.student_id, transfer.from_ecole_id]
      );
      if (!currentEnrollment) {
        throw new Error("Inscription active source introuvable");
      }

      const student = await get("SELECT * FROM students WHERE id = ? LIMIT 1", [transfer.student_id]);
      const sourceEleve = await get(
        `SELECT * FROM eleves
         WHERE school_id = ? AND student_uuid = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [transfer.from_ecole_id, student.uuid]
      );

      await run(
        `UPDATE enrollments
         SET statut = 'transfere', date_sortie = datetime('now')
         WHERE id = ?`,
        [currentEnrollment.id]
      );

      const fromClass = currentEnrollment.classe_id
        ? await get("SELECT nom FROM classes WHERE id = ?", [currentEnrollment.classe_id])
        : null;
      const sourceClassName = toTrimmed(fromClass ? fromClass.nom : "") || toTrimmed(sourceEleve ? sourceEleve.classe : "");
      const targetClassId = sourceClassName
        ? await findClasseIdByName(transfer.to_ecole_id, sourceClassName)
        : null;
      const targetClassRow = targetClassId
        ? await get(
          "SELECT id, nom, annee, COALESCE(frais_inscription, 0) AS frais_inscription FROM classes WHERE id = ?",
          [targetClassId]
        )
        : null;
      const fraisInscription = Number(targetClassRow ? targetClassRow.frais_inscription : 0);

      const createdEnrollment = await run(
        `INSERT INTO enrollments (student_id, ecole_id, classe_id, date_entree, statut, created_at)
         VALUES (?, ?, ?, date('now'), 'actif', CURRENT_TIMESTAMP)`,
        [transfer.student_id, transfer.to_ecole_id, targetClassId]
      );

      await run(
        `UPDATE transfers
         SET status = 'accepted',
             date_response = CURRENT_TIMESTAMP,
             response_by = ?
         WHERE id = ?`,
        [responseBy, transfer.id]
      );

      if (sourceEleve) {
        await run(
          "UPDATE eleves SET statut = 'transfere' WHERE school_id = ? AND student_uuid = ?",
          [transfer.from_ecole_id, student.uuid]
        );
      }
      if (currentEnrollment.classe_id) {
        await run(
          "UPDATE classes SET effectif = MAX(COALESCE(effectif, 0) - 1, 0) WHERE id = ?",
          [currentEnrollment.classe_id]
        );
      }

      const targetClassName = targetClassId
        ? await get("SELECT nom FROM classes WHERE id = ?", [targetClassId])
        : null;

      const existingTarget = await get(
        "SELECT id FROM eleves WHERE school_id = ? AND student_uuid = ? LIMIT 1",
        [transfer.to_ecole_id, student.uuid]
      );
      if (existingTarget) {
        await run(
          `UPDATE eleves
           SET nom = ?, prenom = ?, dateNaissance = ?, sexe = ?, classe = ?, statut = 'actif',
               caise = COALESCE(caise, 0) + ?
           WHERE id = ?`,
          [
            student.nom,
            student.prenom,
            student.date_naissance || null,
            student.sexe || null,
            targetClassName ? targetClassName.nom : null,
            Math.max(fraisInscription, 0),
            existingTarget.id
          ]
        );
      } else {
        const matricule = await buildUniqueMatriculeForSchool(
          transfer.to_ecole_id,
          sourceEleve && sourceEleve.matricule ? sourceEleve.matricule : `${student.nom}${student.prenom}`
        );
        await run(
          `INSERT INTO eleves (
             school_id, student_uuid, matricule, nom, prenom, classe, sexe, dateNaissance, statut, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'actif', CURRENT_TIMESTAMP)`,
          [
            transfer.to_ecole_id,
            student.uuid,
            matricule,
            student.nom,
            student.prenom,
            targetClassName ? targetClassName.nom : null,
            student.sexe || null,
            student.date_naissance || null
          ]
        );
        await run(
          "UPDATE eleves SET caise = ? WHERE school_id = ? AND student_uuid = ?",
          [Math.max(fraisInscription, 0), transfer.to_ecole_id, student.uuid]
        );
      }

      if (targetClassId) {
        await run(
          `UPDATE classes
           SET effectif = COALESCE(effectif, 0) + 1,
               totalpaie = COALESCE(totalpaie, 0) + ?
           WHERE id = ?`,
          [Math.max(fraisInscription, 0), targetClassId]
        );
      }

      if (fraisInscription > 0) {
        const targetEleve = await get(
          "SELECT matricule FROM eleves WHERE school_id = ? AND student_uuid = ? LIMIT 1",
          [transfer.to_ecole_id, student.uuid]
        );
        if (targetEleve && targetEleve.matricule) {
          await run(
            `INSERT INTO paiements (
               school_id, eleve_matricule, montant, mois, date_payement, mode_payement, annee_scolaire
             ) VALUES (?, ?, ?, 'inscription', date('now'), 'frais_inscription_transfert_auto', ?)`,
            [
              transfer.to_ecole_id,
              targetEleve.matricule,
              fraisInscription,
              targetClassRow && targetClassRow.annee ? targetClassRow.annee : null
            ]
          );
        }
      }

      await logAudit("transfer_accepted", responseBy, "transfer", transfer.id, {
        student_id: transfer.student_id,
        from_ecole_id: transfer.from_ecole_id,
        to_ecole_id: transfer.to_ecole_id,
        from_enrollment_id: currentEnrollment.id,
        to_enrollment_id: createdEnrollment.lastID,
        frais_inscription_applique: Math.max(fraisInscription, 0)
      });
      await createSchoolNotification(transfer.from_ecole_id, {
        type: "transfer_accepted",
        title: "Transfert accepte",
        message: `Le transfert de ${student.nom} ${student.prenom} a ete accepte par l'etablissement cible.`,
        entityType: "transfer",
        entityId: transfer.id,
        entityRef: student.uuid,
        uniqueKey: `transfer-accepted-from-${transfer.id}`
      });
      await createSchoolNotification(transfer.to_ecole_id, {
        type: "transfer_accepted",
        title: "Transfert valide",
        message: `Transfert de ${student.nom} ${student.prenom} accepte. Frais d'inscription applique: ${Math.max(fraisInscription, 0)} FCFA.`,
        entityType: "transfer",
        entityId: transfer.id,
        entityRef: student.uuid,
        uniqueKey: `transfer-accepted-to-${transfer.id}`
      });

      await run("COMMIT");
      return { transferId: transfer.id };
    } catch (err) {
      await run("ROLLBACK");
      throw err;
    }
  },

  rejectTransfer: async ({ transferId, schoolId, responseBy }) => {
    const transfer = await get("SELECT * FROM transfers WHERE id = ? LIMIT 1", [Number(transferId)]);
    if (!transfer) throw new Error("Transfert introuvable");
    if (transfer.status !== "pending") throw new Error("Transfert deja traite");
    if (Number(transfer.to_ecole_id) !== Number(schoolId)) {
      throw new Error("Transfert non autorise pour cette ecole");
    }

    await run(
      `UPDATE transfers
       SET status = 'rejected',
           date_response = CURRENT_TIMESTAMP,
           response_by = ?
       WHERE id = ?`,
      [responseBy, transfer.id]
    );

    await logAudit("transfer_rejected", responseBy, "transfer", transfer.id, {
      student_id: transfer.student_id,
      from_ecole_id: transfer.from_ecole_id,
      to_ecole_id: transfer.to_ecole_id
    });
    const student = await get("SELECT nom, prenom, uuid FROM students WHERE id = ? LIMIT 1", [transfer.student_id]);
    await createSchoolNotification(transfer.from_ecole_id, {
      type: "transfer_rejected",
      title: "Transfert refuse",
      message: `Le transfert de ${student ? `${student.nom} ${student.prenom}` : "l'eleve"} a ete refuse par l'etablissement cible.`,
      entityType: "transfer",
      entityId: transfer.id,
      entityRef: student ? student.uuid : null,
      uniqueKey: `transfer-rejected-from-${transfer.id}`
    });
    await createSchoolNotification(transfer.to_ecole_id, {
      type: "transfer_rejected",
      title: "Demande de transfert refusee",
      message: `Vous avez refuse cette demande de transfert.`,
      entityType: "transfer",
      entityId: transfer.id,
      entityRef: student ? student.uuid : null,
      uniqueKey: `transfer-rejected-to-${transfer.id}`
    });

    return { transferId: transfer.id };
  },

  getStudentHistoryForSchool: async ({ schoolId, studentId }) => {
    const student = await get("SELECT * FROM students WHERE id = ? LIMIT 1", [Number(studentId)]);
    if (!student) throw new Error("Eleve global introuvable");

    const hasAccess = await get(
      "SELECT id FROM enrollments WHERE student_id = ? AND ecole_id = ? LIMIT 1",
      [student.id, schoolId]
    );
    if (!hasAccess) {
      throw new Error("Acces non autorise a cet historique");
    }

    const enrollments = await all(
      `
      SELECT
        en.*,
        sc.name AS ecole_name,
        c.nom AS classe_name
      FROM enrollments en
      JOIN schools sc ON sc.id = en.ecole_id
      LEFT JOIN classes c ON c.id = en.classe_id
      WHERE en.student_id = ?
      ORDER BY en.created_at ASC, en.id ASC
      `,
      [student.id]
    );

    const rows = await all(
      `
      SELECT
        g.id,
        g.enrollment_id,
        g.trimestre,
        g.note,
        COALESCE(g.school_year, '') AS school_year,
        m.nom AS matiere_name,
        m.coefficient
      FROM grades g
      LEFT JOIN matieres m ON m.id = g.matiere_id
      WHERE g.enrollment_id IN (
        SELECT id FROM enrollments WHERE student_id = ?
      )
      ORDER BY g.created_at ASC, g.id ASC
      `,
      [student.id]
    );

    const gradesByEnrollment = new Map();
    (rows || []).forEach((row) => {
      const key = Number(row.enrollment_id);
      if (!gradesByEnrollment.has(key)) gradesByEnrollment.set(key, []);
      gradesByEnrollment.get(key).push(row);
    });

    const enrollmentsWithGrades = (enrollments || []).map((en) => {
      const notes = gradesByEnrollment.get(Number(en.id)) || [];
      const yearBuckets = {};
      notes.forEach((n) => {
        const yearKey = toTrimmed(n.school_year) || "N/A";
        if (!yearBuckets[yearKey]) {
          yearBuckets[yearKey] = { school_year: yearKey, count: 0, sum: 0 };
        }
        yearBuckets[yearKey].count += 1;
        yearBuckets[yearKey].sum += Number(n.note || 0);
      });
      const yearlyAverages = Object.values(yearBuckets).map((item) => ({
        school_year: item.school_year,
        moyenne_annuelle: item.count ? Number((item.sum / item.count).toFixed(2)) : 0
      }));

      return {
        ...en,
        notes,
        yearlyAverages,
        readonly: true
      };
    });

    return {
      student,
      enrollments: enrollmentsWithGrades
    };
  }
};

module.exports = TransfersService;
