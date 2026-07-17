const { signToken, safeEqual } = require("./_utils");
const { redis } = require("./_redis");

// Accepts "XKQ2-9FMT-C4RD", "xkq29fmtc4rd", etc. → canonical dashed form
function normalizeKey(input) {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{12}$/.test(raw)) return null;
  return raw.slice(0, 4) + "-" + raw.slice(4, 8) + "-" + raw.slice(8, 12);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method-not-allowed" });
    return;
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword || !process.env.SESSION_SECRET) {
    res.status(500).json({ error: "server-not-configured" });
    return;
  }

  const password = req.body && req.body.password;
  if (typeof password !== "string" || password.length > 200) {
    res.status(400).json({ error: "bad-request" });
    return;
  }

  if (safeEqual(password, adminPassword)) {
    res.status(200).json({
      role: "admin",
      token: signToken({ role: "admin", iat: Date.now() })
    });
    return;
  }

  // Not the admin password — try it as a one-time oracle key
  const code = normalizeKey(password);
  if (!code) {
    res.status(401).json({ error: "invalid-password" });
    return;
  }

  try {
    const raw = await redis("GET", "oraclekey:" + code);
    if (!raw) {
      res.status(401).json({ error: "invalid-password" });
      return;
    }
    let record;
    try { record = JSON.parse(raw); } catch { record = {}; }

    // Legacy single-use record from before use counters: convert in place
    if (!record.total && record.status) {
      const remaining = record.status === "unused" ? 1 : 0;
      await redis("SET", "oraclekeyuses:" + code, remaining, "NX");
      await redis("SET", "oraclekey:" + code, JSON.stringify({ total: 1, created: record.created }));
    }

    const remaining = parseInt(await redis("GET", "oraclekeyuses:" + code), 10) || 0;
    if (remaining <= 0) {
      res.status(401).json({ error: "key-used" });
      return;
    }
    // Uses are not consumed here — /api/reading spends one atomically when
    // a reading is delivered, so a failed attempt doesn't burn the key.
    res.status(200).json({
      role: "user",
      token: signToken({ role: "user", key: code, iat: Date.now() })
    });
  } catch {
    res.status(500).json({ error: "server-error" });
  }
};
