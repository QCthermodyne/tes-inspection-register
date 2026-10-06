import { authed, json, unauthorized } from "../lib/http.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

// GET -> is photo suggestion set up?
export function GET(request) {
  if (!authed(request)) return unauthorized();
  return json({ configured: !!process.env.ANTHROPIC_API_KEY, maxImages: 4 });
}

// POST {prompt, images:[{type, data(base64)}]} -> {data: parsed JSON}
export async function POST(request) {
  if (!authed(request)) return unauthorized();
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: "Photo suggestions are not set up.", code: "sampling_disabled" }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad JSON.", code: "invalid_request" }, 400); }
  const prompt = String(body.prompt || "").slice(0, 8000);
  const images = (Array.isArray(body.images) ? body.images : []).slice(0, 4)
    .filter((i) => ["image/jpeg", "image/png", "image/webp"].includes(i.type) && typeof i.data === "string");
  if (!prompt || !images.length) return json({ error: "Prompt and at least one photo are needed.", code: "invalid_request" }, 400);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          ...images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.type, data: i.data } })),
          { type: "text", text: prompt + "\n\nReply with the JSON object only." },
        ],
      }],
    }),
  });
  if (res.status === 429) return json({ error: "Too many requests.", code: "rate_limited" }, 429);
  if (!res.ok) {
    console.error("anthropic error", res.status, await res.text().catch(() => ""));
    return json({ error: "Suggestion service failed.", code: "upstream_error" }, 502);
  }
  const out = await res.json();
  const text = (out.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  try {
    return json({ data: JSON.parse(text.slice(s, e + 1)) });
  } catch {
    return json({ error: "Could not read the suggestion.", code: "invalid_json", text }, 502);
  }
}
