const SyncQueueModel = require("../models/sync-queue.model");
const RealtimeSyncService = require("../../services/sync/realtime-sync.service");

let started = false;

function startSyncWorker() {
  if (started) return;
  started = true;

  const everyMs = Number(process.env.SYNC_WORKER_INTERVAL_MS || 30_000);
  setInterval(async () => {
    try {
      await SyncQueueModel.markFailedStuckAsPending(8);
      await RealtimeSyncService.syncTick();
    } catch (err) {
      // Keep worker resilient: sync must never crash app process.
      // eslint-disable-next-line no-console
      console.error("Sync worker error:", err.message);
    }
  }, everyMs).unref();
}

module.exports = { startSyncWorker };
