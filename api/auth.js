const { signToken, safeEqual } = require("./_utils");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method-not-allowed" });
    return;
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  const userPassword = process.env.USER_PASSWORD;
  if (!adminPassword || !userPassword || !process.env.SESSION_SECRET) {
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

  if (safeEqual(password, userPassword)) {
    res.status(200).json({
      role: "user",
      token: signToken({ role: "user", used: false, iat: Date.now() })
    });
    return;
  }

  res.status(401).json({ error: "invalid-password" });
};
