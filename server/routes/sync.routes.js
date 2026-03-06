const express = require("express");
const SyncController = require("../controllers/sync.controller");
const { apiRateLimit } = require("../middleware/rate-limit.middleware");
const { requireApiAuth, requireApiSchoolContext } = require("../middleware/api-auth.middleware");
const { requireSchoolApiKey } = require("../middleware/api-key.middleware");

const router = express.Router();

router.use(apiRateLimit(), requireApiAuth, requireApiSchoolContext, requireSchoolApiKey);
router.get("/queue", SyncController.listQueue);
router.post("/queue", SyncController.enqueue);
router.post("/queue/:id/ack", SyncController.acknowledge);

module.exports = router;
