const express = require("express");
const router = express.Router();
const FinanceController = require("../controllers/finance.controller");
const { requireAuth } = require("../middlewares/auth.middleware");
const { requireTenant } = require("../middlewares/tenant.middleware");
const { abonnementMiddleware, requireFeature } = require("../middlewares/subscription.middleware");

router.get("/", requireAuth, requireTenant, abonnementMiddleware, requireFeature("finance_enabled"), FinanceController.index);

module.exports = router;
