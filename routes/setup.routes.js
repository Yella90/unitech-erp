const express = require("express");
const SetupController = require("../controllers/setup.controller");
const { requireAuth, requireRole } = require("../middlewares/auth.middleware");
const { requireTenant } = require("../middlewares/tenant.middleware");
const { abonnementMiddleware, requireFeature } = require("../middlewares/subscription.middleware");
const { setupUpload } = require("../middlewares/setup-upload.middleware");

const router = express.Router();

router.use(requireAuth, requireTenant, abonnementMiddleware, requireRole("school_admin"), requireFeature("setup_assistant"));

router.get("/", (req, res) => res.redirect("/setup/classes"));
router.get("/classes", SetupController.classesPage);
router.post("/classes", SetupController.createClass);
router.post("/classes/import/excel", requireFeature("excel_import"), setupUpload, SetupController.importClassesExcel);

router.get("/eleves", SetupController.elevesPage);
router.post("/eleves/manual", SetupController.createEleveManual);
router.post("/eleves/import/excel/preview", requireFeature("excel_import"), setupUpload, SetupController.previewElevesExcel);
router.post("/eleves/import/photo/preview", requireFeature("ocr_import"), setupUpload, SetupController.previewElevesPhoto);
router.post("/eleves/import/commit", SetupController.commitElevesPreview);

router.get("/notes", SetupController.notesPage);
router.get("/notes/eleves", SetupController.notesClasseOptions);
router.post("/notes/dynamic", SetupController.saveNotesDynamic);
router.post("/notes/import/excel", requireFeature("excel_import"), setupUpload, SetupController.previewNotesExcel);
router.post("/notes/import/photo/preview", requireFeature("ocr_import"), setupUpload, SetupController.previewNotesPhoto);
router.post("/notes/import/photo", requireFeature("ocr_import"), setupUpload, SetupController.previewNotesPhoto);
router.post("/notes/import/commit", SetupController.commitNotesPreview);

module.exports = router;
