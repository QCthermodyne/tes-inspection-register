import crypto from "node:crypto";
import { authed, authCookie, json, token } from "../lib/http.js";

// GET: is this phone signed in?
export function GET(request) {
  return json({ ok: authed(request), configured: !!process.env.APP_PIN });
}

// POST {pin}: sign in for 90 days.
export async function POST(request) {
  const pin = process.env.APP_PIN;
  if (!pin) return json({ error: "No PIN is set for this app yet.", code: "not_configured" }, 503);
  let body = {};
  try { body = await request.json(); } catch {}
  const given = String(body.pin || "");
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(pin).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    await new Promise((r) => setTimeout(r, 1200)); // slow down guessing
    return json({ error: "Wrong PIN.", code: "wrong_pin" }, 401);
  }
  return json({ ok: true }, 200, { "set-cookie": authCookie(token(), 60 * 60 * 24 * 90) });
}

// DELETE: sign out.
export function DELETE() {
  return json({ ok: true }, 200, { "set-cookie": authCookie("", 0) });
}
