// Document store on Upstash Redis (free tier, connected through the Vercel Marketplace).
//
//   tes:docs      hash   field = "jobs/<id>" or "jobs/<id>/tasks/<tid>", value = JSON document
//   tes:ver       int    bumped on every change; the app polls this cheap value and
//                        reloads data only when it moves
//   tes:migrated  flag   set once the old Vercel Blob snapshot has been imported
//
// The old Blob snapshot is only ever READ (never written or deleted) so it stays
// intact as a backup. While the Blob store is locked, the import is retried at
// most once an hour; when it succeeds, older records are merged in and the
// newer copy of any document wins.
import { list, get } from "@vercel/blob";

const SEG = "[A-Za-z0-9_\\-.~:@+]{1,200}";
export const DOC_RE = new RegExp(`^jobs/(${SEG})(?:/tasks/(${SEG}))?$`);
export const COL_RE = new RegExp(`^jobs(?:/(${SEG})/tasks)?$`);

const H = "tes:docs", VER = "tes:ver", MIG = "tes:migrated", MIGTRY = "tes:migtry";

const URL_ = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOK = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const configured = () => !!(URL_() && TOK());

async function redis(cmds) {
  if (!configured()) throw Object.assign(new Error("Database not connected"), { code: "not_configured" });
  const r = await fetch(URL_().replace(/\/$/, "") + "/pipeline", {
    method: "POST",
    headers: { authorization: `Bearer ${TOK()}`, "content-type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error(`Redis HTTP ${r.status}`);
  const out = await r.json();
  for (const x of out) if (x.error) throw new Error("Redis: " + x.error);
  return out.map((x) => x.result);
}

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

// ---------- reads ----------
export async function version() {
  let [v, m] = await redis([["GET", VER], ["EXISTS", MIG]]);
  if (!Number(m) && (await maybeMigrate()) === "imported") {
    [v, m] = await redis([["GET", VER], ["EXISTS", MIG]]);
  }
  return { v: Number(v || 0), restoring: !Number(m) };
}

export async function load() {
  await maybeMigrate();
  const [flat] = await redis([["HGETALL", H]]);
  const db = { jobs: {}, tasks: {} };
  for (let i = 0; i < (flat || []).length; i += 2) {
    const m = flat[i].match(DOC_RE), d = parse(flat[i + 1]);
    if (!m || !d) continue;
    if (m[2]) (db.tasks[m[1]] ||= {})[m[2]] = d; else db.jobs[m[1]] = d;
  }
  return { db };
}

// ---------- writes ----------
export async function write(op, path, data) {
  const now = Date.now();
  if (op === "delete") {
    const [, v] = await redis([["HDEL", H, path], ["INCR", VER]]);
    return { ok: true, v };
  }
  let doc = { ...data, _u: now };
  if (op === "update") {
    const [cur] = await redis([["HGET", H, path]]);
    const c = parse(cur);
    if (!c || c._del) return { ok: false };
    doc = { ...c, ...data, _u: now };
  }
  const [, v] = await redis([["HSET", H, path, JSON.stringify(doc)], ["INCR", VER]]);
  return { ok: true, v };
}

// ---------- one-time import of the old Blob snapshot ----------
async function readBlobSnapshot() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const { blobs } = await list({ prefix: "db/", limit: 100 });
  if (!blobs.length) return { jobs: {}, tasks: {} };
  const out = { jobs: {}, tasks: {} };
  const newer = (a, b) => (!a ? b : (b?._u || 0) > (a._u || 0) ? b : a);
  for (const b of blobs) {
    const r = await get(b.pathname, { access: "private", useCache: false });
    if (!r || r.statusCode !== 200) throw new Error("blob read failed");
    const d = JSON.parse(await new Response(r.stream).text());
    for (const [id, x] of Object.entries(d.jobs || {})) out.jobs[id] = newer(out.jobs[id], x);
    for (const [j, ts] of Object.entries(d.tasks || {}))
      for (const [id, x] of Object.entries(ts)) (out.tasks[j] ||= {})[id] = newer(out.tasks[j]?.[id], x);
  }
  return out;
}

export async function maybeMigrate(force = false) {
  const [done] = await redis([["EXISTS", MIG]]);
  if (Number(done)) return "done";
  if (!force) {
    const [got] = await redis([["SET", MIGTRY, "1", "NX", "EX", "3600"]]);
    if (got !== "OK") return "waiting";
  }
  let snap;
  try {
    snap = await Promise.race([readBlobSnapshot(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 9000))]);
  } catch (e) {
    console.error("old data import not possible yet:", e?.message);
    return "locked";
  }
  if (!snap) { await redis([["SET", MIG, "no-blob"]]); return "done"; }
  const [flat] = await redis([["HGETALL", H]]);
  const cur = {};
  for (let i = 0; i < (flat || []).length; i += 2) cur[flat[i]] = parse(flat[i + 1]);
  const cmds = [];
  const take = (path, d) => {
    if (!d || d._del) return;
    const c = cur[path];
    if (!c || (d._u || 0) > (c._u || 0)) cmds.push(["HSET", H, path, JSON.stringify(d)]);
  };
  for (const [id, d] of Object.entries(snap.jobs)) take(`jobs/${id}`, d);
  for (const [j, ts] of Object.entries(snap.tasks)) for (const [id, d] of Object.entries(ts)) take(`jobs/${j}/tasks/${id}`, d);
  cmds.push(["SET", MIG, String(Date.now())], ["INCR", VER]);
  await redis(cmds);
  console.log(`imported ${cmds.length - 2} records from the old storage`);
  return "imported";
}

// Strip storage-only fields before sending to the app.
export const clean = (d) => {
  if (!d || d._del) return null;
  const { _u, _del, ...rest } = d;
  return rest;
};
