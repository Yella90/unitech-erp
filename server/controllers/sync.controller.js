const SyncService = require("../services/sync.service");

exports.listQueue = async (req, res) => {
  try {
    const data = await SyncService.listQueue({
      schoolId: req.apiSchoolId,
      status: req.query.status
    });
    return res.json({ data });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
};

exports.enqueue = async (req, res) => {
  try {
    const payload = req.body || {};
    const data = await SyncService.enqueue({
      schoolId: req.apiSchoolId,
      tableName: payload.table_name,
      operation: payload.operation,
      recordUuid: payload.uuid,
      data: payload.data,
      sourceDeviceId: req.headers["x-device-id"] || payload.source_device_id || null
    });
    return res.status(201).json({ data });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
};

exports.acknowledge = async (req, res) => {
  try {
    const data = await SyncService.acknowledge({
      schoolId: req.apiSchoolId,
      queueId: Number(req.params.id),
      status: String((req.body || {}).status || "synced")
    });
    return res.json({ data });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
};
