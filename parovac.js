// parovac.js: Párovač platieb core matching engine.
//
// Pure, deterministic, 100% client-side: given a list of issued invoices
// (pasted from Excel as TSV, or a CSV/TSV file read locally) and a list of
// bank-statement payments (from the sibling camt.053 parser, camt053.js, or
// its CSV export), matches which invoices were paid, which were only
// partially paid or overpaid, which payments are a likely-but-unconfirmed
// match (no variable symbol), and what is left over on either side.
// Works identically in Node (tests.mjs) and in the browser: no DOMParser, no
// npm dependency, no network request of any kind.
//
// Matching rules (run once per invoice, against payments grouped by VS):
//   1. VS matches, summed amount matches within `tolerance` (default 0.01
//      EUR) -> matched.
//   2. VS matches, summed amount differs -> partial payment / overpayment.
//   3. No VS-based match found for either side: an unmatched invoice and an
//      unmatched payment are offered as a proposed pairing ("návrh") when
//      their amounts match within tolerance, their dates are within
//      `dateWindowDays` (default 45) of each other, and the pairing is
//      mutually unique (neither side has another equally valid candidate).
//   4. Everything left over stays unmatched on its own side.
// Payments sharing the same VS are summed before step 1/2, so an invoice
// paid in several installments is evaluated against its total.
//
// Works as an ES module (import { parseInvoices, mapColumns, match, report,
// toCsv, ... } from './parovac.js') and, when loaded in a browser via
// <script type="module">, also publishes window.Parovac = { parseInvoices,
// mapColumns, match, report, toCsv } for console/debug use.

// ───────────────────────────── small helpers ─────────────────────────────

