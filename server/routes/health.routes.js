const express = require("express");

const router = express.Router();

router.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "unitech-erp-api",
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
