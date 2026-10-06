import crypto from "node:crypto";
import { put, get, del } from "@vercel/blob";
import { authed, json, unauthorized } from "../lib/http.js";

const ID = /^[a-f0-9]{32}$/;
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// POST raw image body -> {id}
export async function POST(request) {
  if (!authed(request)) return unauthorized();
  const type = (request.headers.get("content-type") || "image/jpeg").split(";")[0];
  if (!TYPES[type]) return json({ error: "Only JPEG, PNG or WebP photos.", code: "unsupported_type" }, 415);
  const buf = Buffer.from(await request.arrayBuffer());
  if (!buf.length) return json({ error: "Empty photo.", code: "invalid_request" }, 400);
  if (buf.length > 4 * 1024 * 1024) return json({ error: "Photo is over 4 MB.", code: "too_large" }, 413);
  const id = crypto.randomBytes(16).toString("hex");
  await put(`photos/${id}`, buf, { access: "private", contentType: type, addRandomSuffix: false });
  return json({ id, url: `/api/photo?id=${id}` });
}

// GET ?id= -> the image
export async function GET(request) {
  if (!authed(request)) return unauthorized();
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!ID.test(id)) return json({ error: "Bad id." }, 400);
  const r = await get(`photos/${id}`, { access: "private" }).catch(() => null);
  if (!r || r.statusCode !== 200) return new Response("Not found", { status: 404 });
  return new Response(r.stream, {
    headers: {
      "content-type": r.blob.contentType || "image/jpeg",
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=604800, immutable",
    },
  });
}

// DELETE ?id=
export async function DELETE(request) {
  if (!authed(request)) return unauthorized();
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!ID.test(id)) return json({ error: "Bad id." }, 400);
  await del(`photos/${id}`);
  return json({ deleted: true });
}
