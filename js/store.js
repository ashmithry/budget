// Saved state lives on the device (localStorage). Every record has an id and updatedAt so two devices can merge.
import { today } from "./dates.js";
import { DEFAULT_CATS, autoRun, uid } from "./engine.js";

const KEY = "budget:v1";
const COLLECTIONS = ["tx", "income", "bills", "goals", "cats", "wish", "rules"];

export function freshState() {
  const now = Date.now();
  return {
    v: 1,
    settings: {
      name: "",
      currency: "$",
      wage: 0,
      payType: "",
      taxPct: 20,
      buffer: 20,
      coolHours: 48,
      bigPurchase: 25,
      theme: "auto",
      badge: false,
      onboarded: false,
      startDate: today(),
      anchor: { amount: 0, date: today(), ts: now },
      updatedAt: 0,
    },
    tx: [],
    income: [],
    bills: [],
    goals: [],
    cats: DEFAULT_CATS.map((c, i) => ({ ...c, order: i, updatedAt: 0 })),
    wish: [],
    rules: [],
    days: {},
    meta: { rev: 0, lastSync: 0, ackSeq: 0, dirty: false },
  };
}

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const f = freshState();
      for (const k of Object.keys(f)) if (s[k] === undefined) s[k] = f[k];
      s.settings = { ...f.settings, ...s.settings };
      s.meta = { ...f.meta, ...s.meta };
      return s;
    }
  } catch (e) {
    if (typeof localStorage !== "undefined") console.warn("load failed", e);
  }
  return freshState();
}

export const get = () => state;
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));

let saveTimer = null;
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("save failed", e);
  }
}
// sync: true means "this is a user change that should be uploaded". Sync's own bookkeeping passes false,
// so it never schedules another sync (that was an endless loop).
export function commit({ silent = false, sync = true } = {}) {
  if (sync) {
    state.meta.dirty = true;
    state.meta.gen = (state.meta.gen || 0) + 1;
  }
  persist();
  clearTimeout(saveTimer);
  if (!silent) for (const fn of listeners) fn(state, { sync });
}

export function replaceState(s, { sync = false } = {}) {
  state = s;
  commit({ sync });
}

/* ---------- record helpers ---------- */
export function put(coll, item) {
  const arr = state[coll];
  const now = Date.now();
  if (!item.id) item.id = uid();
  item.updatedAt = now;
  const i = arr.findIndex((x) => x.id === item.id);
  if (i >= 0) arr[i] = { ...arr[i], ...item };
  else arr.push({ ts: now, ...item });
  commit();
  return item;
}
export function remove(coll, id) {
  const arr = state[coll];
  const i = arr.findIndex((x) => x.id === id);
  if (i >= 0) arr[i] = { id, deleted: true, updatedAt: Date.now(), date: arr[i].date };
  commit();
}
export function setSettings(patch) {
  state.settings = { ...state.settings, ...patch, updatedAt: Date.now() };
  commit();
}

export function runAutomation() {
  const before = JSON.stringify(exportable());
  const events = autoRun(state);
  // Only upload when automation actually changed something (it runs every minute and on every open).
  commit({ silent: true, sync: JSON.stringify(exportable()) !== before });
  return events;
}

/* ---------- merging two copies (this device + the cloud) ---------- */
// A delete always wins (nothing can be undeleted), otherwise the newer edit wins.
const newer = (x, y) => {
  if (x.deleted !== y.deleted) return x.deleted ? x : y;
  return (x.updatedAt || 0) > (y.updatedAt || 0) ? x : y;
};
export function mergeStates(a, b) {
  return mergeInfo(a, b).state;
}
// Also reports whether `a` (this device) had anything `b` (the cloud) lacks, i.e. whether an upload is needed.
export function mergeInfo(a, b) {
  const out = { ...a };
  let aWins = false;
  for (const c of COLLECTIONS) {
    const map = new Map();
    for (const x of b[c] || []) map.set(x.id, x);
    for (const x of a[c] || []) {
      const cur = map.get(x.id);
      if (!cur) { map.set(x.id, x); aWins = true; continue; }
      const w = newer(x, cur);
      if (w === x && (x.updatedAt !== cur.updatedAt || x.deleted !== cur.deleted)) aWins = true;
      map.set(x.id, w);
    }
    out[c] = [...map.values()];
  }
  const aSet = a.settings?.updatedAt || 0;
  const bSet = b.settings?.updatedAt || 0;
  out.settings = bSet > aSet ? { ...a.settings, ...b.settings } : a.settings;
  if (aSet > bSet) aWins = true;
  out.days = { ...(b.days || {}), ...(a.days || {}) };
  for (const k of Object.keys(a.days || {})) if (!(b.days || {})[k]) aWins = true;
  return { state: out, aWins };
}

// What goes to the cloud (encrypted): everything except this device's sync bookkeeping.
export function exportable(s = state) {
  const { meta, ...rest } = s;
  return rest;
}
