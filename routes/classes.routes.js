const express = require("express");
const router = express.Router();
const ClassesController = require("../controllers/classes.controller");
const { requireAuth } = require("../middlewares/auth.middleware");
const { requireTenant } = require("../middlewares/tenant.middleware");
const { abonnementMiddleware } = require("../middlewares/subscription.middleware");

router.get("/", requireAuth, requireTenant, abonnementMiddleware, ClassesController.index);
router.get("/add", requireAuth, requireTenant, abonnementMiddleware, ClassesController.add);
router.post("/add", requireAuth, requireTenant, abonnementMiddleware, ClassesController.create);
router.post("/delete/:id", requireAuth, requireTenant, abonnementMiddleware, ClassesController.delete);

module.exports = router;
