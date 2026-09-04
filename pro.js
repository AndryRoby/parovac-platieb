// pro.js: Párovač platieb Pro features — saved column-mapping presets,
// tolerance/date-window defaults, export formatted for import into
// Pohoda/Omega/Money S3, multi-statement merging, and match history.
//
// Pure, deterministic, 100% client-side: same "no npm dependency" spirit
// as parovac.js and camt053.js. The only cross-file dependency is toCsv()
// from parovac.js, which every export format below ultimately calls into.
//
// Storage (localStorage, wrapped in try/catch throughout — see
// hasLocalStorage below):
//   arling_parovac_pro_mapping_presets — user's own saved column mappings
//   arling_parovac_pro_settings        — saved tolerance / date-window defaults
//   arling_parovac_pro_history         — last HISTORY_MAX match runs
//
// Works as an ES module (import { ... } from './pro.js') and, when loaded
// in a browser via <script type="module">, also publishes
// window.ParovacPro with the same functions for console/debug use.

import { toCsv, DEFAULT_TOLERANCE, DEFAULT_DATE_WINDOW_DAYS } from './parovac.js';

// Purchase link. A Stripe Checkout link will replace this once set up; the
// page routes the "Kúpiť" button here unchanged otherwise.
export const BUY_URL = 'https://buy.stripe.com/5kQ4gt2jE7y354Cg8B4ko01';
export const BUY_URL_YEAR = 'https://buy.stripe.com/cNi9ANcYi19FaoW09D4ko02';

export const MAPPING_PRESET_KEY = 'arling_parovac_pro_mapping_presets';
export const SETTINGS_KEY = 'arling_parovac_pro_settings';
export const HISTORY_KEY = 'arling_parovac_pro_history';
export const HISTORY_MAX = 50;

function hasLocalStorage() {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch (e) {
    return false;
  }
}

function safeStr(v) {
  return typeof v === 'string' ? v : (v === null || v === undefined ? '' : String(v));
}

function randomId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// ═══════════════════════ saved column-mapping presets ══════════════════════
//
// Distinct from parovac.js's own INVOICE_TEMPLATES (built-in heuristic
// guesses per accounting program): a preset here is the user's *own*
// column mapping, saved once and reapplied on every recurring monthly
// import from the same export, without needing to remap column-by-column
// again or rely on a heuristic guessing right.

/** @returns {Array<{id:string, name:string, mapping:Object}>} */
export function loadMappingPresets() {
  if (!hasLocalStorage()) return [];
  try {
    const raw = localStorage.getItem(MAPPING_PRESET_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((p) => p && typeof p === 'object' && typeof p.id === 'string') : [];
  } catch (e) {
    return [];
  }
}

function saveMappingPresetsRaw(list) {
  if (!hasLocalStorage()) return false;
  try {
    localStorage.setItem(MAPPING_PRESET_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Adds a new mapping preset, or replaces one with the same id (edit path).
 * @param {{id?:string, name:string, mapping:Object}} preset
 * @returns {{ok:boolean, error?:string, preset?:Object}}
 */
export function saveMappingPreset(preset) {
  const p = preset && typeof preset === 'object' ? preset : {};
  const name = safeStr(p.name).trim();
  if (!name) return { ok: false, error: 'missing_name' };
  if (!p.mapping || typeof p.mapping !== 'object') return { ok: false, error: 'missing_mapping' };
  const entry = {
    id: (typeof p.id === 'string' && p.id) ? p.id : randomId('mapping'),
    name,
    mapping: Object.assign({}, p.mapping),
  };
  const list = loadMappingPresets();
  const idx = list.findIndex((x) => x.id === entry.id);
  if (idx >= 0) list[idx] = entry; else list.push(entry);
  saveMappingPresetsRaw(list);
  return { ok: true, preset: entry };
}

/** @returns {Array} the preset list after removal. */
export function removeMappingPreset(id) {
  const list = loadMappingPresets().filter((p) => p.id !== id);
  saveMappingPresetsRaw(list);
  return list;
}

// ═══════════════════════ tolerance / date-window defaults ══════════════════

/** @returns {{tolerance:number, dateWindowDays:number}} */
export function loadToleranceSettings() {
  const fallback = { tolerance: DEFAULT_TOLERANCE, dateWindowDays: DEFAULT_DATE_WINDOW_DAYS };
  if (!hasLocalStorage()) return fallback;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    const tolerance = Number(parsed && parsed.tolerance);
    const dateWindowDays = Number(parsed && parsed.dateWindowDays);
    return {
      tolerance: Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : fallback.tolerance,
      dateWindowDays: Number.isFinite(dateWindowDays) && dateWindowDays >= 0 ? dateWindowDays : fallback.dateWindowDays,
    };
  } catch (e) {
    return fallback;
  }
}

/** @returns {boolean} true if the settings were written. */
export function saveToleranceSettings(settings) {
  if (!hasLocalStorage()) return false;
  const s = settings && typeof settings === 'object' ? settings : {};
  const tolerance = Number(s.tolerance);
  const dateWindowDays = Number(s.dateWindowDays);
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      tolerance: Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : DEFAULT_TOLERANCE,
      dateWindowDays: Number.isFinite(dateWindowDays) && dateWindowDays >= 0 ? dateWindowDays : DEFAULT_DATE_WINDOW_DAYS,
    }));
    return true;
  } catch (e) {
    return false;
  }
}

