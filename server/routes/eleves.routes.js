const express = require("express");
const ElevesController = require("../controllers/eleves.controller");
const { apiRateLimit } = require("../middleware/rate-limit.middleware");
const { requireApiAuth, requireApiSchoolContext } = require("../middleware/api-auth.middleware");
const { requireSchoolApiKey } = require("../middleware/api-key.middleware");

const router = express.Router();

router.use(apiRateLimit(), requireApiAuth, requireApiSchoolContext, requireSchoolApiKey);
router.get("/", ElevesController.list);
router.post("/", ElevesController.create);
router.patch("/:uuid", ElevesController.update);
router.delete("/:uuid", ElevesController.remove);

module.exports = router;
