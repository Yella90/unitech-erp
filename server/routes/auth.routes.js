const express = require("express");
const AuthController = require("../controllers/auth.controller");
const { apiRateLimit } = require("../middleware/rate-limit.middleware");

const router = express.Router();

router.post("/token", apiRateLimit(), AuthController.issueToken);

module.exports = router;
