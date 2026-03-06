const express = require("express");
const ClassesController = require("../controllers/classes.controller");
const { apiRateLimit } = require("../middleware/rate-limit.middleware");
const { requireApiAuth, requireApiSchoolContext } = require("../middleware/api-auth.middleware");
const { requireSchoolApiKey } = require("../middleware/api-key.middleware");

const router = express.Router();

router.use(apiRateLimit(), requireApiAuth, requireApiSchoolContext, requireSchoolApiKey);
router.get("/", ClassesController.list);
router.post("/", ClassesController.create);
router.patch("/:uuid", ClassesController.update);
router.delete("/:uuid", ClassesController.remove);

module.exports = router;
