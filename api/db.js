import { authed, isAdmin, adminOnly, json, unauthorized } from "../lib/http.js";

// Fields anyone may change on a job: the summary the app keeps up to date when tasks are saved.
const SUMMARY = new Set(["taskCount", "notOk", "lastDate", "updatedAt"]);
import { load, write, version, configured, clean, DOC_RE, COL_RE } from "../lib/store.js";

// GET ?col=jobs | ?col=jobs/<id>/tasks  -> {docs:[{id,data}]}
// GET ?doc=jobs/<id>[/tasks/<tid>]       -> {data|null}
export async function GET(request) {
  if (!authed(request)) return unauthorized();
  const q = new URL(request.url).searchParams;
  if (!configured()) return json({ error: "The database is not connected yet.", code: "not_configured" }, 503);
  if (q.get("ver")) {
    // Cheap change check, shared by all phones through the CDN for 15 seconds.
    try {
      const v = await version();
      return new Response(JSON.stringify(v), { headers: { "content-type": "application/json", "cache-control": "public, max-age=0, s-maxage=15, stale-while-revalidate=30" } });
    } catch (e) { console.error("version failed", e); return json({ error: "Storage is unavailable.", code: "unavailable" }, 503); }
  }
  let db;
  try { ({ db } = await load()); }
  catch (e) { console.error("load failed", e); return json({ error: "Storage is unavailable. Try again.", code: "unavailable" }, 503); }
  const col = q.get("col"), doc = q.get("doc");
  if (q.get("all")) {
    // Everything at once, for the Overview dashboard.
    const jobs = Object.entries(db.jobs).map(([id, d]) => ({ id, data: clean(d) })).filter((d) => d.data);
    const live = new Set(jobs.map((j) => j.id));
    const tasks = [];
    for (const [jobId, ts] of Object.entries(db.tasks)) {
      if (!live.has(jobId)) continue;
      for (const [id, d] of Object.entries(ts)) { const c = clean(d); if (c) tasks.push({ jobId, id, data: c }); }
    }
    return json({ jobs, tasks });
  }
  if (col) {
    const m = col.match(COL_RE);
    if (!m) return json({ error: "Bad collection path.", code: "invalid_argument" }, 400);
    const src = m[1] ? db.tasks[m[1]] || {} : db.jobs;
    const docs = Object.entries(src).map(([id, d]) => ({ id, data: clean(d) })).filter((d) => d.data);
    return json({ docs });
  }
  if (doc) {
    const m = doc.match(DOC_RE);
    if (!m) return json({ error: "Bad document path.", code: "invalid_argument" }, 400);
    const d = m[2] ? db.tasks[m[1]]?.[m[2]] : db.jobs[m[1]];
    return json({ data: clean(d) });
  }
  return json({ error: "Missing col or doc.", code: "invalid_argument" }, 400);
}

// POST {op: set|update|delete, path, data}
export async function POST(request) {
  if (!authed(request)) return unauthorized();
  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad JSON.", code: "invalid_argument" }, 400); }
  const { op, path, data } = body || {};
  const m = typeof path === "string" && path.match(DOC_RE);
  if (!m || !["set", "update", "delete"].includes(op)) return json({ error: "Bad request.", code: "invalid_argument" }, 400);
  if (op !== "delete" && (!data || typeof data !== "object" || Array.isArray(data)))
    return json({ error: "Data must be an object.", code: "invalid_argument" }, 400);
  if (JSON.stringify(data || {}).length > 200_000) return json({ error: "Too large.", code: "invalid_argument" }, 413);

  const [, jobId, taskId] = m;
  if (!isAdmin(request)) {
    if (op === "delete") return adminOnly();
    if (!taskId && op === "set") return adminOnly();
    if (!taskId && op === "update" && Object.keys(data).some((k) => !SUMMARY.has(k))) return adminOnly();
  }
  try {
    const r = await write(op, path, data);
    const ok = r.ok;
    if (!ok) return json({ error: "Document does not exist.", code: "invalid_argument" }, 404);
    return json({ ok: true, v: r.v });
  } catch (e) {
    console.error("db write failed", e);
    return json({ error: "Storage is unavailable. Try again.", code: "unavailable" }, 503);
  }
}
