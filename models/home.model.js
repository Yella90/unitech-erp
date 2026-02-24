const db = require("../config/db");

const HomeModel = {
  getSchoolDashboardData: (schoolId, callback) => {
    const sql = `
      SELECT
        (SELECT COUNT(*) FROM classes WHERE school_id = ?) AS classes_count,
        (SELECT COUNT(*) FROM eleves WHERE school_id = ?) AS eleves_count,
        (SELECT COALESCE(SUM(montant), 0) FROM paiements WHERE school_id = ?) AS total_paiements,
        (SELECT COALESCE(SUM(montant), 0) FROM depenses WHERE school_id = ?) AS total_depenses
    `;

    db.get(sql, [schoolId, schoolId, schoolId, schoolId], (err, row) => {
      callback(err, row);
    });
  },

  getDashboardFinanceActuals: (schoolId, startDate, targetMonth, endDate, callback) => {
    const sql = `
      SELECT
        (SELECT COALESCE(SUM(montant), 0)
         FROM paiements
         WHERE school_id = ?
           AND strftime('%Y-%m', COALESCE(date_payement, created_at)) = ?) AS actual_revenus_mensuel,
        (
          (SELECT COALESCE(SUM(montant), 0)
           FROM depenses
           WHERE school_id = ?
             AND strftime('%Y-%m', COALESCE(date_depenses, created_at)) = ?)
          +
          (SELECT COALESCE(SUM(montant), 0)
           FROM salaires
           WHERE school_id = ?
             AND strftime('%Y-%m', COALESCE(date_payement, created_at)) = ?)
          +
          (SELECT COALESCE(SUM(montant), 0)
           FROM retraits_promoteur
           WHERE school_id = ?
             AND strftime('%Y-%m', COALESCE(date_retrait, created_at)) = ?)
        ) AS actual_depenses_mensuel,
        (SELECT COALESCE(SUM(montant), 0)
         FROM paiements
         WHERE school_id = ?
           AND date(COALESCE(date_payement, created_at)) >= date(?)
           AND date(COALESCE(date_payement, created_at)) <= date(?)) AS actual_revenus_cumule,
        (
          (SELECT COALESCE(SUM(montant), 0)
           FROM depenses
           WHERE school_id = ?
             AND date(COALESCE(date_depenses, created_at)) >= date(?)
             AND date(COALESCE(date_depenses, created_at)) <= date(?))
          +
          (SELECT COALESCE(SUM(montant), 0)
           FROM salaires
           WHERE school_id = ?
             AND date(COALESCE(date_payement, created_at)) >= date(?)
             AND date(COALESCE(date_payement, created_at)) <= date(?))
          +
          (SELECT COALESCE(SUM(montant), 0)
           FROM retraits_promoteur
           WHERE school_id = ?
             AND date(COALESCE(date_retrait, created_at)) >= date(?)
             AND date(COALESCE(date_retrait, created_at)) <= date(?))
        ) AS actual_depenses_cumule
    `;

    db.get(
      sql,
      [
        schoolId,
        targetMonth,
        schoolId,
        targetMonth,
        schoolId,
        targetMonth,
        schoolId,
        targetMonth,
        schoolId,
        startDate,
        endDate,
        schoolId,
        startDate,
        endDate,
        schoolId,
        startDate,
        endDate,
        schoolId,
        startDate,
        endDate
      ],
      (err, row) => callback(err, row)
    );
  }
};

module.exports = HomeModel;
