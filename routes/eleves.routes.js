const express = require("express");
const router = express.Router();
const ElevesController = require("../controllers/eleves.controller");
const { requireAuth } = require("../middlewares/auth.middleware");
const { requireTenant } = require("../middlewares/tenant.middleware");
const { multipartUpload } = require("../middlewares/upload.middleware");
const { abonnementMiddleware } = require("../middlewares/subscription.middleware");

router.get("/", requireAuth, requireTenant, abonnementMiddleware, ElevesController.liste);
router.get("/liste", requireAuth, requireTenant, abonnementMiddleware, ElevesController.liste);
router.get("/affichage", requireAuth, requireTenant, abonnementMiddleware, ElevesController.liste);
router.get("/add", requireAuth, requireTenant, abonnementMiddleware, ElevesController.add);
router.get("/inscription", requireAuth, requireTenant, abonnementMiddleware, ElevesController.add);
router.get("/export/pdf", requireAuth, requireTenant, abonnementMiddleware, ElevesController.exportClasseMatierePdf);
router.post("/add", requireAuth, requireTenant, abonnementMiddleware, multipartUpload, ElevesController.create);
router.get("/profil/:matricule", requireAuth, requireTenant, abonnementMiddleware, ElevesController.profile);
router.get("/edit/:matricule", requireAuth, requireTenant, abonnementMiddleware, ElevesController.edit);
router.post("/edit/:matricule", requireAuth, requireTenant, abonnementMiddleware, multipartUpload, ElevesController.update);
router.post("/delete/:matricule", requireAuth, requireTenant, abonnementMiddleware, ElevesController.delete);

module.exports = router;
