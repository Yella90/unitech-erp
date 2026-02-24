const express = require("express");
const router = express.Router();
const ModulesController = require("../controllers/modules.controller");
const { requireAuth } = require("../middlewares/auth.middleware");
const { requireTenant } = require("../middlewares/tenant.middleware");
const { abonnementMiddleware } = require("../middlewares/subscription.middleware");

router.get("/", requireAuth, requireTenant, abonnementMiddleware, ModulesController.list);
router.get("/:slug", requireAuth, requireTenant, abonnementMiddleware, ModulesController.detail);

module.exports = router;
