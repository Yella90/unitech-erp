const db = require("../config/db");

const ClassesModel = {
  getAllBySchool: (schoolId, callback) => {
    const sql = "SELECT * FROM classes WHERE school_id = ? ORDER BY nom ASC";
    db.all(sql, [schoolId], (err, rows) => callback(err, rows));
  },

  getByName: (schoolId, name, callback) => {
    const sql = "SELECT * FROM classes WHERE school_id = ? AND nom = ?";
    db.get(sql, [schoolId, name], (err, row) => callback(err, row));
  },

  createForSchool: (schoolId, data, callback) => {
    const { nom, cycle, niveau, annee, mensuel, frais_inscriptioin, effectif_max } = data;
    const sql = `
      INSERT INTO classes (school_id, nom, cycle, niveau, annee, mensuel, frais_inscription, effectif_max)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(
      sql,
      [schoolId, nom, cycle, niveau, annee, Number(mensuel) || 0, Number(frais_inscriptioin) || 0, Number(effectif_max) || 50],
      function onRun(err) {
      callback(err, this ? this.lastID : null);
      }
    );
  },

  deleteForSchool: (schoolId, id, callback) => {
    const sql = "DELETE FROM classes WHERE id = ? AND school_id = ?";
    db.run(sql, [id, schoolId], function onRun(err) {
      callback(err, this ? this.changes : 0);
    });
  }
};

module.exports = ClassesModel;