// ═══════════════════ export for Pohoda / Omega / Money S3 ══════════════════
//
// A "mark as paid" CSV shaped for re-import into an accounting program's
// own payment-pairing screen: invoice number, VS, paid date, paid amount.
// None of Pohoda, Omega (KROS), or Money S3 documents a plain-CSV "mark
// this invoice paid" import format in their own vendor documentation (each
// primarily expects pairing through its own bank-statement/XML import
// screen); this is this tool's own reasonable column layout for that data,
// in each program's own header vocabulary, not a vendor-verified import
// spec. Labeled as such in the UI (see `note` below), same honesty
// standard as parovac.js's INVOICE_TEMPLATES.
export const MARK_PAID_EXPORT_FORMATS = {
  POHODA: {
    label: 'Pohoda (Stormware)',
    note: 'Vlastný stĺpcový formát tejto stránky pre spätné označenie faktúr ako uhradených, nie je to overený formát importu priamo od výrobcu. Pred importom skontrolujte, či ho Pohoda v danej verzii prijme, prípadne stĺpce premenujte.',
    columns: [
      { key: 'invoiceNumber', label: 'Číslo dokladu' },
      { key: 'vs', label: 'Variabilní symbol' },
      { key: 'paidDate', label: 'Datum úhrady' },
      { key: 'paidAmount', label: 'Uhrazená částka', amount: true },
    ],
  },
  OMEGA: {
    label: 'Omega (KROS)',
    note: 'Vlastný stĺpcový formát tejto stránky pre spätné označenie faktúr ako uhradených, nie je to overený formát importu priamo od výrobcu. Pred importom skontrolujte, či ho Omega v danej verzii prijme, prípadne stĺpce premenujte.',
    columns: [
      { key: 'invoiceNumber', label: 'Číslo faktúry' },
      { key: 'vs', label: 'Variabilný symbol' },
      { key: 'paidDate', label: 'Dátum úhrady' },
      { key: 'paidAmount', label: 'Uhradená suma', amount: true },
    ],
  },
  MONEY_S3: {
    label: 'Money S3 (Seyfor)',
    note: 'Vlastný stĺpcový formát tejto stránky pre spätné označenie faktúr ako uhradených, nie je to overený formát importu priamo od výrobcu. Pred importom skontrolujte, či ho Money S3 v danej verzii prijme, prípadne stĺpce premenujte.',
    columns: [
      { key: 'invoiceNumber', label: 'Číslo dokladu' },
      { key: 'vs', label: 'Variabilní symbol' },
      { key: 'paidDate', label: 'Datum úhrady' },
      { key: 'paidAmount', label: 'Uhrazená částka', amount: true },
    ],
  },
};

