const express = require("express");
const healthRoutes = require("./health.routes");
const authRoutes = require("./auth.routes");
const classesRoutes = require("./classes.routes");
const elevesRoutes = require("./eleves.routes");
const syncRoutes = require("./sync.routes");

const router = express.Router();

router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use("/classes", classesRoutes);
router.use("/eleves", elevesRoutes);
router.use("/sync", syncRoutes);

module.exports = router;
