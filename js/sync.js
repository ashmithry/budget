// Cloud sync, end-to-end encrypted.
// Your sync key never leaves your devices. From it we derive three things:
//   sync token -> owns your cloud copy (download, upload, delete). Never shown or put in a link.
//   link token -> goes in Shortcut / widget links. It can only add spending and read today's numbers.
//   AES key    -> encrypts your full budget before upload (the server only ever sees ciphertext).
import { get, commit, mergeInfo, exportable, replaceState } from "./store.js";
import { snapshot, guessCategory, live } from "./engine.js";
import { today } from "./dates.js";

const SUPABASE = "https://uwpyztvtwubbteftflbu.supabase.co/rest/v1/rpc/";
const SB_KEY = "sb_publishable_m3wgNay9L6q8QllOggLDuA_UMzzki49"; // publishable key: it can only call the budget_* functions
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const KEY_LEN = 20;

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
  // Rejection sampling so every character is equally likely.
  let s = "";
  while (s.length < KEY_LEN) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < 248 && s.length < KEY_LEN) s += ALPHABET[b % ALPHABET.length];
    }
  }
  return formatKey(s);
}
export const cleanKey = (k) => String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const formatKey = (k) => cleanKey(k).match(/.{1,5}/g).join("-");
export const validKey = (k) => {
  const c = cleanKey(k);
  return c.length === KEY_LEN && [...c].every((ch) => ALPHABET.includes(ch));
};

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const derive = async (label, key) => hex(await crypto.subtle.digest("SHA-256", enc.encode(label + cleanKey(key)))).slice(0, 40);
export const linkTokenFor = (key) => derive("budget-token:", key);
export const syncTokenFor = (key) => derive("budget-sync:", key);

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
  if (typeof CompressionStream === "undefined" || typeof DecompressionStream === "undefined") return null;
  const stream = new Blob([bytes]).stream().pipeThrough(mode === "c" ? new CompressionStream("gzip") : new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

let keyCache = { key: null };
async function keys(k = get().meta.key) {
  if (!k) return null;
  if (keyCache.key !== k) keyCache = { key: k, aes: await aesKey(k), sync: await syncTokenFor(k), link: await linkTokenFor(k) };
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
  if (head === "v1z") {
    bytes = await gz(bytes, "d");
    if (!bytes) throw new Error("This browser can't unpack the cloud copy. Update iOS / your browser.");
  }
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
  };
}

// Files new auto-logged purchases: merchants you've categorized before are filed silently,
// new ones wait in "Check these" on Home.
function fileInbox(txs) {
  for (const tx of txs) {
    if (tx.kind !== "expense") { tx.cat = "income"; tx.review = false; continue; }
    // Taps on your parents' card (matched by the card name you set) count toward their weekly limit.
    const hint = String(get().settings.parentsCard || "").trim().toLowerCase();
    if (hint && String(tx.card || "").toLowerCase().includes(hint)) tx.wallet = "parents";
    if (!tx.cat) tx.cat = guessCategory(get(), tx.note);
    const name = (tx.note || "").toLowerCase();
    const known = name && live(get().tx).some((x) => x !== tx && x.kind === "expense" && !x.review && (x.note || "").toLowerCase() === name);
    tx.review = !known || !tx.cat;
    if (!tx.cat) tx.cat = "other";
  }
}

let running = null;
let again = false;
// Runs one sync at a time. A sync requested while one is running runs once more afterwards.
export function sync() {
  if (running) { again = true; return running; }
  running = doSync().finally(() => {
    running = null;
    if (again) { again = false; sync().catch(() => {}); }
  });
  return running;
}

async function doSync() {
  const k = await keys();
  if (!k) return { ok: false, reason: "off" };
  const t = today();
  const pulled = await rpc("budget_pull", { p_token: k.sync, p_have_rev: get().meta.rev || 0 });
  let needPush = !get().meta.lastSync || get().meta.dirty;
  if (pulled.cipher && pulled.rev !== get().meta.rev) {
    const { state: merged, aWins } = mergeInfo(get(), await decrypt(pulled.cipher, k.aes));
    merged.meta = { ...get().meta, rev: pulled.rev };
    replaceState(merged, { sync: false });
    if (aWins) needPush = true;
  } else if (pulled.rev !== get().meta.rev) {
    get().meta.rev = pulled.rev;
    needPush = true;
  }
  let maxSeq = 0;
  const added = [];
  for (const row of pulled.inbox || []) {
    maxSeq = Math.max(maxSeq, row.seq);
    const tx = inboxTx(row);
    if (!tx.amount) continue;
    if (get().tx.some((x) => x.id === tx.id)) continue;
    get().tx.push(tx);
    added.push(tx);
  }
  fileInbox(added);
  // A purchase from an earlier day changes what today's allowance should have been.
  if (added.some((x) => x.date < t) && get().days) delete get().days[t];
  if (maxSeq) needPush = true;

  if (needPush) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const gen = get().meta.gen || 0;
      const cipher = await encrypt(exportable(get()), k.aes);
      const res = await rpc("budget_push", { p_token: k.sync, p_link_token: k.link, p_cipher: cipher, p_base_rev: get().meta.rev || 0, p_snapshot: snapshot(get()), p_ack_seq: maxSeq });
      if (res.ok) {
        get().meta.rev = res.rev;
        // Only clear "dirty" if nothing changed while we were uploading.
        if ((get().meta.gen || 0) === gen) get().meta.dirty = false;
        break;
      }
      // Another device saved first: merge their copy in and try again.
      const latest = await rpc("budget_pull", { p_token: k.sync, p_have_rev: -1 });
      if (latest.cipher) {
        const { state: merged } = mergeInfo(get(), await decrypt(latest.cipher, k.aes));
        merged.meta = { ...get().meta, rev: latest.rev };
        replaceState(merged, { sync: false });
      } else get().meta.rev = latest.rev;
    }
  }
  get().meta.lastSync = Date.now();
  commit({ sync: false });
  return { ok: true, added: added.length };
}

// Upload soon after a change (debounced), so the widget and other devices stay current.
export function pushSoon() {
  clearTimeout(pushSoon.t);
  pushSoon.t = setTimeout(() => sync().catch((e) => console.warn("sync", e)), 1500);
}

// Link this device to an existing cloud copy. Refuses keys with no cloud copy behind them.
export async function linkDevice(key) {
  if (!validKey(key)) throw new Error("That key isn't complete. It's 20 letters and numbers.");
  const k = await keys(formatKey(key));
  const pulled = await rpc("budget_pull", { p_token: k.sync, p_have_rev: -1 });
  if (!pulled.cipher) throw new Error("No cloud copy found for that key. Check it on your other device under Automate, Show my key.");
  await decrypt(pulled.cipher, k.aes); // proves the key decrypts it before we switch over
  get().meta.key = formatKey(key);
  get().meta.rev = 0;
  commit({ sync: false });
  return sync();
}

export async function currentToken() {
  const k = await keys();
  return k ? k.link : null;
}

export async function deleteCloud() {
  const k = await keys();
  if (!k) return;
  await rpc("budget_forget", { p_token: k.sync });
}
