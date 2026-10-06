import { authed, json, unauthorized } from "../lib/http.js";
import { load, mutate, clean, DOC_RE, COL_RE } from "../lib/store.js";

// GET ?col=jobs | ?col=jobs/<id>/tasks  -> {docs:[{id,data}]}
// GET ?doc=jobs/<id>[/tasks/<tid>]       -> {data|null}
export async function GET(request) {
  if (!authed(request)) return unauthorized();
  const q = new URL(request.url).searchParams;
  const { db } = await load();
  const col = q.get("col"), doc = q.get("doc");
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
  try {
    const ok = await mutate((db) => {
      const bucket = taskId ? (db.tasks[jobId] ||= {}) : db.jobs;
      const key = taskId || jobId;
      const cur = bucket[key];
      const now = Date.now();
      if (op === "delete") { bucket[key] = { _del: true, _u: now }; return true; }
      if (op === "update") {
        if (!cur || cur._del) return false;
        bucket[key] = { ...cur, ...data, _u: now };
        return true;
      }
      bucket[key] = { ...data, _u: now };
      return true;
    });
    if (!ok) return json({ error: "Document does not exist.", code: "invalid_argument" }, 404);
    return json({ ok: true });
  } catch (e) {
    console.error("db write failed", e);
    return json({ error: "Storage is unavailable. Try again.", code: "unavailable" }, 503);
  }
}
