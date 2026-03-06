const ClassesService = require("../services/classes.service");

exports.list = async (req, res) => {
  try {
    const data = await ClassesService.list({
      schoolId: req.apiSchoolId,
      includeDeleted: String(req.query.include_deleted || "0") === "1"
    });
    return res.json({ data });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const data = await ClassesService.create({
      schoolId: req.apiSchoolId,
      payload: req.body || {},
      actorUserId: req.apiUser ? req.apiUser.id : null,
      sourceDeviceId: req.headers["x-device-id"] || null
    });
    return res.status(201).json({ data });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const data = await ClassesService.update({
      schoolId: req.apiSchoolId,
      uuid: req.params.uuid,
      payload: req.body || {},
      actorUserId: req.apiUser ? req.apiUser.id : null,
      sourceDeviceId: req.headers["x-device-id"] || null
    });
    return res.json({ data });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const data = await ClassesService.remove({
      schoolId: req.apiSchoolId,
      uuid: req.params.uuid,
      actorUserId: req.apiUser ? req.apiUser.id : null,
      sourceDeviceId: req.headers["x-device-id"] || null
    });
    return res.json({ data });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
};
