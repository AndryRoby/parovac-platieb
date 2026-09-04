// licence.js: ARLing licence verification for Párovač platieb Pro.
// Byte-identical mechanism to the sibling SEPA pain.001 Generátor's own
// licence.js (same public key, same signature/plan/expiry checks); only
// DEFAULT_PLAN and STORAGE_KEY below differ, so each tool's Pro licence is
// scoped to that tool alone even though both verify against the same
// ARLing licence service.
//
// A licence key is base64url(payload_json) + "." + base64url(ed25519_sig),
// where payload_json is the *exact* bytes the licence service signed —
// {"e":"YYYY-MM-DD","m":"<sha256(email)[:16]>","p":"<plan>","s":"<session
// suffix>"}, JSON with sorted keys and no separator whitespace (Python:
// json.dumps(payload, separators=(",", ":"), sort_keys=True)). See
// ../licence-service/app.py (make_licence) for the signing side.
//
// Verification runs entirely client-side via WebCrypto (globalThis.crypto.
// subtle), against a public key baked into this file below — the private
// key never leaves the licence service. Confirmed to work unchanged in
// both a browser and Node 20+ (globalThis.crypto.subtle supports the
// "Ed25519" algorithm identifier in both; Node currently logs an
// "ExperimentalWarning" to stderr the first time it's used, which is
// harmless and does not affect the result).
//
// Zero dependencies: no import from generator-pain001.js or doctor-
// pain001.js, and nothing here ever makes a network request except
// claim(), which is a plain GET to the licence service.
//
// Works as an ES module (import { parse, verify, isValid, load, save,
// clear, claim } from './licence.js') and, when loaded in a browser via
// <script type="module">, also publishes window.ArlingLicence with the
// same functions for console/debug use.

// Ed25519 public key of the ARLing licence service, base64url raw 32
// bytes (GET https://homelab.tailbf8f27.ts.net/licence/api/pubkey serves
// the same value). Baked in here rather than fetched: verification must
// keep working even if the licence service is briefly unreachable.
const PUBKEY_B64URL = 'xcMFelDwaZ1DC7ObQTKi8zXPvMlrTAlgZySNpfuYbC8';

export const CLAIM_URL = 'https://homelab.tailbf8f27.ts.net/licence/api/claim';
export const DEFAULT_PLAN = 'sepa-pro';
export const STORAGE_KEY = 'arling_licence_sepa-pro';

// ─────────────────────────── base64url helpers ────────────────────────────
// atob/btoa are global in both browsers and Node 20+; TextEncoder/
// TextDecoder likewise. No Buffer, so this file stays identical in both
// environments (same reasoning as generator-pain001.js's own helpers).

