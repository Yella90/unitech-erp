const db = require("../config/db");

function alphaSuffixFromIndex(index) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function rootClassName(name) {
  const raw = String(name || "").trim();
  const match = raw.match(/^(.*)\s+([A-Z]{1,3})$/);
  if (!match) return raw;
  return match[1].trim();
}

function nextSuffixedClassName(baseName, existingNames) {
  const used = new Set((existingNames || []).map((n) => String(n || "").trim().toLowerCase()));
  const base = rootClassName(baseName);
  for (let i = 0; i < 2000; i += 1) {
    const candidate = `${base} ${alphaSuffixFromIndex(i)}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} X`;
}

const EleveModel = {
  getAllBySchool: (schoolId, callback) => {
    const sql = `
      SELECT e.*,
             (SELECT s.id FROM students s WHERE s.uuid = e.student_uuid LIMIT 1) AS student_id
      FROM eleves e
      WHERE e.school_id = ?
      ORDER BY e.created_at DESC
    `;
    db.all(sql, [schoolId], (err, rows) => callback(err, rows));
  },

  getAllBySchoolAndMatricule: (schoolId, matricule, callback) => {
    const sql = `
      SELECT e.*,
             (SELECT s.id FROM students s WHERE s.uuid = e.student_uuid LIMIT 1) AS student_id
      FROM eleves e
      WHERE e.school_id = ? AND e.matricule LIKE ?
      ORDER BY e.created_at DESC
    `;
    db.all(sql, [schoolId, `%${matricule}%`], (err, rows) => callback(err, rows));
  },

  getAllBySchoolWithFilters: (schoolId, filters, callback) => {
    const matricule = String((filters && filters.matricule) || "").trim();
    const classe = String((filters && filters.classe) || "").trim();
    const params = [schoolId];
    let sql = `
      SELECT e.*,
             (SELECT s.id FROM students s WHERE s.uuid = e.student_uuid LIMIT 1) AS student_id
      FROM eleves e
      WHERE e.school_id = ?
    `;

    if (matricule) {
      sql += " AND e.matricule LIKE ? ";
      params.push(`%${matricule}%`);
    }
    if (classe) {
      sql += " AND e.classe = ? ";
      params.push(classe);
    }
    sql += " ORDER BY e.created_at DESC";

    db.all(sql, params, (err, rows) => callback(err, rows));
  },

  getByClassOrdered: (schoolId, classe, callback) => {
    const sql = `
      SELECT e.matricule, e.nom, e.prenom, e.classe,
             (SELECT s.id FROM students s WHERE s.uuid = e.student_uuid LIMIT 1) AS student_id
      FROM eleves e
      WHERE e.school_id = ? AND e.classe = ?
      ORDER BY nom ASC, prenom ASC
    `;
    db.all(sql, [schoolId, classe], (err, rows) => callback(err, rows));
  },

  getNotesByClasseAndMatiere: (schoolId, filters, callback) => {
    const classe = String((filters && filters.classe) || "").trim();
    const matiere = String((filters && filters.matiere) || "").trim();
    const annee = String((filters && filters.annee) || "").trim();
    const params = [matiere, schoolId, classe];
    let sql = `
      SELECT
        e.matricule,
        e.nom,
        e.prenom,
        ROUND(AVG(n.note), 2) AS note
      FROM eleves e
      LEFT JOIN notes n
        ON n.school_id = e.school_id
       AND n.eleve_matricule = e.matricule
       AND lower(trim(n.matiere)) = lower(trim(?))
    `;

    if (annee) {
      sql += " AND COALESCE(n.annee, '') = ? ";
      params.push(annee);
    }

    sql += `
      WHERE e.school_id = ?
        AND e.classe = ?
      GROUP BY e.matricule, e.nom, e.prenom
      ORDER BY e.nom ASC, e.prenom ASC
    `;

    db.all(sql, params, (err, rows) => callback(err, rows));
  },

  countBySchool: (schoolId, callback) => {
    db.get("SELECT COUNT(*) AS total FROM eleves WHERE school_id = ?", [schoolId], (err, row) => {
      callback(err, row ? row.total : 0);
    });
  },

  getByMatricule: (schoolId, matricule, callback) => {
    const sql = `
      SELECT e.*,
             (SELECT s.id FROM students s WHERE s.uuid = e.student_uuid LIMIT 1) AS student_id
      FROM eleves e
      WHERE e.school_id = ? AND e.matricule = ?
    `;
    db.get(sql, [schoolId, matricule], (err, row) => callback(err, row));
  },

  getProfileByMatricule: (schoolId, matricule, callback) => {
    const eleveSql = `
      SELECT e.*,
             (SELECT s.id FROM students s WHERE s.uuid = e.student_uuid LIMIT 1) AS student_id
      FROM eleves e
      WHERE e.school_id = ? AND e.matricule = ?
    `;
    const notesSql = `
      SELECT matiere, trimestre, note_type, note, annee, created_at
      FROM notes
      WHERE school_id = ? AND eleve_matricule = ?
      ORDER BY created_at DESC
    `;
    const notesSummarySql = `
      SELECT matiere, trimestre, COALESCE(annee, '') AS annee, ROUND(AVG(note), 2) AS moyenne
      FROM notes
      WHERE school_id = ? AND eleve_matricule = ?
      GROUP BY matiere, trimestre, COALESCE(annee, '')
      ORDER BY annee DESC, trimestre ASC, matiere ASC
    `;

    db.get(eleveSql, [schoolId, matricule], (eleveErr, eleve) => {
      if (eleveErr) return callback(eleveErr);
      if (!eleve) return callback(null, null);

      db.all(notesSql, [schoolId, matricule], (notesErr, notes) => {
        if (notesErr) return callback(notesErr);

        db.all(notesSummarySql, [schoolId, matricule], (summaryErr, notesSummary) => {
          if (summaryErr) return callback(summaryErr);
          return callback(null, {
            eleve,
            notes: notes || [],
            notesSummary: notesSummary || []
          });
        });
      });
    });
  },

  createForSchool: (schoolId, data, callback) => {
    function buildMatricule(nom, prenom) {
      const date = new Date();
      const year = date.getFullYear().toString().slice(-2);
      const randomNum = Math.floor(1000 + Math.random() * 9000);
      return `${(nom || "X").charAt(0).toUpperCase()}${(prenom || "X").charAt(0).toUpperCase()}${year}${randomNum}`;
    }

    const {
      matricule: matriculeInput,
      nom,
      prenom,
      classe,
      sexe,
      dateNaissance,
      nomparent,
      telparent,
      photo_profil,
      photo_acte_naissance
    } = data;
    const confirmOverflow = String(data.confirm_overflow || "") === "1";
    const matricule = String(matriculeInput || "").trim() || buildMatricule(nom, prenom);

    const selectClassWithCapacitySql = `
      SELECT nom, niveau, annee, mensuel, COALESCE(frais_inscription, 0) AS frais_inscription,
             COALESCE(effectif, 0) AS effectif, COALESCE(effectif_max, 0) AS effectif_max
      FROM classes
      WHERE school_id = ? AND nom = ?
    `;
    const selectClassNamesSql = "SELECT nom FROM classes WHERE school_id = ?";
    const createSuffixedClassSql = `
      INSERT INTO classes (school_id, nom, niveau, annee, mensuel, frais_inscription, effectif_max, effectif, totalapaie, totalpaie)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0)
    `;
    const insertEleveSql = `
      INSERT INTO eleves (
        school_id, matricule, nom, prenom, classe, sexe, dateNaissance, nomParent, telparent, photo_profil, photo_acte_naissance, caise
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const updateClasseSql = `
      UPDATE classes
      SET effectif = effectif + 1,
          totalpaie = COALESCE(totalpaie, 0) + ?
      WHERE school_id = ? AND nom = ?
    `;
    const insertAutoPaiementSql = `
      INSERT INTO paiements (school_id, eleve_matricule, montant, mois, date_payement, mode_payement, annee_scolaire)
      VALUES (?, ?, ?, ?, date('now'), ?, ?)
    `;

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.get(selectClassWithCapacitySql, [schoolId, classe], (classErr, classRow) => {
        if (classErr) {
          db.run("ROLLBACK");
          return callback(classErr);
        }
        if (!classRow) {
          db.run("ROLLBACK");
          return callback(new Error("Classe introuvable"));
        }

        const continueWithClass = (targetClassName, targetClassRow, createdClassName) => {
          const fraisInscription = Number(targetClassRow.frais_inscription || 0);

          db.run(
            insertEleveSql,
            [
              schoolId,
              matricule,
              nom,
              prenom,
              targetClassName,
              String(sexe || "").trim() || null,
              dateNaissance,
              nomparent,
              telparent,
              String(photo_profil || "").trim() || null,
              String(photo_acte_naissance || "").trim() || null,
              Math.max(fraisInscription, 0)
            ],
            function onInsert(insertErr) {
              if (insertErr) {
                db.run("ROLLBACK");
                return callback(insertErr);
              }

              const insertedId = this.lastID;

              db.run(updateClasseSql, [Math.max(fraisInscription, 0), schoolId, targetClassName], (updateErr) => {
                if (updateErr) {
                  db.run("ROLLBACK");
                  return callback(updateErr);
                }

                const finishCommit = () => {
                  db.run("COMMIT", (commitErr) => {
                    if (commitErr) return callback(commitErr);
                    return callback(null, {
                      id: insertedId,
                      assignedClass: targetClassName,
                      createdClassName: createdClassName || null
                    });
                  });
                };

                if (fraisInscription > 0) {
                  db.run(
                    insertAutoPaiementSql,
                    [schoolId, matricule, fraisInscription, "inscription", "frais_inscription_auto", targetClassRow.annee || null],
                    (autoErr) => {
                      if (autoErr) {
                        db.run("ROLLBACK");
                        return callback(autoErr);
                      }
                      return finishCommit();
                    }
                  );
                  return;
                }

                return finishCommit();
              });
            }
          );
        };

        const effectifMax = Number(classRow.effectif_max || 0);
        const classFull = effectifMax > 0 && Number(classRow.effectif || 0) >= effectifMax;

        if (!classFull) {
          return continueWithClass(classe, classRow, null);
        }

        db.all(selectClassNamesSql, [schoolId], (namesErr, namesRows) => {
          if (namesErr) {
            db.run("ROLLBACK");
            return callback(namesErr);
          }

          const existingNames = (namesRows || []).map((r) => r.nom);
          const suggestedClassName = nextSuffixedClassName(classe, existingNames);

          if (!confirmOverflow) {
            const err = new Error(`Effectif max atteint pour ${classe}. Confirmez pour creer ${suggestedClassName}.`);
            err.code = "CLASS_FULL_CONFIRM_REQUIRED";
            err.suggestedClassName = suggestedClassName;
            err.originalClassName = classe;
            db.run("ROLLBACK");
            return callback(err);
          }

          db.run(
            createSuffixedClassSql,
            [
              schoolId,
              suggestedClassName,
              classRow.niveau || null,
              classRow.annee || null,
              Number(classRow.mensuel || 0),
              Number(classRow.frais_inscription || 0),
              Number(classRow.effectif_max || 0)
            ],
            (createClassErr) => {
              if (createClassErr) {
                db.run("ROLLBACK");
                return callback(createClassErr);
              }

              return continueWithClass(
                suggestedClassName,
                { ...classRow, nom: suggestedClassName },
                suggestedClassName
              );
            }
          );
        });
      });
    });
  },

  updateForSchool: (schoolId, matricule, data, callback) => {
    const {
      nom,
      prenom,
      classe,
      sexe,
      dateNaissance,
      telparent,
      nomparent,
      photo_profil,
      photo_acte_naissance
    } = data;
    const selectEleveSql = "SELECT classe FROM eleves WHERE school_id = ? AND matricule = ?";
    const selectClassSql = "SELECT nom, annee, COALESCE(frais_inscription, 0) AS frais_inscription FROM classes WHERE school_id = ? AND nom = ?";
    const sql = `
      UPDATE eleves
      SET nom = ?, prenom = ?, dateNaissance = ?, classe = ?, sexe = ?, nomParent = ?, telparent = ?, photo_profil = ?, photo_acte_naissance = ?
      WHERE school_id = ? AND matricule = ?
    `;
    const updateOldClassSql = `
      UPDATE classes
      SET effectif = MAX(effectif - 1, 0),
          totalpaie = MAX(COALESCE(totalpaie, 0) - ?, 0)
      WHERE school_id = ? AND nom = ?
    `;
    const updateNewClassSql = `
      UPDATE classes
      SET effectif = effectif + 1,
          totalpaie = COALESCE(totalpaie, 0) + ?
      WHERE school_id = ? AND nom = ?
    `;
    const adjustEleveCaiseSql = `
      UPDATE eleves
      SET caise = MAX(COALESCE(caise, 0) + ?, 0)
      WHERE school_id = ? AND matricule = ?
    `;
    const deleteAutoPaiementSql = `
      DELETE FROM paiements
      WHERE school_id = ? AND eleve_matricule = ? AND mode_payement = 'frais_inscription_auto'
    `;
    const insertAutoPaiementSql = `
      INSERT INTO paiements (school_id, eleve_matricule, montant, mois, date_payement, mode_payement, annee_scolaire)
      VALUES (?, ?, ?, ?, date('now'), ?, ?)
    `;

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.get(selectEleveSql, [schoolId, matricule], (oldErr, oldEleve) => {
        if (oldErr) {
          db.run("ROLLBACK");
          return callback(oldErr);
        }
        if (!oldEleve) {
          db.run("ROLLBACK");
          return callback(new Error("Eleve introuvable"));
        }

        db.run(
          sql,
          [
            nom,
            prenom,
            dateNaissance,
            classe,
            String(sexe || "").trim() || null,
            nomparent,
            telparent,
            String(photo_profil || "").trim() || null,
            String(photo_acte_naissance || "").trim() || null,
            schoolId,
            matricule
          ],
          function onUpdate(updateErr) {
          if (updateErr) {
            db.run("ROLLBACK");
            return callback(updateErr);
          }

          const changes = this ? this.changes : 0;
          if (changes === 0) {
            db.run("ROLLBACK");
            return callback(new Error("Aucune modification effectuee"), 0);
          }

          if (oldEleve.classe === classe) {
            db.run("COMMIT", (commitErr) => callback(commitErr, changes));
            return;
          }

          db.get(selectClassSql, [schoolId, oldEleve.classe], (oldClassErr, oldClassRow) => {
            if (oldClassErr) {
              db.run("ROLLBACK");
              return callback(oldClassErr);
            }

            db.get(selectClassSql, [schoolId, classe], (newClassErr, newClassRow) => {
              if (newClassErr) {
                db.run("ROLLBACK");
                return callback(newClassErr);
              }
              if (!newClassRow) {
                db.run("ROLLBACK");
                return callback(new Error("Nouvelle classe introuvable"));
              }

              const oldFrais = Number(oldClassRow ? oldClassRow.frais_inscription : 0);
              const newFrais = Number(newClassRow.frais_inscription || 0);
              const delta = newFrais - oldFrais;

              db.run(updateOldClassSql, [Math.max(oldFrais, 0), schoolId, oldEleve.classe], (oldClassUpdateErr) => {
                if (oldClassUpdateErr) {
                  db.run("ROLLBACK");
                  return callback(oldClassUpdateErr);
                }

                db.run(updateNewClassSql, [Math.max(newFrais, 0), schoolId, classe], (newClassUpdateErr) => {
                  if (newClassUpdateErr) {
                    db.run("ROLLBACK");
                    return callback(newClassUpdateErr);
                  }

                  db.run(adjustEleveCaiseSql, [delta, schoolId, matricule], (caiseErr) => {
                    if (caiseErr) {
                      db.run("ROLLBACK");
                      return callback(caiseErr);
                    }

                    db.run(deleteAutoPaiementSql, [schoolId, matricule], (deleteAutoErr) => {
                      if (deleteAutoErr) {
                        db.run("ROLLBACK");
                        return callback(deleteAutoErr);
                      }

                      if (newFrais > 0) {
                        db.run(
                          insertAutoPaiementSql,
                          [schoolId, matricule, newFrais, "inscription", "frais_inscription_auto", newClassRow.annee || null],
                          (insertAutoErr) => {
                            if (insertAutoErr) {
                              db.run("ROLLBACK");
                              return callback(insertAutoErr);
                            }
                            db.run("COMMIT", (commitErr) => callback(commitErr, changes));
                          }
                        );
                        return;
                      }

                      db.run("COMMIT", (commitErr) => callback(commitErr, changes));
                    });
                  });
                });
              });
            });
          });
          }
        );
      });
    });
  },

  deleteForSchool: (schoolId, matricule, callback) => {
    const selectSql = "SELECT * FROM eleves WHERE school_id = ? AND matricule = ?";
    const deleteSql = "DELETE FROM eleves WHERE school_id = ? AND matricule = ?";
    const selectClassSql = "SELECT COALESCE(frais_inscription, 0) AS frais_inscription FROM classes WHERE school_id = ? AND nom = ?";
    const updateClassSql = `
      UPDATE classes
      SET effectif = MAX(effectif - 1, 0),
          totalpaie = MAX(COALESCE(totalpaie, 0) - ?, 0)
      WHERE school_id = ? AND nom = ?
    `;
    const deleteAutoPaiementSql = `
      DELETE FROM paiements
      WHERE school_id = ? AND eleve_matricule = ? AND mode_payement = 'frais_inscription_auto'
    `;

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.get(selectSql, [schoolId, matricule], (err, row) => {
        if (err) {
          db.run("ROLLBACK");
          return callback(err);
        }
        if (!row) {
          db.run("ROLLBACK");
          return callback(new Error("Eleve introuvable"));
        }

        db.get(selectClassSql, [schoolId, row.classe], (classErr, classRow) => {
          if (classErr) {
            db.run("ROLLBACK");
            return callback(classErr);
          }
          const frais = Number(classRow ? classRow.frais_inscription : 0);

          db.run(deleteSql, [schoolId, matricule], (deleteErr) => {
            if (deleteErr) {
              db.run("ROLLBACK");
              return callback(deleteErr);
            }

            db.run(updateClassSql, [Math.max(frais, 0), schoolId, row.classe], (updateErr) => {
              if (updateErr) {
                db.run("ROLLBACK");
                return callback(updateErr);
              }

              db.run(deleteAutoPaiementSql, [schoolId, matricule], (autoErr) => {
                if (autoErr) {
                  db.run("ROLLBACK");
                  return callback(autoErr);
                }
                db.run("COMMIT", (commitErr) => callback(commitErr));
              });
            });
          });
        });
      });
    });
  }
};

module.exports = EleveModel;
