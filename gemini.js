const http = require("http");

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.MODEL || "gemini-2.5-flash";
const PORT = process.env.PORT || 3000;

const SYSTEM_PROMPT = `তুমি "Minhaj Shop BD"-এর বন্ধুসুলভ সেলস অ্যাসিস্ট্যান্ট।
কাস্টমার যে ভাষায় লেখে সেই ভাষায় ছোট ও পরিষ্কার উত্তর দাও।
পণ্য, দাম, ডেলিভারি ও অর্ডার নিয়ে সাহায্য করো।
অর্ডারের জন্য নাম, ফোন নম্বর ও ঠিকানা নাও।
যে তথ্য তোমার জানা নেই তা বানিয়ে বলবে না; বলবে "আমাদের টিম শীঘ্রই জানাবে"।`;

const history = {};

async function askAI(userId, text) {
  const h = (history[userId] = history[userId] || []);
  h.push({ role: "user", parts: [{ text }] });
  while (h.length > 10) h.shift();
  while (h.length && h[0].role !== "user") h.shift();

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: h,
        generationConfig: { maxOutputTokens: 500 },
      }),
    }
  );
  const data = await r.json();
  if (!data.candidates) {
    console.error("Gemini error:", JSON.stringify(data));
    h.pop();
    return "দুঃখিত, একটু পরে আবার চেষ্টা করুন।";
  }
  const parts = (data.candidates[0].content && data.candidates[0].content.parts) || [];
  const reply = parts.map((p) => p.text || "").join("").trim()
    || "দুঃখিত, একটু পরে আবার চেষ্টা করুন।";
  h.push({ role: "model", parts: [{ text: reply }] });
  return reply;
}

async function sendMessage(userId, text) {
  await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient: { id: userId }, message: { text } }),
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/webhook") {
    if (url.searchParams.get("hub.mode") === "subscribe" &&
        url.searchParams.get("hub.verify_token") === VERIFY_TOKEN) {
      res.writeHead(200);
      return res.end(url.searchParams.get("hub.challenge"));
    }
    res.writeHead(403);
    return res.end();
  }

  if (req.method === "POST" && url.pathname === "/webhook") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200);
      res.end("OK");
      try {
        const payload = JSON.parse(body);
        for (const entry of payload.entry || []) {
          for (const ev of entry.messaging || []) {
            if (ev.message && ev.message.text && !ev.message.is_echo) {
              askAI(ev.sender.id, ev.message.text)
                .then((reply) => sendMessage(ev.sender.id, reply))
                .catch((e) => console.error("Error:", e));
            }
          }
        }
      } catch (e) { console.error(e); }
    });
    return;
  }

  res.writeHead(200);
  res.end("Minhaj AI is running");
}).listen(PORT, () => console.log("Running on " + PORT));
