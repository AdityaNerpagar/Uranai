const { signToken, verifyToken } = require("./_utils");

/* ---------- System prompts (server-side only) ---------- */

const SYSTEM_PROMPTS = {
  iching: `You are a wise and poetic I Ching master with decades of study in the Book of Changes.

When consulted:
1. Cast a hexagram (randomly select one of the 64, with optional moving lines)
2. Show its name in Chinese and English, number (1-64), and trigrams
3. Draw it using ⚊ (solid) and ⚋ (broken) lines, 6 lines bottom to top, inside a code block
4. Give the Judgment (彖辭) — the core oracle statement
5. Give the Image (象辭) — the symbolic interpretation
6. If there are changing lines, explain them
7. Personally interpret the hexagram in relation to the question
8. End with a poetic couplet or classical wisdom

Format your response in Markdown with headings.`,

  bazi: `You are a master of Ba Zi (八字), the Four Pillars of Destiny.

Provide a reading focused only on the user's requested area (or all five if none specified).
Do NOT show any pillar calculations, stems, branches, or technical workings.
Output only insights in plain flowing prose under these headings as relevant:

- Personality & Inner Nature
- Career & Vocation
- Relationships & Love
- Wealth & Financial Luck
- Health & Vitality

Keep each section concise (3-5 sentences). Close with one sentence on the person's
overall elemental theme and what season/energy favors them.

Format your response in Markdown with headings.`,

  ziwei: `You are a grandmaster of Zi Wei Dou Shu (紫微斗數), the imperial star astrology of China.

When consulted:
1. Identify the Purple Star palace and its significance
2. Describe the major stars in the Life Palace (命宮)
3. Analyze the Trinity Palaces (三方四正) — Career, Wealth, Migration
4. Give deep analysis of the requested palace if one is specified
5. Note key star combinations (星曜組合) — auspicious and challenging
6. Close with overall destiny arc: talents, challenges, life theme

Format your response in Markdown with headings.`
};

/* ---------- User message builders (validated field allowlist) ---------- */

function field(fields, name, maxLen = 200) {
  const v = fields && fields[name];
  return typeof v === "string" ? v.slice(0, maxLen).trim() : "";
}

function buildUserMessage(method, fields) {
  if (method === "iching") {
    const question = field(fields, "question", 1000);
    return question
      ? `My question for the oracle: ${question}`
      : "I come with an open mind and no specific question. Please cast a hexagram and share what the oracle reveals.";
  }
  if (method === "bazi") {
    return (
      `Please give me a Ba Zi reading.\n` +
      `Date of birth: ${field(fields, "date") || "unknown"}\n` +
      `Time of birth: ${field(fields, "time") || "unknown"}\n` +
      `Place of birth: ${field(fields, "place") || "unknown"}\n` +
      `Gender: ${field(fields, "gender")}\n` +
      `Focus area: ${field(fields, "focus")}`
    );
  }
  if (method === "ziwei") {
    return (
      `Please give me a Zi Wei Dou Shu reading.\n` +
      `Date of birth: ${field(fields, "date") || "unknown"}\n` +
      `Birth hour: ${field(fields, "hour")}\n` +
      `Gender: ${field(fields, "gender")}\n` +
      `Palace of interest: ${field(fields, "palace")}`
    );
  }
  return null;
}

/* ---------- Provider routing (keys from env vars) ---------- */

async function callAPI(systemPrompt, userMessage) {
  const provider = process.env.AI_PROVIDER || "gemini";

  if (provider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("missing-key");
    const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: userMessage }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] }
        })
      }
    );
    if ([400, 401, 403].includes(response.status)) throw new Error("bad-key");
    if (!response.ok) throw new Error("api-error");
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("api-error");
    return text;
  }

  if (provider === "claude") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("missing-key");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }]
      })
    });
    if ([401, 403].includes(response.status)) throw new Error("bad-key");
    if (!response.ok) throw new Error("api-error");
    const data = await response.json();
    const text = data?.content?.[0]?.text;
    if (!text) throw new Error("api-error");
    return text;
  }

  if (provider === "groq") {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("missing-key");
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ]
      })
    });
    if ([401, 403].includes(response.status)) throw new Error("bad-key");
    if (!response.ok) throw new Error("api-error");
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error("api-error");
    return text;
  }

  throw new Error("api-error");
}

/* ---------- Handler ---------- */

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method-not-allowed" });
    return;
  }

  const { token, method, fields } = req.body || {};

  const session = verifyToken(token);
  if (!session) {
    res.status(401).json({ error: "invalid-session" });
    return;
  }
  if (session.role === "user" && session.used) {
    res.status(403).json({ error: "reading-used" });
    return;
  }

  const systemPrompt = SYSTEM_PROMPTS[method];
  const userMessage = buildUserMessage(method, fields);
  if (!systemPrompt || !userMessage) {
    res.status(400).json({ error: "bad-request" });
    return;
  }

  try {
    const reading = await callAPI(systemPrompt, userMessage);
    const result = { reading };
    // Consume the free reading: reissue the user's token as "used"
    if (session.role === "user") {
      result.token = signToken({ role: "user", used: true, iat: Date.now() });
    }
    res.status(200).json(result);
  } catch (err) {
    if (err.message === "missing-key" || err.message === "bad-key") {
      res.status(502).json({ error: "oracle-unreachable" });
    } else {
      res.status(502).json({ error: "api-error" });
    }
  }
};
