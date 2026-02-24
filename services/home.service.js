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

      const actuals = await fromCallback((cb) =>
        HomeModel.getDashboardFinanceActuals(schoolId, tuitionForecast.startDate, selectedMonth, endDate, cb)
      );

      return {
        stats,
        classes,
        eleves,
        payrollForecast,
        tuitionForecast,
        actuals,
        monthData,
        selectedMonth
      };
    })()
      .then((data) => callback(null, data))
      .catch((err) => callback(err));
  }
};

module.exports = HomeServices;
