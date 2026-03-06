const express = require("express");
const SuperAdminController = require("../../controllers/superadmin/superadmin.controller");
const { requireSuperAdmin } = require("../../middlewares/auth.middleware");

const router = express.Router();

router.get("/dashboard", requireSuperAdmin, SuperAdminController.dashboard);
router.post("/schools/:id/activate", requireSuperAdmin, SuperAdminController.activateSchool);
router.post("/schools/:id/deactivate", requireSuperAdmin, SuperAdminController.deactivateSchool);
router.post("/subscriptions/:id/validate", requireSuperAdmin, SuperAdminController.validateSubscription);
router.post("/subscriptions/:id/suspend", requireSuperAdmin, SuperAdminController.suspendSubscription);
router.post("/subscriptions/:id/activate", requireSuperAdmin, SuperAdminController.activateSubscription);
router.post("/schools/:id/plan", requireSuperAdmin, SuperAdminController.changePlan);
router.post("/schools/:id/update", requireSuperAdmin, SuperAdminController.updateSchoolInfo);
router.post("/schools/:id/reset-admin-password", requireSuperAdmin, SuperAdminController.resetSchoolAdminPassword);
router.post("/superadmins", requireSuperAdmin, SuperAdminController.createSuperAdmin);

module.exports = router;