function b64uToBytes(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const padded = s.length % 4 === 0 ? s : s + '='.repeat(4 - (s.length % 4));
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64u(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const PUBKEY_BYTES = b64uToBytes(PUBKEY_B64URL);

// ─────────────────────────────── date helper ───────────────────────────────

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Today as YYYY-MM-DD (local time), matching the licence's "e" format. */
export function todayIso(base) {
  const d = base instanceof Date ? base : new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// ──────────────────────────────── parsing ───────────────────────────────────

/**
 * Splits a licence key into its payload (parsed JSON + the exact bytes
 * that were signed) and its signature bytes. Returns null for anything
 * malformed — never throws. Verification (verify/isValid) always runs
 * against `payloadBytes`, the bytes as received, not a re-serialization
 * of `payload` — a signature is only ever valid over the exact bytes the
 * server signed.
 * @param {string} licenceKey
 * @returns {{payload:Object, payloadBytes:Uint8Array, sigBytes:Uint8Array, raw:string}|null}
 */
export function parse(licenceKey) {
  if (typeof licenceKey !== 'string') return null;
  const key = licenceKey.trim();
  const parts = key.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  let payloadBytes, sigBytes;
  try {
    payloadBytes = b64uToBytes(parts[0]);
    sigBytes = b64uToBytes(parts[1]);
  } catch (e) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch (e) {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.p !== 'string' || typeof payload.e !== 'string') return null;
  return { payload, payloadBytes, sigBytes, raw: key };
}

// ────────────────────────────── verification ────────────────────────────────

let cachedPubKey = null;
// `rawOverride` (Uint8Array, raw 32-byte Ed25519 public key) exists so
// tests.mjs can verify a *self-signed* fixture licence end-to-end through
// this exact function without the real private key (which never leaves
// the licence service) — and, symmetrically, prove that a licence signed
// by any other keypair is rejected against the real embedded key. Calling
// verify()/isValid() with no override (every real caller) always checks
// against PUBKEY_BYTES; only an explicit override bypasses that, so this
// is not a backdoor for production use.
async function importPubKey(rawOverride) {
  if (!rawOverride) {
    if (cachedPubKey) return cachedPubKey;
    cachedPubKey = await crypto.subtle.importKey('raw', PUBKEY_BYTES, { name: 'Ed25519' }, false, ['verify']);
    return cachedPubKey;
  }
  return crypto.subtle.importKey('raw', rawOverride, { name: 'Ed25519' }, false, ['verify']);
}

/**
 * True if this runtime's WebCrypto can do Ed25519 at all (older Safari
 * cannot). Cheap after the first call: reuses the same imported key as
 * verify().
 */
export async function ed25519Supported() {
  try {
    await importPubKey();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Verifies the Ed25519 signature only (not plan/expiry — see isValid for
 * that). Accepts either a licence key string or an already-parse()d
 * object.
 * @param {string|Object} licenceKeyOrParsed
 * @param {Uint8Array} [pubKeyBytes] Test-only override — see importPubKey.
 * @returns {Promise<boolean>}
 * @throws {Error} with .code === 'unsupported' when this runtime's
 *   WebCrypto cannot do Ed25519 (e.g. Safari < 17).
 */
export async function verify(licenceKeyOrParsed, pubKeyBytes) {
  const parsed = typeof licenceKeyOrParsed === 'string' ? parse(licenceKeyOrParsed) : licenceKeyOrParsed;
  if (!parsed) return false;
  let key;
  try {
    key = await importPubKey(pubKeyBytes);
  } catch (e) {
    throw Object.assign(new Error('Ed25519 nie je v tomto prehliadači podporovaný cez WebCrypto.'), { code: 'unsupported', cause: e });
  }
  return crypto.subtle.verify('Ed25519', key, parsed.sigBytes, parsed.payloadBytes);
}

/**
 * Full check: signature + plan + expiry (>= today, inclusive).
 * @param {string|Object} licenceKeyOrParsed
 * @param {{plan?:string, today?:string, pubKey?:Uint8Array}} [opts] `pubKey`
 *   is the same test-only override as verify()'s second argument.
 * @returns {Promise<{valid:boolean, reason:string, payload:Object|null}>}
 *   reason is one of: 'ok', 'malformed', 'unsupported', 'signature',
 *   'plan', 'expired'.
 */
export async function isValid(licenceKeyOrParsed, opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const plan = typeof options.plan === 'string' ? options.plan : DEFAULT_PLAN;
  const today = typeof options.today === 'string' ? options.today : todayIso();

  const parsed = typeof licenceKeyOrParsed === 'string' ? parse(licenceKeyOrParsed) : licenceKeyOrParsed;
  if (!parsed) return { valid: false, reason: 'malformed', payload: null };

  let sigOk;
  try {
    sigOk = await verify(parsed, options.pubKey);
  } catch (e) {
    return { valid: false, reason: 'unsupported', payload: parsed.payload };
  }
  if (!sigOk) return { valid: false, reason: 'signature', payload: parsed.payload };
  if (parsed.payload.p !== plan) return { valid: false, reason: 'plan', payload: parsed.payload };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.payload.e) || parsed.payload.e < today) {
    return { valid: false, reason: 'expired', payload: parsed.payload };
  }
  return { valid: true, reason: 'ok', payload: parsed.payload };
}

// ────────────────────────────── local storage ────────────────────────────────
// Wrapped in try/catch throughout: localStorage can throw (private
// browsing in old Safari, site data blocked) as well as simply not exist.

function hasLocalStorage() {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch (e) {
    return false;
  }
}

/** @returns {string|null} the stored licence key, or null if there is none. */
export function load() {
  if (!hasLocalStorage()) return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    return null;
  }
}

/** @returns {boolean} true if the key was written. */
export function save(licenceKey) {
  if (!hasLocalStorage()) return false;
  try {
    localStorage.setItem(STORAGE_KEY, String(licenceKey));
    return true;
  } catch (e) {
    return false;
  }
}

/** @returns {boolean} true if a stored key was removed (or none was set). */
export function clear() {
  if (!hasLocalStorage()) return false;
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (e) {
    return false;
  }
}

// ─────────────────────────────────── claim ───────────────────────────────────

/**
 * Turns a paid Stripe Checkout session id into a licence key by calling
 * the licence service. Never throws: network/parse failures come back as
 * {ok:false, error:'network'} so callers can render a message either way.
 * @param {string} sessionId Stripe Checkout Session id ("cs_...").
 * @returns {Promise<{ok:boolean, licence?:string, plan?:string, exp?:string, error?:string}>}
 */
export async function claim(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return { ok: false, error: 'invalid' };
  try {
    const res = await fetch(CLAIM_URL + '?session_id=' + encodeURIComponent(sid), { method: 'GET' });
    const data = await res.json();
    return data && typeof data === 'object' ? data : { ok: false, error: 'invalid_response' };
  } catch (e) {
    return { ok: false, error: 'network' };
  }
}

// Also expose as a plain browser global when loaded via <script type="module">.
if (typeof window !== 'undefined') {
  window.ArlingLicence = { parse, verify, isValid, load, save, clear, claim, ed25519Supported, todayIso, DEFAULT_PLAN, STORAGE_KEY, CLAIM_URL };
}
