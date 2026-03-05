const buckets = new Map();

function apiRateLimit(options = {}) {
  const windowMs = Number(options.windowMs || 60_000);
  const max = Number(options.max || 240);

  return (req, res, next) => {
    const key = `${req.ip || "ip"}:${req.path}`;
    const now = Date.now();
    const entry = buckets.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }

    entry.count += 1;
    buckets.set(key, entry);

    if (entry.count > max) {
      return res.status(429).json({
        error: "Too many requests",
        retry_after_ms: Math.max(0, entry.resetAt - now)
      });
    }

    return next();
  };
}

module.exports = { apiRateLimit };
