const HomeService = require("../services/home.service");
const SubscriptionService = require("../subscription/subscription.service");
const { get } = require("../utils/dbAsync");

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

exports.index = (req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect("/auth/login");
  }

  if (req.session.user.role === "superadmin") {
    return res.redirect("/admin/dashboard");
  }

  const selectedMonth = String(req.query.month || "").trim();

  HomeService.indexHome(req.school_id, { selectedMonth }, (err, data) => {
    if (err) {
      req.flash("error", "Erreur chargement dashboard");
      return res.redirect("/classes");
    }

    const rows = Array.isArray(data.classes) ? data.classes : [];
    const tt = toNumber(data.stats && data.stats.total_paiements);
    const startDate = data.tuitionForecast && data.tuitionForecast.startDate ? data.tuitionForecast.startDate : null;
    const moisEcoules = toNumber(data.tuitionForecast && data.tuitionForecast.moisEcoules);

    const tta = rows.reduce((sum, classe) => {
      const totalClasse = toNumber(classe.totalapaie);
      if (totalClasse > 0) return sum + totalClasse;
      return sum + toNumber(classe.mensuel) * toNumber(classe.effectif);
    }, 0);

    const datas = {
      d: new Date().getFullYear(),
      totaleleves: Array.isArray(data.eleves) ? data.eleves.length : 0,
      totalclasses: rows.length,
      totalenseignants: 0,
      tt,
      tta,
      reste: Math.max(tta - tt, 0),
      rows,
      finance: {
        startDate,
        moisEcoules,
        revenus: {
          forecastMensuel: toNumber(data.tuitionForecast && data.tuitionForecast.totalMensuelPrevu),
          actualMensuel: toNumber(data.actuals && data.actuals.actual_revenus_mensuel),
          forecastCumule: toNumber(data.tuitionForecast && data.tuitionForecast.totalCumulePrevu),
          actualCumule: toNumber(data.actuals && data.actuals.actual_revenus_cumule)
        },
        depenses: {
          forecastMensuel: toNumber(data.payrollForecast && data.payrollForecast.totalSortiesPrevues),
          actualMensuel: toNumber(data.actuals && data.actuals.actual_depenses_mensuel),
          forecastCumule: toNumber(data.payrollForecast && data.payrollForecast.totalSortiesPrevues) * Math.max(moisEcoules, 1),
          actualCumule: toNumber(data.actuals && data.actuals.actual_depenses_cumule)
        }
      },
      monthOptions: data.monthData && Array.isArray(data.monthData.monthOptions) ? data.monthData.monthOptions : [],
      activeMonth: data.selectedMonth || (data.monthData && data.monthData.activeMonth ? data.monthData.activeMonth : null),
      subscriptionStatus: res.locals.subscriptionStatus || null
    };

    return res.render("index", { datas });
  });
};

exports.landing = async (req, res) => {
  try {
    const [plans, schoolsRow, elevesRow, activeSchoolsRow, activeSubsRow] = await Promise.all([
      SubscriptionService.listPlans(),
      get("SELECT COUNT(*) AS total FROM schools", []),
      get("SELECT COUNT(*) AS total FROM eleves", []),
      get("SELECT COUNT(*) AS total FROM schools WHERE is_active = 1", []),
      get(
        `
        SELECT COUNT(*) AS total
        FROM schools s
        WHERE EXISTS (
          SELECT 1
          FROM saas_subscriptions ss
          WHERE ss.school_id = s.id
            AND lower(trim(COALESCE(ss.status, ''))) = 'active'
            AND (
              ss.expires_at IS NULL
              OR date(ss.expires_at) >= date('now')
            )
            AND ss.id = (
              SELECT x.id
              FROM saas_subscriptions x
              WHERE x.school_id = s.id
              ORDER BY x.created_at DESC, x.id DESC
              LIMIT 1
            )
        )
        `,
        []
      )
    ]);

    const totalSchools = Number((schoolsRow && schoolsRow.total) || 0);
    const totalEleves = Number((elevesRow && elevesRow.total) || 0);
    const activeSchools = Number((activeSchoolsRow && activeSchoolsRow.total) || 0);
    const activeSubscriptions = Number((activeSubsRow && activeSubsRow.total) || 0);
    const safeDenominator = totalSchools > 0 ? totalSchools : 1;

    const metrics = {
      totalSchools,
      totalEleves,
      satisfaction: Math.round((activeSchools / safeDenominator) * 100),
      disponibilite: Math.round((activeSubscriptions / safeDenominator) * 100)
    };

    return res.render("public/index", { plans: plans || [], metrics });
  } catch (err) {
    return res.render("public/index", {
      plans: [],
      metrics: {
        totalSchools: 0,
        totalEleves: 0,
        satisfaction: 0,
        disponibilite: 0
      }
    });
  }
};

exports.entreprise = (req, res) => {
  return res.render("public/entreprise");
};
