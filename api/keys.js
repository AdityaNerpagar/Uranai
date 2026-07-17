const crypto = require("crypto");
const { verifyToken } = require("./_utils");
const { redis, rateLimit } = require("./_redis");

// No ambiguous characters (0/O, 1/I/L)
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function makeCode() {
  let s = "";
  for (let i = 0; i < 12; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8, 12);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method-not-allowed" });
    return;
  }

  const { token, action, uses } = req.body || {};
  const session = verifyToken(token);
  if (!session) {
    res.status(401).json({ error: "invalid-session" });
    return;
  }
  if (session.role !== "admin") {
    res.status(403).json({ error: "admin-only" });
    return;
  }

  if (!(await rateLimit(req, "keys", 30, 60))) {
    res.status(429).json({ error: "rate-limited" });
    return;
  }

  try {
    if (action === "generate") {
      const total = Math.min(99, Math.max(1, parseInt(uses, 10) || 1));
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = makeCode();
        const record = JSON.stringify({ total, created: Date.now() });
        const set = await redis("SET", "oraclekey:" + code, record, "NX");
        if (set) {
          await redis("SET", "oraclekeyuses:" + code, total);
          await redis("LPUSH", "oraclekeys:index", code);
          await redis("LTRIM", "oraclekeys:index", 0, 199);
          res.status(200).json({ key: code, total });
          return;
        }
      }
      res.status(500).json({ error: "server-error" });
      return;
    }

    if (action === "list") {
      const codes = await redis("LRANGE", "oraclekeys:index", 0, 99);
      if (!codes || codes.length === 0) {
        res.status(200).json({ keys: [] });
        return;
      }
      const metas = await redis("MGET", ...codes.map((c) => "oraclekey:" + c));
      const counts = await redis("MGET", ...codes.map((c) => "oraclekeyuses:" + c));
      const keys = [];
      codes.forEach((code, i) => {
        if (!metas[i]) return;
        try {
          const meta = JSON.parse(metas[i]);
          let total, remaining;
          if (meta.total) {
            total = meta.total;
            remaining = counts[i] === null ? 0 : Math.max(0, parseInt(counts[i], 10) || 0);
          } else {
            // legacy single-use record from before counters existed
            total = 1;
            remaining = meta.status === "unused" ? 1 : 0;
          }
          keys.push({ key: code, total, remaining, created: meta.created });
        } catch { /* skip corrupt record */ }
      });
      res.status(200).json({ keys });
      return;
    }

    res.status(400).json({ error: "bad-request" });
  } catch {
    res.status(500).json({ error: "server-error" });
  }
};
