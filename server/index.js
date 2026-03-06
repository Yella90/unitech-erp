const express = require("express");
const apiRoutes = require("./routes");
const { startSyncWorker } = require("./workers/sync.worker");

function mountServerApi(app) {
  app.use("/api/v1", apiRoutes);
  startSyncWorker();
}

module.exports = { mountServerApi };
