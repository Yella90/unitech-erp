const HomeModel = require("../models/home.model");
const ClassesService = require("./classes.service");
const ElevesService = require("./eleves.service");
const SystemService = require("./system/system.service");

function fromCallback(executor) {
  return new Promise((resolve, reject) => {
    executor((err, data) => {
      if (err) return reject(err);
      return resolve(data);
    });
  });
}

function monthLabelFromKey(key) {
  const raw = String(key || "").trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) return raw || "-";
  const [y, m] = raw.split("-").map((v) => Number(v));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return raw;
  const d = new Date(y, m - 1, 1);
  return new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(d);
}

const HomeServices = {
  indexHome: (schoolId, options, callback) => {
    (async () => {
      const [stats, classes, eleves, payrollForecast, tuitionForecast, monthData] = await Promise.all([
        fromCallback((cb) => HomeModel.getSchoolDashboardData(schoolId, cb)),
        fromCallback((cb) => ClassesService.listClasses(schoolId, cb)),
        fromCallback((cb) => ElevesService.listEleves(schoolId, cb)),
        SystemService.getMonthlyForecast(schoolId),
        SystemService.getTuitionForecast(schoolId, { month: options && options.selectedMonth }),
        SystemService.getSchoolMonthOptions(schoolId)
      ]);

      const availableMonths = Array.isArray(monthData.monthOptions) ? monthData.monthOptions.map((row) => row.value) : [];
      const selectedMonth = availableMonths.includes(options && options.selectedMonth)
        ? options.selectedMonth
        : (tuitionForecast.activeMonth || monthData.activeMonth || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`);

      const activeRange = selectedMonth ? `${selectedMonth}-01` : tuitionForecast.startDate;
      let endDate = activeRange;
      if (selectedMonth) {
        const [yearText, monthText] = selectedMonth.split("-");
        const y = Number(yearText);
        const m = Number(monthText);
        const d = new Date(y, m, 0);
        endDate = `${yearText}-${monthText}-${String(d.getDate()).padStart(2, "0")}`;
      }

      const [actuals, timelineRaw] = await Promise.all([
        fromCallback((cb) =>
          HomeModel.getDashboardFinanceActuals(schoolId, tuitionForecast.startDate, selectedMonth, endDate, cb)
        ),
        fromCallback((cb) =>
          HomeModel.getDashboardFinanceTimeline(schoolId, tuitionForecast.startDate, endDate, cb)
        )
      ]);

      const monthOptions = Array.isArray(monthData.monthOptions) ? monthData.monthOptions : [];
      const selectedIdx = monthOptions.findIndex((m) => m.value === selectedMonth);
      const fromIdx = selectedIdx >= 0 ? Math.max(0, selectedIdx - 5) : Math.max(0, monthOptions.length - 6);
      const timelineScope = monthOptions.slice(fromIdx, selectedIdx >= 0 ? selectedIdx + 1 : monthOptions.length);
      const byMonth = new Map((timelineRaw || []).map((row) => [String(row.month_key || "").trim(), row]));

      const timeline = timelineScope.map((m) => {
        const row = byMonth.get(String(m.value || "").trim()) || {};
        const revenus = Number(row.revenus || 0);
        const depenses = Number(row.depenses || 0);
        const salaires = Number(row.salaires || 0);
        const retraits = Number(row.retraits || 0);
        const sorties = depenses + salaires + retraits;
        return {
          key: m.value,
          label: monthLabelFromKey(m.value),
          revenus,
          depenses,
          salaires,
          retraits,
          sorties,
          solde: revenus - sorties
        };
      });

      return {
        stats,
        classes,
        eleves,
        payrollForecast,
        tuitionForecast,
        actuals,
        timeline,
        monthData,
        selectedMonth
      };
    })()
      .then((data) => callback(null, data))
      .catch((err) => callback(err));
  }
};

module.exports = HomeServices;
