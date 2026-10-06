// Tiny document store on Vercel Blob (private).
// The whole database is one JSON snapshot written under a new, unique name on
// every change, so reads are never served stale from a cache. Each document
// carries `_u` (last-updated ms) and deletions are kept as tombstones, so two
// snapshots written at the same moment by different phones are merged
// field-for-field by "latest update wins" on the next read.
import { put, list, get, del } from "@vercel/blob";
import crypto from "node:crypto";

const PREFIX = "db/";
const TOMBSTONE_DAYS = 30;
const SEG = "[A-Za-z0-9_\\-.~:@+]{1,200}";
export const DOC_RE = new RegExp(`^jobs/(${SEG})(?:/tasks/(${SEG}))?$`);
export const COL_RE = new RegExp(`^jobs(?:/(${SEG})/tasks)?$`);

const empty = () => ({ jobs: {}, tasks: {} });

function newer(a, b) {
  if (!a) return b;
  if (!b) return a;
  return (b._u || 0) > (a._u || 0) ? b : a;
}

function merge(a, b) {
  const out = { jobs: { ...a.jobs }, tasks: {} };
  for (const [id, d] of Object.entries(b.jobs || {})) out.jobs[id] = newer(out.jobs[id], d);
  const jobIds = new Set([...Object.keys(a.tasks || {}), ...Object.keys(b.tasks || {})]);
  for (const j of jobIds) {
    const m = { ...(a.tasks?.[j] || {}) };
    for (const [id, d] of Object.entries(b.tasks?.[j] || {})) m[id] = newer(m[id], d);
    out.tasks[j] = m;
  }
  return out;
}

function seed() {
  // One-time import of existing records, supplied privately via env var.
  try {
    const s = JSON.parse(process.env.SEED_JSON || "null");
    if (!s) return empty();
    const db = empty();
    const now = Date.now();
    for (const [id, d] of Object.entries(s.jobs || {})) db.jobs[id] = { ...d, _u: d._u || now };
    for (const [j, ts] of Object.entries(s.tasks || {})) {
      db.tasks[j] = {};
      for (const [id, d] of Object.entries(ts)) db.tasks[j][id] = { ...d, _u: d._u || now };
    }
    return db;
  } catch {
    return empty();
  }
}

async function readJSON(pathname) {
  try {
    const r = await get(pathname, { access: "private", useCache: false });
    if (!r || r.statusCode !== 200) return null;
    return JSON.parse(await new Response(r.stream).text());
  } catch (e) {
    console.error("read failed", pathname, e?.message);
    return null;
  }
}

let memo = { key: "", db: null };

export async function load() {
  const { blobs } = await list({ prefix: PREFIX, limit: 1000 });
  const key = blobs.map((b) => b.pathname).sort().join("|");
  if (key && memo.key === key && memo.db) return { db: structuredClone(memo.db), read: blobs };
  let db = blobs.length ? empty() : seed();
  for (const b of blobs) {
    const d = await readJSON(b.pathname);
    if (d) db = merge(db, d);
  }
  memo = { key, db: structuredClone(db) };
  return { db, read: blobs };
}

function prune(db) {
  const cutoff = Date.now() - TOMBSTONE_DAYS * 864e5;
  for (const [id, d] of Object.entries(db.jobs)) if (d._del && d._u < cutoff) delete db.jobs[id];
  for (const ts of Object.values(db.tasks))
    for (const [id, d] of Object.entries(ts)) if (d._del && d._u < cutoff) delete ts[id];
}

export async function mutate(fn) {
  const { db, read } = await load();
  const result = fn(db);
  prune(db);
  const name = `${PREFIX}${Date.now()}-${crypto.randomBytes(4).toString("hex")}.json`;
  await put(name, JSON.stringify(db), { access: "private", contentType: "application/json", addRandomSuffix: false });
  if (read.length) await del(read.map((b) => b.url));
  memo = { key: "", db: null };
  return result;
}

// Strip storage-only fields before sending to the app.
export const clean = (d) => {
  if (!d || d._del) return null;
  const { _u, _del, ...rest } = d;
  return rest;
};
