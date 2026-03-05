const express = require("express");
const router = express.Router();
const homeController = require("../controllers/home.controller");
const { requireAuth } = require("../middlewares/auth.middleware");
const { requireTenant } = require("../middlewares/tenant.middleware");
const { abonnementMiddleware, requireFeature } = require("../middlewares/subscription.middleware");

router.get("/", (req, res) => {
  const user = req.session && req.session.user ? req.session.user : null;
  if (!user) {
    return res.redirect("/entreprise");
  }
  if (user.role === "superadmin") {
    return res.redirect("/admin/dashboard");
  }
  return res.redirect("/dashboard");
});
router.get("/vitrine", homeController.landing);
router.get("/entreprise", homeController.entreprise);
router.post("/api/public/visit", homeController.trackPublicVisit);
router.get("/download/desktop/windows", homeController.downloadDesktopInstallerWindows);
router.get("/download/desktop/mac", homeController.downloadDesktopInstallerMac);
router.get("/login", (req, res) => res.redirect("/auth/login"));
router.get("/register", (req, res) => res.redirect("/auth/register-school"));
router.get("/dashboard", requireAuth, requireTenant, abonnementMiddleware, requireFeature("dashboard_smart"), homeController.index);

module.exports = router;
