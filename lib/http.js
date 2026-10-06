import crypto from "node:crypto";

const COOKIE = "tes_auth";

export const token = () =>
  crypto.createHash("sha256").update("tes-inspection:" + (process.env.APP_PIN || "")).digest("hex");

// Open access: everyone with the link can use the app.
// To bring the PIN back, set PIN_REQUIRED=1 (and APP_PIN) in Vercel and redeploy.
export const pinRequired = () => process.env.PIN_REQUIRED === "1" && !!process.env.APP_PIN;

export function authed(request) {
  if (!pinRequired()) return true;
  const m = (request.headers.get("cookie") || "").match(/(?:^|;\s*)tes_auth=([a-f0-9]{64})/);
  if (!m) return false;
  return crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(token()));
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

export const unauthorized = () => json({ error: "Sign in with the PIN first.", code: "unauthorized" }, 401);

export const authCookie = (value, maxAge) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
