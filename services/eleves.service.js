const EleveModel = require("../models/eleves.model");
const SubscriptionService = require("../subscription/subscription.service");

const EleveService = {
  listEleves: (schoolId, callback) => {
    EleveModel.getAllBySchool(schoolId, callback);
  },

  listElevesByMatricule: (schoolId, matricule, callback) => {
    EleveModel.getAllBySchoolAndMatricule(schoolId, matricule, callback);
  },

  listElevesByFilters: (schoolId, filters, callback) => {
    EleveModel.getAllBySchoolWithFilters(schoolId, filters, callback);
  },

  listElevesByClasse: (schoolId, classe, callback) => {
    EleveModel.getByClassOrdered(schoolId, classe, callback);
  },

  listElevesNotesByClasseAndMatiere: (schoolId, filters, callback) => {
    EleveModel.getNotesByClasseAndMatiere(schoolId, filters, callback);
  },

  getEleveByMatricule: (schoolId, matricule, callback) => {
    EleveModel.getByMatricule(schoolId, matricule, callback);
  },

  getEleveProfileByMatricule: (schoolId, matricule, callback) => {
    EleveModel.getProfileByMatricule(schoolId, matricule, callback);
  },

  createEleve: (schoolId, data, callback) => {
    EleveModel.countBySchool(schoolId, async (countErr, total) => {
      if (countErr) return callback(countErr);

      try {
        await SubscriptionService.assertUnderLimit({ schoolId, entity: "students", currentCount: total });
        return EleveModel.createForSchool(schoolId, data, callback);
      } catch (err) {
        return callback(err);
      }
    });
  },

  updateEleve: (schoolId, matricule, data, callback) => {
    EleveModel.updateForSchool(schoolId, matricule, data, callback);
  },

  deleteEleve: (schoolId, matricule, callback) => {
    EleveModel.deleteForSchool(schoolId, matricule, callback);
  }
};

module.exports = EleveService;
