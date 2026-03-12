const SyncQueueModel = require("../models/sync-queue.model");
const RealtimeSyncService = require("../../services/sync/realtime-sync.service");
const { spawn } = require("child_process");

let started = false;
let lastReconcileAt = 0;
const reconcileEnabled = String(process.env.SYNC_RECONCILE_ENABLED || "true").toLowerCase() !== "false";
const reconcileIntervalMs = Number(process.env.SYNC_RECONCILE_INTERVAL_MS || 15 * 60 * 1000); // default 15 min

async function maybeRunReconcile() {
  if (!reconcileEnabled) return;
  if (!RealtimeSyncService.isEnabled()) return;
  const online = await RealtimeSyncService.canReachCentral();
  if (!online) return;
  const now = Date.now();
  if (now - lastReconcileAt < reconcileIntervalMs) return;
  lastReconcileAt = now;
  const child = spawn(process.execPath, ["scripts/sync-reconcile.js"], {
    stdio: "inherit",
    env: process.env
  });
  child.on("error", (err) => console.error("Reconcile spawn error:", err.message));
}

function startSyncWorker() {
  if (started) return;
  started = true;

  const everyMs = Number(process.env.SYNC_WORKER_INTERVAL_MS || 30_000);
  setInterval(async () => {
    try {
      await SyncQueueModel.markFailedStuckAsPending(8);
      await maybeRunReconcile();
      await RealtimeSyncService.syncTick();
    } catch (err) {
      // Keep worker resilient: sync must never crash app process.
      // eslint-disable-next-line no-console
      console.error("Sync worker error:", err.message);
    }
  }, everyMs).unref();
}

module.exports = { startSyncWorker };