/**
 * Builds a "mark as paid" CSV for the given accounting program from
 * report().markPaid rows ({invoiceNumber, vs?, paidDate, paidAmount}).
 * @param {string} formatKey One of MARK_PAID_EXPORT_FORMATS's keys.
 * @param {Array<Object>} markPaidRows
 * @param {{delimiter?:string, decimalComma?:boolean, bom?:boolean}} [opts]
 * @returns {string|null} CSV text, or null for an unknown formatKey.
 */
export function buildMarkPaidExport(formatKey, markPaidRows, opts) {
  const fmt = Object.prototype.hasOwnProperty.call(MARK_PAID_EXPORT_FORMATS, formatKey) ? MARK_PAID_EXPORT_FORMATS[formatKey] : null;
  if (!fmt) return null;
  const o = Object.assign({ decimalComma: true }, opts || {}, { columns: fmt.columns });
  return toCsv(Array.isArray(markPaidRows) ? markPaidRows : [], o);
}

// ═══════════════════════ multi-statement / multi-account ═══════════════════
//
// A "block" is one loaded statement (or CSV export) with its own already-
// normalized payment list (parovac.js's paymentsFromCamtRows() output).
// mergeStatementPayments() concatenates several blocks into one payment
// list with sequential `idx`, so match() can run once across every
// account instead of once per statement.

/**
 * @param {Array<{payments:Array}>} blocks
 * @returns {Array} every block's payments, concatenated, with `idx`
 *   reassigned sequentially across the whole merged list.
 */
export function mergeStatementPayments(blocks) {
  const arr = Array.isArray(blocks) ? blocks : [];
  const merged = arr.reduce((acc, b) => acc.concat(b && Array.isArray(b.payments) ? b.payments : []), []);
  return merged.map((p, i) => Object.assign({}, p, { idx: i }));
}

// ══════════════════════════════ history ═════════════════════════════════════

/** @returns {Array} up to HISTORY_MAX entries, most recent first. */
export function loadHistory() {
  if (!hasLocalStorage()) return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function writeHistory(list) {
  if (!hasLocalStorage()) return false;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Prepends one entry (most-recent-first) and trims to HISTORY_MAX.
 * @param {{date?:string, invoiceCount?:number, paymentCount?:number, summary?:Object}} entry
 * @returns {Object} the stored entry (with its generated id).
 */
export function addHistoryEntry(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const item = {
    id: randomId('h'),
    date: typeof e.date === 'string' && e.date ? e.date : new Date().toISOString(),
    invoiceCount: Number.isFinite(Number(e.invoiceCount)) ? Number(e.invoiceCount) : 0,
    paymentCount: Number.isFinite(Number(e.paymentCount)) ? Number(e.paymentCount) : 0,
    summary: e.summary && typeof e.summary === 'object' ? e.summary : null,
  };
  const list = loadHistory();
  list.unshift(item);
  while (list.length > HISTORY_MAX) list.pop();
  writeHistory(list);
  return item;
}

/** @returns {boolean} true if the history was cleared (or was already empty). */
export function clearHistory() {
  if (!hasLocalStorage()) return false;
  try {
    localStorage.removeItem(HISTORY_KEY);
    return true;
  } catch (e) {
    return false;
  }
}

// Also expose as a plain browser global when loaded via <script type="module">.
if (typeof window !== 'undefined') {
  window.ParovacPro = {
    BUY_URL,
    BUY_URL_YEAR,
    loadMappingPresets, saveMappingPreset, removeMappingPreset,
    loadToleranceSettings, saveToleranceSettings,
    MARK_PAID_EXPORT_FORMATS, buildMarkPaidExport,
    mergeStatementPayments,
    loadHistory, addHistoryEntry, clearHistory,
  };
}
