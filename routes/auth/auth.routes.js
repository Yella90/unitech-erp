const express = require("express");
const AuthController = require("../../controllers/auth/auth.controller");

const router = express.Router();

router.get("/register-school", AuthController.showRegisterSchool);
router.post("/register-school", AuthController.registerSchool);
router.get("/login", AuthController.showLogin);
router.post("/login", AuthController.login);
router.post("/logout", AuthController.logout);

module.exports = router;
