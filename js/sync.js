// Cloud sync, end-to-end encrypted.
// Your sync key never leaves your devices. From it we derive:
//   token  -> identifies your cloud copy, and lets Shortcuts/widgets post spending and read the widget numbers
//   AES key -> encrypts your full budget before upload (the server only ever sees ciphertext)
import { get, commit, mergeStates, exportable, replaceState } from "./store.js";
import { snapshot } from "./engine.js";

const SUPABASE = "https://uwpyztvtwubbteftflbu.supabase.co/rest/v1/rpc/";
const SB_KEY = "sb_publishable_m3wgNay9L6q8QllOggLDuA_UMzzki49"; // publishable key: it can only call the budget_* functions
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

async function rpc(fn, body) {
  const r = await fetch(SUPABASE + fn, {
    method: "POST",
    headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${fn} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

export function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s.match(/.{1,5}/g).join("-"); // XXXXX-XXXXX-XXXXX-XXXXX
}
export const cleanKey = (k) => String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const validKey = (k) => cleanKey(k).length >= 16;

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function tokenFor(key) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode("budget-token:" + cleanKey(key)))).slice(0, 40);
}
async function aesKey(key) {
  const base = await crypto.subtle.importKey("raw", enc.encode(cleanKey(key)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: enc.encode("budget-vault-v1"), iterations: 150000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

const b64 = (u8) => {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function gz(bytes, mode) {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([bytes]).stream().pipeThrough(mode === "c" ? new CompressionStream("gzip") : new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

let keyCache = { key: null, aes: null, token: null };
async function keys() {
  const k = get().meta.key;
  if (!k) return null;
  if (keyCache.key !== k) keyCache = { key: k, aes: await aesKey(k), token: await tokenFor(k) };
  return keyCache;
}

async function encrypt(obj, aes) {
  let bytes = enc.encode(JSON.stringify(obj));
  let tag = "j";
  const z = await gz(bytes, "c");
  if (z) { bytes = z; tag = "z"; }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return `v1${tag}:${b64(out)}`;
}
async function decrypt(str, aes) {
  const [head, body] = str.split(":");
  const raw = unb64(body);
  let bytes = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, aes, raw.slice(12)));
  if (head === "v1z") bytes = await gz(bytes, "d");
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Turns a Shortcut / widget log into a transaction. Same inbox item always gives the same id.
function inboxTx(row) {
  const it = row.item || {};
  const at = Number(it.at) || row.at || Date.now();
  const d = new Date(at);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const h = d.getHours();
  return {
    id: `in:${row.seq}`,
    kind: it.kind === "income" ? "income" : "expense",
    amount: Math.abs(Number(it.amount) || 0) * (it.refund ? -1 : 1),
    note: String(it.merchant || it.note || "").slice(0, 80),
    cat: it.cat || null,
    card: it.card ? String(it.card).slice(0, 40) : undefined,
    date: day,
    ts: at,
    updatedAt: at,
    source: it.source === "applepay" ? "applepay" : "shortcut",
    late: h >= 22 || h < 4,
    review: true, // shows in "Check these" on Home until you look at it
  };
}

let running = null;
export function sync(opts) {
  if (!running) running = doSync(opts).finally(() => (running = null));
  return running;
}

async function doSync({ onInbox } = {}) {
  const k = await keys();
  if (!k) return { ok: false, reason: "off" };
  const s = get();
  const pulled = await rpc("budget_pull", { p_token: k.token, p_have_rev: s.meta.rev || 0 });
  let changed = false;
  if (pulled.cipher && pulled.rev !== s.meta.rev) {
    const remote = await decrypt(pulled.cipher, k.aes);
    const merged = mergeStates(get(), remote);
    merged.meta = { ...get().meta, rev: pulled.rev };
    replaceState(merged);
    changed = true;
  } else if (pulled.rev !== s.meta.rev) {
    get().meta.rev = pulled.rev;
  }
  let maxSeq = 0;
  const added = [];
  for (const row of pulled.inbox || []) {
    maxSeq = Math.max(maxSeq, row.seq);
    const tx = inboxTx(row);
    if (!(tx.amount > 0 || tx.amount < 0)) continue;
    if (get().tx.some((x) => x.id === tx.id)) continue;
    get().tx.push(tx);
    added.push(tx);
  }
  if (added.length && onInbox) onInbox(added); // lets the app auto-categorize before saving
  if (added.length || maxSeq) changed = true;

  if (changed || get().meta.dirty || !get().meta.lastSync) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cipher = await encrypt(exportable(get()), k.aes);
      const res = await rpc("budget_push", { p_token: k.token, p_cipher: cipher, p_base_rev: get().meta.rev || 0, p_snapshot: snapshot(get()), p_ack_seq: maxSeq });
      if (res.ok) {
        get().meta.rev = res.rev;
        get().meta.dirty = false;
        break;
      }
      // Someone else (another device) saved first: merge their copy in and try again.
      const again = await rpc("budget_pull", { p_token: k.token, p_have_rev: -1 });
      if (again.cipher) {
        const merged = mergeStates(get(), await decrypt(again.cipher, k.aes));
        merged.meta = { ...get().meta, rev: again.rev };
        replaceState(merged);
      } else get().meta.rev = again.rev;
    }
  }
  get().meta.lastSync = Date.now();
  commit({ sync: false });
  return { ok: true, added: added.length };
}

// Push just the widget numbers (cheap; after each change so the widget stays current).
export async function pushSnapshotSoon() {
  clearTimeout(pushSnapshotSoon.t);
  pushSnapshotSoon.t = setTimeout(() => sync().catch((e) => console.warn("sync", e)), 1500);
}

export async function currentToken() {
  const k = await keys();
  return k ? k.token : null;
}

export async function deleteCloud() {
  const k = await keys();
  if (!k) return;
  await rpc("budget_forget", { p_token: k.token });
}
