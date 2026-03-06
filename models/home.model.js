const db = require("../config/db");

const usePostgres =
  String(process.env.DB_CLIENT || "").trim().toLowerCase() === "postgres";

const HomeModel = {
  getSchoolDashboardData: (schoolId, callback) => {
    const sql = `
      SELECT
        (SELECT COUNT(*) FROM classes WHERE school_id = ?) AS classes_count,
        (SELECT COUNT(*) FROM eleves WHERE school_id = ?) AS eleves_count,
        (SELECT COALESCE(SUM(montant), 0) FROM paiements WHERE school_id = ?) AS total_paiements,
        (SELECT COALESCE(SUM(montant), 0) FROM depenses WHERE school_id = ?) AS total_depenses
    `;

    db.get(sql, [schoolId, schoolId, schoolId, schoolId], callback);
  },

  getDashboardFinanceActuals: (schoolId, startDate, targetMonth, endDate, callback) => {

    const monthCondition = usePostgres
      ? `to_char(COALESCE(date_payement, created_at), 'YYYY-MM') = ?`
      : `strftime('%Y-%m', COALESCE(date_payement, created_at)) = ?`;

    const dateCast = usePostgres
      ? `COALESCE(date_payement, created_at)`
      : `date(COALESCE(date_payement, created_at))`;

    const sql = `
      SELECT
        (
          SELECT COALESCE(SUM(montant), 0)
          FROM paiements
          WHERE school_id = ?
            AND ${monthCondition}
        ) AS actual_revenus_mensuel,

        (
          (SELECT COALESCE(SUM(montant), 0)
           FROM depenses
           WHERE school_id = ?
             AND ${usePostgres
               ? `to_char(COALESCE(date_depenses, created_at), 'YYYY-MM') = ?`
               : `strftime('%Y-%m', COALESCE(date_depenses, created_at)) = ?`})
          +
          (SELECT COALESCE(SUM(montant), 0)
           FROM salaires
           WHERE school_id = ?
             AND ${usePostgres
               ? `to_char(COALESCE(date_payement, created_at), 'YYYY-MM') = ?`
               : `strftime('%Y-%m', COALESCE(date_payement, created_at)) = ?`})
          +
          (SELECT COALESCE(SUM(montant), 0)
           FROM retraits_promoteur
           WHERE school_id = ?
             AND ${usePostgres
               ? `to_char(COALESCE(date_retrait, created_at), 'YYYY-MM') = ?`
               : `strftime('%Y-%m', COALESCE(date_retrait, created_at)) = ?`})
        ) AS actual_depenses_mensuel,

        (
          SELECT COALESCE(SUM(montant), 0)
          FROM paiements
          WHERE school_id = ?
            AND ${dateCast} >= ?
            AND ${dateCast} <= ?
        ) AS actual_revenus_cumule,

        (
          (SELECT COALESCE(SUM(montant), 0)
           FROM depenses
           WHERE school_id = ?
             AND ${usePostgres
               ? `COALESCE(date_depenses, created_at) >= ? AND COALESCE(date_depenses, created_at) <= ?`
               : `date(COALESCE(date_depenses, created_at)) >= date(?) AND date(COALESCE(date_depenses, created_at)) <= date(?)`})
          +
          (SELECT COALESCE(SUM(montant), 0)
           FROM salaires
           WHERE school_id = ?
             AND ${usePostgres
               ? `COALESCE(date_payement, created_at) >= ? AND COALESCE(date_payement, created_at) <= ?`
               : `date(COALESCE(date_payement, created_at)) >= date(?) AND date(COALESCE(date_payement, created_at)) <= date(?)`})
          +
          (SELECT COALESCE(SUM(montant), 0)
           FROM retraits_promoteur
           WHERE school_id = ?
             AND ${usePostgres
               ? `COALESCE(date_retrait, created_at) >= ? AND COALESCE(date_retrait, created_at) <= ?`
               : `date(COALESCE(date_retrait, created_at)) >= date(?) AND date(COALESCE(date_retrait, created_at)) <= date(?)`})
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
      callback
    );
  },

  getDashboardFinanceTimeline: (schoolId, startDate, endDate, callback) => {
    const monthExprPaiements = usePostgres
      ? `to_char(COALESCE(date_payement, created_at), 'YYYY-MM')`
      : `strftime('%Y-%m', COALESCE(date_payement, created_at))`;
    const monthExprDepenses = usePostgres
      ? `to_char(COALESCE(date_depenses, created_at), 'YYYY-MM')`
      : `strftime('%Y-%m', COALESCE(date_depenses, created_at))`;
    const monthExprSalaires = usePostgres
      ? `to_char(COALESCE(date_payement, created_at), 'YYYY-MM')`
      : `strftime('%Y-%m', COALESCE(date_payement, created_at))`;
    const monthExprRetraits = usePostgres
      ? `to_char(COALESCE(date_retrait, created_at), 'YYYY-MM')`
      : `strftime('%Y-%m', COALESCE(date_retrait, created_at))`;

    const rangePaiements = usePostgres
      ? `COALESCE(date_payement, created_at) >= ? AND COALESCE(date_payement, created_at) <= ?`
      : `date(COALESCE(date_payement, created_at)) >= date(?) AND date(COALESCE(date_payement, created_at)) <= date(?)`;
    const rangeDepenses = usePostgres
      ? `COALESCE(date_depenses, created_at) >= ? AND COALESCE(date_depenses, created_at) <= ?`
      : `date(COALESCE(date_depenses, created_at)) >= date(?) AND date(COALESCE(date_depenses, created_at)) <= date(?)`;
    const rangeSalaires = usePostgres
      ? `COALESCE(date_payement, created_at) >= ? AND COALESCE(date_payement, created_at) <= ?`
      : `date(COALESCE(date_payement, created_at)) >= date(?) AND date(COALESCE(date_payement, created_at)) <= date(?)`;
    const rangeRetraits = usePostgres
      ? `COALESCE(date_retrait, created_at) >= ? AND COALESCE(date_retrait, created_at) <= ?`
      : `date(COALESCE(date_retrait, created_at)) >= date(?) AND date(COALESCE(date_retrait, created_at)) <= date(?)`;

    const sql = `
      SELECT
        month_key,
        SUM(revenus) AS revenus,
        SUM(depenses) AS depenses,
        SUM(salaires) AS salaires,
        SUM(retraits) AS retraits
      FROM (
        SELECT
          ${monthExprPaiements} AS month_key,
          COALESCE(SUM(montant), 0) AS revenus,
          0 AS depenses,
          0 AS salaires,
          0 AS retraits
        FROM paiements
        WHERE school_id = ?
          AND ${rangePaiements}
        GROUP BY 1

        UNION ALL

        SELECT
          ${monthExprDepenses} AS month_key,
          0 AS revenus,
          COALESCE(SUM(montant), 0) AS depenses,
          0 AS salaires,
          0 AS retraits
        FROM depenses
        WHERE school_id = ?
          AND ${rangeDepenses}
        GROUP BY 1

        UNION ALL

        SELECT
          ${monthExprSalaires} AS month_key,
          0 AS revenus,
          0 AS depenses,
          COALESCE(SUM(montant), 0) AS salaires,
          0 AS retraits
        FROM salaires
        WHERE school_id = ?
          AND ${rangeSalaires}
        GROUP BY 1

        UNION ALL

        SELECT
          ${monthExprRetraits} AS month_key,
          0 AS revenus,
          0 AS depenses,
          0 AS salaires,
          COALESCE(SUM(montant), 0) AS retraits
        FROM retraits_promoteur
        WHERE school_id = ?
          AND ${rangeRetraits}
        GROUP BY 1
      ) x
      GROUP BY month_key
      ORDER BY month_key ASC
    `;

    db.all(
      sql,
      [
        schoolId, startDate, endDate,
        schoolId, startDate, endDate,
        schoolId, startDate, endDate,
        schoolId, startDate, endDate
      ],
      callback
    );
  }
};

module.exports = HomeModel;
