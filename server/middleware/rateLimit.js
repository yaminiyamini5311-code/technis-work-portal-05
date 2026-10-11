/**
 * Minimal in-memory fixed-window rate limiter.
 *
 * No external dependency. Intended for auth endpoints (login) —
 * a generic per-route limiter. State is per-process; on Vercel
 * serverless each instance enforces its own window, which still
 * blunts credential-stuffing bursts.
 *
 * Usage:
 *   const { rateLimit } = require("./rateLimit");
 *   router.post("/login", rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }), handler);
 */
function rateLimit({ windowMs = 15 * 60 * 1000, max = 20, keyFn } = {}) {
  const hits = new Map(); // key -> { count, resetAt }

  // Periodic sweep so the map cannot grow unbounded from dead IPs
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) {
      if (now > v.resetAt) hits.delete(k);
    }
  }, Math.max(windowMs, 60 * 1000));
  if (sweep.unref) sweep.unref();

  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : (req.ip || req.socket?.remoteAddress || "unknown");
    const now = Date.now();
    let record = hits.get(key);
    if (!record || now > record.resetAt) {
      record = { count: 1, resetAt: now + windowMs };
      hits.set(key, record);
    } else {
      record.count += 1;
    }

    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - record.count)));

    if (record.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((record.resetAt - now) / 1000)));
      return res.status(429).json({
        success: false,
        message: "Too many attempts. Please try again in a few minutes.",
        code: "RATE_LIMITED",
      });
    }
    next();
  };
}

module.exports = { rateLimit };