function safeStr(v) {
  return typeof v === 'string' ? v : (v === null || v === undefined ? '' : String(v));
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function onlyDigits(s) {
  return safeStr(s).replace(/[^0-9]/g, '');
}

// Diacritic-fold + lowercase a header/cell for loose matching. Deliberately
// avoids a ̀-ͯ regex literal (combining marks are awkward to keep
// intact through plain-text editing) in favor of an explicit code-point
// range check on the NFD-decomposed string.
function foldLower(s) {
  const str = safeStr(s);
  try {
    const decomposed = str.normalize('NFD');
    let out = '';
    for (const ch of decomposed) {
      const code = ch.codePointAt(0);
      if (code >= 0x300 && code <= 0x36f) continue; // combining diacritical marks
      out += ch;
    }
    return out.toLowerCase().trim();
  } catch (e) {
    return str.toLowerCase().trim();
  }
}

/** Today as YYYY-MM-DD (local time). */
export function todayIso(base) {
  const d = base instanceof Date ? base : new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isoIfValidDate(y, mo, d) {
  if (!(y >= 1000 && y <= 9999 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${pad2(mo)}-${pad2(d)}`;
}

/**
 * Parses a date cell in ISO (YYYY-MM-DD), Slovak (D.M.YYYY / DD.MM.YYYY) or
 * slash (D/M/YYYY) form into an ISO YYYY-MM-DD string, or null.
 * @returns {string|null}
 */
export function parseFlexibleDate(raw) {
  const s = safeStr(raw).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return isoIfValidDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/);
  if (m) return isoIfValidDate(Number(m[3]), Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return isoIfValidDate(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

/**
 * Whole days between two ISO (YYYY-MM-DD) dates, `b - a`. Returns null if
 * either date is missing or not a valid ISO date.
 * @returns {number|null}
 */
export function daysBetween(aIso, bIso) {
  if (typeof aIso !== 'string' || typeof bIso !== 'string') return null;
  const a = parseFlexibleDate(aIso);
  const b = parseFlexibleDate(bIso);
  if (!a || !b) return null;
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86400000);
}

/**
 * Loosely parses an amount cell: strips spaces/NBSP (thousands grouping)
 * and "€"/"EUR", and accepts either "." or "," as the decimal separator
 * (when both are present, the rightmost one wins and the other is treated
 * as a thousands separator).
 * @returns {number|null}
 */
export function parseAmount(raw) {
  if (raw === null || raw === undefined) return null;
  let s = safeStr(raw).trim();
  if (!s) return null;
  s = s.replace(/[\s ]/g, '').replace(/€|eur/gi, '');
  if (!s) return null;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    const parts = s.split(',');
    s = parts.length > 2 ? parts.join('') : s.replace(',', '.');
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseBoolLike(raw) {
  const s = foldLower(raw);
  if (!s) return null;
  if (/^(ano|áno|yes|true|1|x|✓|hotovo)$/.test(s)) return true;
  if (/^(nie|no|false|0|-)$/.test(s)) return false;
  return null;
}

// ───────────────────────── delimited-text parsing ─────────────────────────
// Handles both a block pasted straight out of Excel (tab-separated) and a
// CSV/TSV file (";" or "," delimited), including quoted fields with
// embedded delimiters/newlines and doubled-quote escaping, in one
// character-by-character pass. Same approach as the sibling tools'
// generator-pain001.js parseRows, kept independent here so this file has
// zero cross-file dependency for the invoice side.

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== '') || '';
  if (firstLine.includes('\t')) return '\t';
  const semi = (firstLine.match(/;/g) || []).length;
  const comma = (firstLine.match(/,/g) || []).length;
  if (semi > 0 && semi >= comma) return ';';
  if (comma > 0) return ',';
  return '\t';
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let touched = false;
  const len = text.length;
  for (let i = 0; i < len; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && field === '') { inQuotes = true; touched = true; continue; }
    if (c === delimiter) { row.push(field); field = ''; touched = true; continue; }
    if (c === '\r') { continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; touched = false; continue; }
    field += c; touched = true;
  }
  if (touched || field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Parses a pasted Excel block or CSV/TSV text into rows of trimmed string
 * cells. Delimiter (tab, ";" or ",") is auto-detected from the first
 * non-blank line. Fully blank rows are dropped.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseRows(text) {
  const src = safeStr(text).replace(/^﻿/, '');
  if (!src.trim()) return [];
  const delimiter = detectDelimiter(src);
  const raw = parseDelimited(src, delimiter);
  return raw
    .map((row) => row.map((cell) => safeStr(cell).trim()))
    .filter((row) => row.some((cell) => cell !== ''));
}

// ═══════════════════════════ invoices: column mapping ═══════════════════════

const INVOICE_FIELD_LIST = ['number', 'vs', 'amount', 'dueDate', 'customer', 'currency', 'paid'];

// Tested in this order per column (first match wins); narrow VS/currency/
// paid codes are checked before the broader amount/number/customer ones so
// e.g. a "Variabilný symbol" header is never mistaken for "number".
const INVOICE_FIELD_DETECT_ORDER = ['vs', 'paid', 'currency', 'dueDate', 'amount', 'number', 'customer'];

const INVOICE_FIELD_PATTERNS = {
  vs: /^vs$|variabiln/,
  paid: /uhraden|zaplaten|^paid$/,
  currency: /^mena$|^ccy$|currency/,
  dueDate: /splatnost|due.?date/,
  amount: /celkom|k uhrade|^suma$|^sum$|^total$|amount/,
  number: /faktur|doklad|invoice/,
  customer: /odberatel|zakaznik|^firma$|customer|klient|partner/,
};

function emptyInvoiceMapping() {
  const m = {};
  for (const f of INVOICE_FIELD_LIST) m[f] = null;
  return m;
}

function detectInvoiceMapping(headerRow) {
  const mapping = emptyInvoiceMapping();
  const used = new Set();
  headerRow.forEach((cell, colIdx) => {
    const folded = foldLower(cell);
    if (!folded) return;
    for (const field of INVOICE_FIELD_DETECT_ORDER) {
      if (mapping[field] !== null || used.has(colIdx)) continue;
      if (INVOICE_FIELD_PATTERNS[field].test(folded)) {
        mapping[field] = colIdx;
        used.add(colIdx);
        break;
      }
    }
  });
  return mapping;
}

function looksLikeInvoiceHeader(row) {
  let matches = 0;
  for (const cell of row) {
    const folded = foldLower(cell);
    if (!folded) continue;
    for (const field of INVOICE_FIELD_DETECT_ORDER) {
      if (INVOICE_FIELD_PATTERNS[field].test(folded)) { matches++; break; }
    }
  }
  return matches >= 2;
}

// Fallback when no header row is recognized: assume the common export order
// číslo faktúry, VS, suma, splatnosť, odberateľ (only as many as exist).
function defaultInvoicePositionalMapping(columnCount) {
  const order = ['number', 'vs', 'amount', 'dueDate', 'customer'];
  const mapping = emptyInvoiceMapping();
  for (let i = 0; i < order.length && i < columnCount; i++) mapping[order[i]] = i;
  return mapping;
}

function buildInvoiceRow(cells, mapping, rowNumber) {
  const get = (field) => {
    const idx = mapping[field];
    if (idx === null || idx === undefined || idx < 0) return '';
    const v = cells[idx];
    return typeof v === 'string' ? v.trim() : '';
  };

  const number = get('number');
  const vs = onlyDigits(get('vs'));
  const amountRaw = get('amount');
  const amount = amountRaw ? parseAmount(amountRaw) : null;
  const dueDateRaw = get('dueDate');
  const dueDate = dueDateRaw ? parseFlexibleDate(dueDateRaw) : null;
  const customer = get('customer');
  const currency = (get('currency') || 'EUR').toUpperCase();
  const paidRaw = get('paid');
  const paidFlag = paidRaw ? parseBoolLike(paidRaw) : null;

  const errors = [];
  const warnings = [];
  if (!amountRaw) errors.push('Chýba suma.');
  else if (amount === null) errors.push('Suma nie je platné číslo.');
  else if (amount <= 0) errors.push('Suma musí byť kladná.');
  if (!vs) warnings.push('Chýba variabilný symbol: faktúra sa dá spárovať len ako návrh (podľa sumy a dátumu).');
  if (dueDateRaw && !dueDate) warnings.push('Dátum splatnosti sa nepodarilo rozpoznať.');

  return {
    row: rowNumber, number, vs, amount, amountRaw, dueDate, dueDateRaw, customer, currency,
    paidFlag, errors, warnings, hasError: errors.length > 0,
  };
}

/**
 * Detects (or applies manually-overridden) column meaning and builds the
 * validated invoice list from parsed rows.
 * @param {string[][]} rows Output of parseRows().
 * @param {Object<string, number|null>} [overrides] Manual column index per
 *   field (number/vs/amount/dueDate/customer/currency/paid); any field
 *   present here overrides auto-detection, `null` means "no column".
 * @returns {{hasHeader:boolean, headerLabels:string[], columnCount:number, detectedMapping:Object, mapping:Object, invoices:Array, rowCount:number}}
 */
export function mapColumns(rows, overrides) {
  const allRows = Array.isArray(rows) ? rows : [];
  const columnCount = allRows.reduce((max, r) => Math.max(max, Array.isArray(r) ? r.length : 0), 0);
  const hasHeader = allRows.length > 0 && looksLikeInvoiceHeader(allRows[0]);
  const headerRow = hasHeader ? allRows[0] : [];
  const dataRows = hasHeader ? allRows.slice(1) : allRows;

  const detectedMapping = hasHeader ? detectInvoiceMapping(headerRow) : defaultInvoicePositionalMapping(columnCount);
  let mapping = Object.assign({}, detectedMapping);
  if (overrides && typeof overrides === 'object') {
    for (const field of INVOICE_FIELD_LIST) {
      if (Object.prototype.hasOwnProperty.call(overrides, field)) {
        const v = overrides[field];
        mapping[field] = (v === null || v === undefined || v === '') ? null : Number(v);
      }
    }
  }

  const headerLabels = [];
  for (let c = 0; c < columnCount; c++) headerLabels.push(hasHeader && headerRow[c] ? headerRow[c] : `Stĺpec ${c + 1}`);

  const invoices = dataRows.map((cells, i) => buildInvoiceRow(cells, mapping, i + 1));

  return { hasHeader, headerLabels, columnCount, detectedMapping, mapping, invoices, rowCount: dataRows.length };
}

/**
 * Convenience wrapper: parseRows(text) then mapColumns(rows, overrides).
 * @param {string} text Pasted TSV/CSV text or an uploaded file's contents.
 * @param {Object} [overrides] Same shape as mapColumns()'s second argument.
 */
export function parseInvoices(text, overrides) {
  return mapColumns(parseRows(text), overrides);
}

// ═══════════════════════ invoice header templates (heuristics) ═════════════
//
// Column-header guesses for six Slovak/Czech accounting programs' invoice
// exports. These are this tool's own best-guess header vocabulary, not
// specifications verified against each vendor's own export documentation:
// label them honestly in the UI (see TEMPLATES_ARE_HEURISTIC below and each
// template's own `note`), same spirit as the sibling SEPA pain.001
// Generátor's pro.js MAPPING_TEMPLATES. A template is applied by *exact
// header match* only (never by column position); any field it does not
// match falls back to mapColumns()'s own auto-detection.
export const TEMPLATES_ARE_HEURISTIC = true;

export const INVOICE_TEMPLATES = {
  POHODA: {
    label: 'Pohoda (Stormware)',
    note: 'Šablóna odhaduje bežné názvy stĺpcov z exportu Pohody, nie je to oficiálna špecifikácia. Skontrolujte mapovanie pred párovaním.',
    headers: {
      number: ['číslo', 'číslo dokladu', 'variabilní symbol dokladu', 'doklad'],
      vs: ['variabilní symbol', 'variabilny symbol', 'vs'],
      amount: ['celkem', 'k úhradě', 'castka', 'částka'],
      dueDate: ['datum splatnosti', 'dátum splatnosti', 'splatnost'],
      customer: ['firma', 'odběratel', 'název partnera', 'partner'],
      currency: ['měna', 'mena'],
      paid: ['uhrazeno', 'uhradené', 'zaplaceno'],
    },
  },
  OMEGA: {
    label: 'Omega (KROS)',
    note: 'Šablóna odhaduje bežné názvy stĺpcov z exportu Omegy (KROS), nie je to oficiálna špecifikácia. Skontrolujte mapovanie pred párovaním.',
    headers: {
      number: ['číslo faktúry', 'cislo faktury', 'číslo dokladu'],
      vs: ['variabilný symbol', 'variabilny symbol', 'vs'],
      amount: ['suma', 'úhrada', 'uhrada', 'celkom'],
      dueDate: ['dátum splatnosti', 'datum splatnosti', 'splatnosť'],
      customer: ['odberateľ', 'odberatel', 'názov firmy', 'zákazník'],
      currency: ['mena'],
      paid: ['uhradené', 'uhradene', 'zaplatené'],
    },
  },
  MONEY_S3: {
    label: 'Money S3 (Seyfor)',
    note: 'Šablóna odhaduje bežné názvy stĺpcov z exportu Money S3, nie je to oficiálna špecifikácia. Skontrolujte mapovanie pred párovaním.',
    headers: {
      number: ['číslo dokladu', 'cislo dokladu', 'číslo'],
      vs: ['variabilní symbol', 'variabilni symbol', 'vs'],
      amount: ['celkem k úhradě', 'castka', 'částka', 'celkem'],
      dueDate: ['datum splatnosti'],
      customer: ['název partnera', 'nazev partnera', 'partner', 'firma'],
      currency: ['měna', 'mena'],
      paid: ['uhrazeno'],
    },
  },
  SUPERFAKTURA: {
    label: 'SuperFaktúra',
    note: 'Šablóna odhaduje bežné názvy stĺpcov z exportu SuperFaktúry, nie je to oficiálna špecifikácia. Skontrolujte mapovanie pred párovaním.',
    headers: {
      number: ['číslo faktúry', 'cislo faktury', 'číslo'],
      vs: ['variabilný symbol', 'variabilny symbol', 'vs'],
      amount: ['celková suma', 'celkova suma', 'suma s dph', 'suma'],
      dueDate: ['dátum splatnosti', 'datum splatnosti', 'splatnosť'],
      customer: ['meno firmy', 'odberateľ', 'zákazník'],
      currency: ['mena'],
      paid: ['uhradené', 'stav'],
    },
  },
  IDOKLAD: {
    label: 'iDoklad',
    note: 'Šablóna odhaduje bežné názvy stĺpcov z exportu iDokladu, nie je to oficiálna špecifikácia. Skontrolujte mapovanie pred párovaním.',
    headers: {
      number: ['číslo dokladu', 'cislo dokladu', 'číslo'],
      vs: ['variabilní symbol', 'variabilni symbol', 'vs'],
      amount: ['celkem', 'k úhradě', 'castka'],
      dueDate: ['datum splatnosti'],
      customer: ['odběratel', 'odberatel', 'partner'],
      currency: ['měna', 'mena'],
      paid: ['uhrazeno', 'zaplaceno'],
    },
  },
  FAKTUROID: {
    label: 'Fakturoid',
    note: 'Šablóna odhaduje bežné názvy stĺpcov z exportu Fakturoidu, nie je to oficiálna špecifikácia. Skontrolujte mapovanie pred párovaním.',
    headers: {
      number: ['číslo', 'číslo dokladu'],
      vs: ['variabilní symbol', 'variabilni symbol', 'vs'],
      amount: ['celkem', 'částka'],
      dueDate: ['datum splatnosti', 'splatnost'],
      customer: ['odběratel', 'odberatel'],
      currency: ['měna', 'mena'],
      paid: ['zaplaceno', 'uhrazeno'],
    },
  },
};

/**
 * Builds mapColumns() overrides for the given template by matching the
 * (first, header) row's cells against the template's header-text guesses,
 * exact match only, diacritics/case-folded, never by column position.
 * @param {string} templateKey One of INVOICE_TEMPLATES's keys.
 * @param {string[][]} rows Output of parseRows().
 * @returns {{mapped:Object, template:Object|null, matchedFields:string[]}}
 */
export function applyInvoiceTemplate(templateKey, rows) {
  const rowsArr = Array.isArray(rows) ? rows : [];
  const template = Object.prototype.hasOwnProperty.call(INVOICE_TEMPLATES, templateKey) ? INVOICE_TEMPLATES[templateKey] : null;
  const overrides = {};
  if (template && rowsArr.length > 0) {
    const headerRow = rowsArr[0];
    const used = new Set();
    for (const field of Object.keys(template.headers)) {
      const candidates = template.headers[field].map(foldLower);
      let found = null;
      headerRow.forEach((cell, idx) => {
        if (found !== null || used.has(idx)) return;
        const folded = foldLower(cell);
        if (folded && candidates.includes(folded)) found = idx;
      });
      if (found !== null) {
        overrides[field] = found;
        used.add(found);
      }
    }
  }
  const mapped = mapColumns(rowsArr, overrides);
  return { mapped, template, matchedFields: Object.keys(overrides) };
}

// ═══════════════════════════════ payments ════════════════════════════════
//
// A "payment" fed into match() is a plain object: { idx, vs, ss, ks,
// amount (positive number), date (ISO), counterparty, message, currency,
// ref }. Two ways to get there:
//   - a camt.053 statement, parsed with the sibling tool's engine
//     (camt053.js, copied in unchanged): CamtConverter.parse(xml) then
//     CamtConverter.toRows(parsed), fed into paymentsFromCamtRows() below;
//   - that same sibling tool's CSV export, re-read with parsePaymentsCsv()
//     below (matches its column headers exactly), which returns rows in
//     the identical shape as CamtConverter.toRows() so both paths funnel
//     into the same paymentsFromCamtRows() normalization.
// Only credit entries (money received, camt.053 CdtDbtInd "CRDT", i.e. a
// positive signed amount in CamtConverter's row shape) are payments an
// issued invoice could have been paid by; debits are left out.

// Column labels produced by the sibling tool's CamtConverter.toCsv(), used
// to read that CSV back in. Kept as a local copy (not imported from
// camt053.js) so this file has no hard load-order dependency on it; the
// two are still statement-shape twins because the docs above pin them to
// the same header vocabulary, and tests.mjs cross-checks this table
// against camt053.js's own COLUMNS export.
const CAMT_CSV_HEADER_TO_KEY = {
  'cislo vypisu': 'statementId',
  'ucet (iban)': 'account',
  'datum zauctovania': 'bookingDate',
  'datum valuty': 'valueDate',
  'suma': 'amount',
  'mena': 'currency',
  'status': 'status',
  'referencia banky': 'bankRef',
  'typ transakcie': 'txType',
  'protistrana': 'counterpartyName',
  'iban protistrany': 'counterpartyIban',
  'bic protistrany': 'counterpartyBic',
  'endtoendid': 'endToEndId',
  'vs': 'vs',
  'ss': 'ss',
  'ks': 'ks',
  'sprava pre prijemcu': 'message',
  'poplatok': 'charges',
};

/**
 * Re-reads the sibling camt.053-to-excel tool's CSV export back into rows
 * shaped exactly like CamtConverter.toRows(): { statementId, account,
 * bookingDate, valueDate, amount, currency, status, bankRef, txType,
 * counterpartyName, counterpartyIban, counterpartyBic, endToEndId, vs, ss,
 * ks, message, charges }. Header match is exact (diacritic/case-folded),
 * column order independent; returns [] if no recognized header is found at
 * all (so the UI can tell "not this CSV" apart from "empty file").
 * @param {string} text
 * @returns {Array<Object>}
 */
export function parsePaymentsCsv(text) {
  const rows = parseRows(text);
  if (rows.length === 0) return [];
  const header = rows[0];
  const keyByCol = header.map((h) => CAMT_CSV_HEADER_TO_KEY[foldLower(h)] || null);
  if (!keyByCol.some((k) => k)) return [];
  const dataRows = rows.slice(1);
  return dataRows.map((cells) => {
    const obj = {};
    keyByCol.forEach((key, i) => { if (key) obj[key] = cells[i]; });
    return {
      statementId: safeStr(obj.statementId),
      account: safeStr(obj.account),
      bookingDate: safeStr(obj.bookingDate),
      valueDate: safeStr(obj.valueDate),
      amount: obj.amount !== undefined ? parseAmount(obj.amount) : null,
      currency: safeStr(obj.currency),
      status: safeStr(obj.status),
      bankRef: safeStr(obj.bankRef),
      txType: safeStr(obj.txType),
      counterpartyName: safeStr(obj.counterpartyName),
      counterpartyIban: safeStr(obj.counterpartyIban),
      counterpartyBic: safeStr(obj.counterpartyBic),
      endToEndId: safeStr(obj.endToEndId),
      vs: safeStr(obj.vs),
      ss: safeStr(obj.ss),
      ks: safeStr(obj.ks),
      message: safeStr(obj.message),
      charges: obj.charges !== undefined ? parseAmount(obj.charges) : null,
    };
  });
}

/**
 * Normalizes camt.053-shaped rows (from CamtConverter.toRows() or
 * parsePaymentsCsv()) into the flat payment objects match() consumes:
 * only credit entries (amount > 0) are kept, since those are what an
 * issued invoice could have been paid by.
 * @param {Array<Object>} rows
 * @returns {Array<{idx:number, vs:string, ss:string, ks:string, amount:number, date:string, counterparty:string, message:string, currency:string, ref:string}>}
 */
export function paymentsFromCamtRows(rows) {
  const arr = Array.isArray(rows) ? rows : [];
  const out = [];
  arr.forEach((r) => {
    if (!r || typeof r.amount !== 'number' || !Number.isFinite(r.amount) || r.amount <= 0) return;
    out.push({
      idx: out.length,
      vs: onlyDigits(r.vs),
      ss: onlyDigits(r.ss),
      ks: onlyDigits(r.ks),
      amount: round2(r.amount),
      date: safeStr(r.valueDate || r.bookingDate),
      counterparty: safeStr(r.counterpartyName),
      message: safeStr(r.message),
      currency: safeStr(r.currency) || 'EUR',
      ref: safeStr(r.bankRef || r.endToEndId),
    });
  });
  return out;
}

// ══════════════════════════════ matching ═══════════════════════════════════

export const DEFAULT_TOLERANCE = 0.01;
export const DEFAULT_DATE_WINDOW_DAYS = 45;

// Step 3 ("no VS") candidate search: for each still-unmatched invoice with
// a valid amount and due date, find still-unconsumed payments whose amount
// matches within tolerance and whose date is within dateWindowDays of the
// due date (either direction). A pairing becomes a proposal only when it
// is *mutually* unique: the invoice has exactly one candidate payment, and
// that payment has exactly one candidate invoice. This deliberately does
// not restrict itself to invoices/payments with no VS at all: a payment
// whose VS was mistyped (so it matched no invoice in step 1/2) is exactly
// the case this tool exists to catch, per its own pitch that VS entries
// are often typed wrong.
function proposeMatches(remainingInvoices, unconsumedPayments, tolerance, dateWindowDays) {
  const eligibleInvoices = remainingInvoices.filter((inv) => isNum(inv.amount) && inv.amount > 0 && inv.dueDate);
  const invoiceCandidates = new Map();
  const paymentCandidateCount = new Map();

  eligibleInvoices.forEach((inv) => {
    const cands = unconsumedPayments.filter((p) => {
      if (Math.abs(round2(p.amount - inv.amount)) > tolerance) return false;
      const dd = daysBetween(inv.dueDate, p.date);
      if (dd === null) return false;
      return Math.abs(dd) <= dateWindowDays;
    });
    invoiceCandidates.set(inv, cands);
    cands.forEach((p) => paymentCandidateCount.set(p.idx, (paymentCandidateCount.get(p.idx) || 0) + 1));
  });

  const proposed = [];
  const usedInvoices = new Set();
  const usedPaymentIdx = new Set();

  eligibleInvoices.forEach((inv) => {
    const cands = invoiceCandidates.get(inv) || [];
    if (cands.length !== 1) return;
    const p = cands[0];
    if ((paymentCandidateCount.get(p.idx) || 0) !== 1) return;
    if (usedInvoices.has(inv) || usedPaymentIdx.has(p.idx)) return;
    usedInvoices.add(inv);
    usedPaymentIdx.add(p.idx);
    proposed.push({
      invoice: inv,
      payments: [p],
      paidAmount: round2(p.amount),
      invoiceAmount: inv.amount,
      diff: round2(p.amount - inv.amount),
      proposal: true,
      dateDiffDays: daysBetween(inv.dueDate, p.date),
    });
  });

  return { proposed, usedInvoices, usedPaymentIdx };
}

/**
 * Matches invoices against payments.
 * @param {Array<Object>} invoices Output of mapColumns()/parseInvoices()'s
 *   `.invoices`, or any objects shaped { vs, amount, dueDate, hasError }.
 * @param {Array<Object>} payments Output of paymentsFromCamtRows(), or any
 *   objects shaped { idx?, vs, amount, date }.
 * @param {{tolerance?:number, dateWindowDays?:number}} [opts]
 * @returns {{matched:Array, partial:Array, proposed:Array, unmatchedInvoices:Array, unmatchedPayments:Array, tolerance:number, dateWindowDays:number}}
 */
export function match(invoices, payments, opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const tolerance = Number.isFinite(options.tolerance) ? Math.abs(options.tolerance) : DEFAULT_TOLERANCE;
  const dateWindowDays = Number.isFinite(options.dateWindowDays) ? Math.abs(options.dateWindowDays) : DEFAULT_DATE_WINDOW_DAYS;

  const invoiceList = (Array.isArray(invoices) ? invoices : []).filter((inv) => inv && !inv.hasError && isNum(inv.amount) && inv.amount > 0);
  const paymentList = (Array.isArray(payments) ? payments : [])
    .filter((p) => p && isNum(p.amount))
    .map((p, i) => Object.assign({}, p, { idx: Number.isFinite(p.idx) ? p.idx : i }));

  const byVs = new Map();
  paymentList.forEach((p) => {
    if (!p.vs) return;
    if (!byVs.has(p.vs)) byVs.set(p.vs, []);
    byVs.get(p.vs).push(p);
  });

  const matched = [];
  const partial = [];
  const consumedIdx = new Set();
  const remainingInvoices = [];

  invoiceList.forEach((inv) => {
    const group = inv.vs ? byVs.get(inv.vs) : null;
    if (!group || group.length === 0) { remainingInvoices.push(inv); return; }
    const paidAmount = round2(group.reduce((s, p) => s + p.amount, 0));
    const diff = round2(paidAmount - inv.amount);
    group.forEach((p) => consumedIdx.add(p.idx));
    const entry = { invoice: inv, payments: group.slice(), paidAmount, invoiceAmount: inv.amount, diff, proposal: false };
    if (Math.abs(diff) <= tolerance) matched.push(entry);
    else partial.push(entry);
  });

  const unconsumedPayments = paymentList.filter((p) => !consumedIdx.has(p.idx));
  const { proposed, usedInvoices, usedPaymentIdx } = proposeMatches(remainingInvoices, unconsumedPayments, tolerance, dateWindowDays);

  const unmatchedInvoices = remainingInvoices.filter((inv) => !usedInvoices.has(inv));
  const unmatchedPayments = unconsumedPayments.filter((p) => !usedPaymentIdx.has(p.idx));

  return { matched, partial, proposed, unmatchedInvoices, unmatchedPayments, tolerance, dateWindowDays };
}

// ══════════════════════════════ report / CSV ════════════════════════════════

function latestDate(dates) {
  const found = (dates || []).filter(Boolean).slice().sort();
  return found.length ? found[found.length - 1] : '';
}

function flattenMatchEntry(e) {
  const inv = e.invoice;
  return {
    invoiceNumber: inv.number || '',
    vs: inv.vs || '',
    customer: inv.customer || '',
    currency: inv.currency || '',
    invoiceAmount: e.invoiceAmount,
    paidAmount: e.paidAmount,
    diff: e.diff,
    dueDate: inv.dueDate || '',
    paymentDate: latestDate(e.payments.map((p) => p.date)),
    paymentCount: e.payments.length,
    paymentRefs: e.payments.map((p) => p.ref || p.counterparty || '').filter(Boolean).join(', '),
    proposal: !!e.proposal,
  };
}

function flattenUnmatchedInvoice(inv, today) {
  return {
    invoiceNumber: inv.number || '',
    vs: inv.vs || '',
    customer: inv.customer || '',
    currency: inv.currency || '',
    invoiceAmount: inv.amount,
    dueDate: inv.dueDate || '',
    daysOverdue: inv.dueDate ? daysBetween(inv.dueDate, today) : null,
  };
}

function flattenUnmatchedPayment(p) {
  return {
    vs: p.vs || '',
    counterparty: p.counterparty || '',
    amount: p.amount,
    date: p.date || '',
    message: p.message || '',
    ref: p.ref || '',
    currency: p.currency || '',
  };
}

function sumBy(arr, key) {
  return round2((arr || []).reduce((s, x) => s + (Number(x[key]) || 0), 0));
}

/**
 * Turns a match() result into four display/export-ready flat-row lists
 * plus a summary. Overdue days for each unmatched invoice are computed
 * against `opts.today` (defaults to today, local time).
 * @param {Object} matchResult Output of match().
 * @param {{today?:string}} [opts]
 * @returns {{matched:Array, partial:Array, overdueInvoices:Array, unmatchedPayments:Array, markPaid:Array, summary:Object}}
 */
export function report(matchResult, opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const today = typeof options.today === 'string' && options.today ? options.today : todayIso();
  const mr = matchResult && typeof matchResult === 'object' ? matchResult : {};

  const matchedList = [].concat(mr.matched || [], mr.proposed || []).map(flattenMatchEntry)
    .sort((a, b) => (a.proposal === b.proposal ? 0 : a.proposal ? 1 : -1));
  const partialList = (mr.partial || []).map(flattenMatchEntry);
  const overdueInvoices = (mr.unmatchedInvoices || [])
    .map((inv) => flattenUnmatchedInvoice(inv, today))
    .sort((a, b) => (b.daysOverdue === null ? -Infinity : b.daysOverdue) - (a.daysOverdue === null ? -Infinity : a.daysOverdue));
  const unmatchedPayments = (mr.unmatchedPayments || []).map(flattenUnmatchedPayment);

  const markPaid = (mr.matched || []).map((e) => ({
    invoiceNumber: e.invoice.number || '',
    paidDate: latestDate(e.payments.map((p) => p.date)),
    paidAmount: e.paidAmount,
  }));

  const summary = {
    today,
    tolerance: mr.tolerance,
    dateWindowDays: mr.dateWindowDays,
    matchedCount: (mr.matched || []).length,
    matchedSum: sumBy((mr.matched || []).map(flattenMatchEntry), 'paidAmount'),
    proposedCount: (mr.proposed || []).length,
    proposedSum: sumBy((mr.proposed || []).map(flattenMatchEntry), 'paidAmount'),
    partialCount: partialList.length,
    partialSum: sumBy(partialList, 'paidAmount'),
    overdueCount: overdueInvoices.length,
    overdueSum: sumBy(overdueInvoices, 'invoiceAmount'),
    unmatchedPaymentsCount: unmatchedPayments.length,
    unmatchedPaymentsSum: sumBy(unmatchedPayments, 'amount'),
  };

  return { matched: matchedList, partial: partialList, overdueInvoices, unmatchedPayments, markPaid, summary };
}

// Column sets for toCsv(), one per report() list.
export const MATCHED_COLUMNS = [
  { key: 'invoiceNumber', label: 'Číslo faktúry' },
  { key: 'vs', label: 'VS' },
  { key: 'customer', label: 'Odberateľ' },
  { key: 'invoiceAmount', label: 'Suma faktúry', amount: true },
  { key: 'paidAmount', label: 'Uhradené', amount: true },
  { key: 'diff', label: 'Rozdiel', amount: true },
  { key: 'dueDate', label: 'Splatnosť' },
  { key: 'paymentDate', label: 'Dátum platby' },
  { key: 'currency', label: 'Mena' },
  { key: 'proposal', label: 'Návrh' },
];

export const PARTIAL_COLUMNS = MATCHED_COLUMNS.filter((c) => c.key !== 'proposal');

export const OVERDUE_COLUMNS = [
  { key: 'invoiceNumber', label: 'Číslo faktúry' },
  { key: 'vs', label: 'VS' },
  { key: 'customer', label: 'Odberateľ' },
  { key: 'invoiceAmount', label: 'Suma', amount: true },
  { key: 'dueDate', label: 'Splatnosť' },
  { key: 'daysOverdue', label: 'Dní po splatnosti' },
  { key: 'currency', label: 'Mena' },
];

export const UNMATCHED_PAYMENTS_COLUMNS = [
  { key: 'vs', label: 'VS' },
  { key: 'counterparty', label: 'Protistrana' },
  { key: 'amount', label: 'Suma', amount: true },
  { key: 'date', label: 'Dátum' },
  { key: 'message', label: 'Správa' },
  { key: 'ref', label: 'Referencia' },
  { key: 'currency', label: 'Mena' },
];

export const MARK_PAID_COLUMNS = [
  { key: 'invoiceNumber', label: 'Číslo faktúry' },
  { key: 'paidDate', label: 'Dátum úhrady' },
  { key: 'paidAmount', label: 'Suma', amount: true },
];

function csvCell(value, delimiter) {
  const s = value === null || value === undefined ? '' : String(value);
  if (s.indexOf(delimiter) !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1 || s.indexOf('\r') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function formatAmountForCsv(amount, decimalComma) {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '';
  const fixed = amount.toFixed(2);
  return decimalComma ? fixed.replace('.', ',') : fixed;
}

/**
 * Builds CSV text from a flat-row array (any of report()'s lists, or
 * anything shaped the same way). Slovak Excel defaults to ";" as the list
 * separator, so that is the default delimiter; decimalComma additionally
 * swaps "." for "," in amount columns. Returns the text with a UTF-8 BOM
 * prefixed by default (bom:false to omit), CRLF line endings. Same
 * signature style as the sibling tool's camt053.js toCsv().
 * @param {Array<Object>} rows
 * @param {{columns?:Array<{key:string,label:string,amount?:boolean}>, delimiter?:string, decimalComma?:boolean, bom?:boolean}} [opts]
 * @returns {string}
 */
export function toCsv(rows, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const delimiter = o.delimiter || ';';
  const decimalComma = !!o.decimalComma;
  const bom = o.bom !== false;
  const columns = Array.isArray(o.columns) && o.columns.length
    ? o.columns
    : Object.keys((rows && rows[0]) || {}).map((k) => ({ key: k, label: k }));

  const lines = [];
  lines.push(columns.map((c) => csvCell(c.label, delimiter)).join(delimiter));
  (rows || []).forEach((r) => {
    const line = columns.map((c) => {
      let v = r ? r[c.key] : '';
      if (c.amount) v = formatAmountForCsv(v, decimalComma);
      else if (c.key === 'proposal') v = v ? 'návrh' : '';
      else if (v === null || v === undefined) v = '';
      return csvCell(v, delimiter);
    }).join(delimiter);
    lines.push(line);
  });

  const text = lines.join('\r\n');
  return bom ? '﻿' + text : text;
}

// Also expose as a plain browser global when loaded via <script type="module">.
if (typeof window !== 'undefined') {
  window.Parovac = { parseInvoices, mapColumns, match, report, toCsv };
}
