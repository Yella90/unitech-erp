const ClassesModel = require("../models/classes.model");

const ClassesService = {
  listClasses: (schoolId, callback) => {
    ClassesModel.getAllBySchool(schoolId, callback);
  },

  createClass: (schoolId, data, callback) => {
    const nom = String(data.nom || "").trim();
    const cycle = String(data.cycle || "").trim().toLowerCase();
    const niveau = String(data.niveau || "").trim().toLowerCase();
    const annee = String(data.annee || "").trim();

    const allowedByCycle = {
      primaire: ["jardin", "1ere", "2eme", "3eme", "4eme", "5eme", "6eme"],
      secondaire: ["7eme", "8eme", "9eme"],
      lycee: ["10eme", "11eme", "terminale"]
    };

    if (!nom || !cycle || !niveau || !annee) {
      return callback(new Error("Nom, cycle, niveau et annee scolaire sont obligatoires"));
    }
    if (!Object.prototype.hasOwnProperty.call(allowedByCycle, cycle)) {
      return callback(new Error("Cycle invalide"));
    }
    if (!allowedByCycle[cycle].includes(niveau)) {
      return callback(new Error("Niveau invalide pour le cycle choisi"));
    }
    if (!/^\d{4}-\d{4}$/.test(annee)) {
      return callback(new Error("Format annee scolaire invalide (AAAA-AAAA)"));
    }

    const payload = {
      ...data,
      nom,
      cycle,
      niveau,
      annee
    };

    ClassesModel.getByName(schoolId, nom, (err, existing) => {
      if (err) return callback(err);
      if (existing) return callback(new Error("Cette classe existe deja pour votre ecole"));
      return ClassesModel.createForSchool(schoolId, payload, callback);
    });
  },

  deleteClass: (schoolId, id, callback) => {
    ClassesModel.deleteForSchool(schoolId, id, callback);
  }
};

module.exports = ClassesService;
