const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/system/system.controller");
const transferCtrl = require("../../controllers/system/transfers.controller");
const { requireAuth, requireRole, checkRole } = require("../../middlewares/auth.middleware");
const { requireTenant } = require("../../middlewares/tenant.middleware");
const { abonnementMiddleware, requireFeature } = require("../../middlewares/subscription.middleware");

router.use(requireAuth, requireTenant, abonnementMiddleware);

router.post("/annee-scolaire", ctrl.setSchoolYear);

router.get("/administration", ctrl.administrationPage);
router.post("/administration", ctrl.administrationUpdate);
router.post("/administration/subscription/request", requireRole("school_admin"), ctrl.requestSubscriptionChange);

router.get("/enseignants", ctrl.enseignantsPage);
router.post("/enseignants", ctrl.enseignantsCreate);
router.post("/enseignants/delete/:id", ctrl.enseignantsDelete);

router.get("/personnel", ctrl.personnelPage);
router.post("/personnel", ctrl.personnelCreate);
router.post("/personnel/delete/:id", ctrl.personnelDelete);

router.get("/matieres", ctrl.matieresPage);
router.post("/matieres", ctrl.matieresCreate);
router.post("/matieres/delete/:id", ctrl.matieresDelete);

router.get("/affectations", ctrl.affectationsPage);
router.post("/affectations", ctrl.affectationsCreate);
router.post("/affectations/delete/:id", ctrl.affectationsDelete);

router.get("/emplois", ctrl.emploisPage);
router.get("/emplois/export", ctrl.emploisExportPdf);
router.post("/emplois", ctrl.emploisCreate);
router.get("/emplois/edit/:id", ctrl.emploisEditPage);
router.post("/emplois/edit/:id", ctrl.emploisUpdate);
router.post("/emplois/delete/:id", ctrl.emploisDelete);

router.get("/notes", ctrl.notesPage);
router.get("/notes/options/matieres", ctrl.notesMatieresOptions);
router.post("/notes", ctrl.notesCreate);
router.post("/notes/delete/:id", ctrl.notesDelete);
router.get("/bulletins/classe", ctrl.bulletinsClassePage);
router.post("/bulletins/classe/mutation", ctrl.bulletinsClasseMutation);
router.post("/bulletins/ecole/mutation", requireRole("school_admin"), ctrl.bulletinsSchoolMutation);
router.get("/bulletins/classe/export", requireFeature("export_advanced"), ctrl.bulletinsClasseExportPdf);
router.get("/bulletins/eleve/export", requireFeature("export_advanced"), ctrl.bulletinEleveExportPdf);

router.get("/notifications", ctrl.notificationsPage);
router.post("/notifications/read-all", ctrl.notificationsReadAll);
router.post("/notifications/:id/read", ctrl.notificationsReadOne);
router.get("/notifications/export", requireFeature("export_advanced"), ctrl.notificationsExportPdf);

router.get("/finances", ctrl.financesPage);
router.post("/finances/paiements", ctrl.financesCreatePaiement);
router.post("/finances/paiements/delete/:id", ctrl.financesDeletePaiement);

router.get("/salaires", ctrl.salairesPage);
router.post("/salaires", ctrl.salairesCreate);
router.post("/salaires/delete/:id", ctrl.salairesDelete);

router.get("/depenses", ctrl.depensesPage);
router.post("/depenses", ctrl.depensesCreate);
router.post("/depenses/delete/:id", ctrl.depensesDelete);

router.get("/tresorerie", requireFeature("stats_advanced"), ctrl.tresoreriePage);

router.get("/utilisateurs", requireRole("school_admin"), ctrl.utilisateursPage);
router.post("/utilisateurs", requireRole("school_admin"), ctrl.utilisateursCreate);
router.post("/utilisateurs/delete/:id", requireRole("school_admin"), ctrl.utilisateursDelete);

router.get("/rapports", requireFeature("stats_advanced"), ctrl.rapportsPage);

router.get("/transfers/request/:matricule", checkRole("admin_ecole"), transferCtrl.requestForm);
router.post("/transfers/request", checkRole("admin_ecole"), transferCtrl.requestCreate);
router.get("/transfers/incoming", checkRole("admin_ecole"), transferCtrl.incomingPage);
router.get("/transfers/:id", checkRole("admin_ecole"), transferCtrl.detailPage);
router.post("/transfers/:id/accept", checkRole("admin_ecole"), transferCtrl.accept);
router.post("/transfers/:id/reject", checkRole("admin_ecole"), transferCtrl.reject);
router.get("/students/:id/history", checkRole("admin_ecole"), transferCtrl.studentHistoryPage);

module.exports = router;
