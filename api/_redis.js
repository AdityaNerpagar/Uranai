// Minimal Upstash Redis REST client. The Vercel Marketplace integration
// provisions the env vars automatically (either naming scheme works).
async function redis(...command) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("kv-not-configured");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });
  if (!res.ok) throw new Error("kv-error");
  const data = await res.json();
  if (data.error) throw new Error("kv-error");
  return data.result;
}

function clientIp(req) {
  const forwarded = (req.headers && req.headers["x-forwarded-for"]) || "";
  return String(forwarded).split(",")[0].trim() ||
    (req.headers && req.headers["x-real-ip"]) || "unknown";
}

// Sliding per-IP counter. Fails open: a Redis outage shouldn't lock the
// door — key-use accounting still gates users independently.
async function rateLimit(req, bucket, limit, windowSec) {
  try {
    const key = "rl:" + bucket + ":" + clientIp(req);
    const count = await redis("INCR", key);
    if (count === 1) await redis("EXPIRE", key, windowSec);
    return count <= limit;
  } catch {
    return true;
  }
}

module.exports = { redis, rateLimit };
