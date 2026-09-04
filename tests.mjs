// tests.mjs — plain Node test runner for parovac.js (no external
// dependencies). Also touches camt053.js (copied unchanged from the
// sibling camt.053-to-excel tool), licence.js and pro.js to confirm the
// whole file set loads and works together. Run with: node tests.mjs

import {
  parseRows, mapColumns, parseInvoices, match, report, toCsv,
  parseAmount, parseFlexibleDate, daysBetween, todayIso,
  INVOICE_TEMPLATES, applyInvoiceTemplate,
  parsePaymentsCsv, paymentsFromCamtRows,
  MATCHED_COLUMNS, PARTIAL_COLUMNS, OVERDUE_COLUMNS, UNMATCHED_PAYMENTS_COLUMNS, MARK_PAID_COLUMNS,
  DEFAULT_TOLERANCE, DEFAULT_DATE_WINDOW_DAYS,
} from './parovac.js';
import { parse as parseCamt, toRows as camtToRows, toCsv as camtToCsv, SAMPLE_CAMT053_XML } from './camt053.js';
import {
  parse as parseLicence, verify as verifyLicence, isValid as isValidLicence,
  load as loadLicence, save as saveLicence, clear as clearLicence,
  todayIso as licenceTodayIso, STORAGE_KEY as LICENCE_STORAGE_KEY, DEFAULT_PLAN,
} from './licence.js';
import {
  loadMappingPresets, saveMappingPreset, removeMappingPreset,
  loadToleranceSettings, saveToleranceSettings,
  MARK_PAID_EXPORT_FORMATS, buildMarkPaidExport,
  mergeStatementPayments, loadHistory, addHistoryEntry, clearHistory, HISTORY_MAX,
  BUY_URL,
} from './pro.js';

// Minimal in-memory localStorage polyfill: Node has no Web Storage API by
// default, and licence.js/pro.js are meant to degrade to a no-op when it's
// absent — so tests that exercise the *storage* path need one installed,
// exactly like a real browser tab would provide.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(String(k)); },
    clear: () => { store.clear(); },
  };
}

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass++; } else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(name, actual, expected) {
  const cond = actual === expected;
  ok(name, cond, cond ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function close(name, actual, expected, eps) {
  const e = eps || 0.005;
  const cond = typeof actual === 'number' && Math.abs(actual - expected) <= e;
  ok(name, cond, cond ? '' : `expected ~${expected}, got ${actual}`);
}
function includes(name, haystack, needle) {
  const cond = typeof haystack === 'string' && haystack.includes(needle);
  ok(name, cond, cond ? '' : `expected string to include ${JSON.stringify(needle)}`);
}
function deepEq(name, actual, expected) {
  const cond = JSON.stringify(actual) === JSON.stringify(expected);
  ok(name, cond, cond ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ═══════════════════════════ parseRows / parseAmount / dates ═══════════════

deepEq('parseRows: tab-separated pasted block', parseRows('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
deepEq('parseRows: semicolon CSV', parseRows('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
deepEq('parseRows: blank rows dropped', parseRows('a;b\n\n1;2\n\n'), [['a', 'b'], ['1', '2']]);
eq('parseRows: empty input', parseRows('').length, 0);

eq('parseAmount: plain decimal', parseAmount('450.00'), 450);
eq('parseAmount: Slovak comma decimal', parseAmount('1 234,56'), 1234.56);
eq('parseAmount: euro sign stripped', parseAmount('89,90 €'), 89.9);
eq('parseAmount: thousands dot + comma decimal', parseAmount('1.234,56'), 1234.56);
eq('parseAmount: invalid text is null', parseAmount('abc'), null);
eq('parseAmount: empty is null', parseAmount(''), null);

eq('parseFlexibleDate: ISO', parseFlexibleDate('2026-08-01'), '2026-08-01');
eq('parseFlexibleDate: Slovak dotted', parseFlexibleDate('1.8.2026'), '2026-08-01');
eq('parseFlexibleDate: slash form', parseFlexibleDate('1/8/2026'), '2026-08-01');
eq('parseFlexibleDate: invalid calendar date is null', parseFlexibleDate('2026-02-30'), null);
eq('parseFlexibleDate: garbage is null', parseFlexibleDate('nie je dátum'), null);

eq('daysBetween: forward', daysBetween('2026-08-01', '2026-08-10'), 9);
eq('daysBetween: backward is negative', daysBetween('2026-08-10', '2026-08-01'), -9);
eq('daysBetween: missing date is null', daysBetween('2026-08-01', ''), null);
ok('todayIso: matches YYYY-MM-DD shape', /^\d{4}-\d{2}-\d{2}$/.test(todayIso()));

// ═══════════════════════════ invoice column mapping ═════════════════════════

{
  const text = 'Číslo faktúry\tVS\tSuma\tSplatnosť\tOdberateľ\tMena\tUhradené\n' +
    '2026001\t123\t450.00\t2026-08-01\tJozef Novák\tEUR\tnie';
  const r = parseInvoices(text);
  eq('mapColumns: header row detected', r.hasHeader, true);
  eq('mapColumns: number column detected', r.mapping.number, 0);
  eq('mapColumns: vs column detected', r.mapping.vs, 1);
  eq('mapColumns: amount column detected', r.mapping.amount, 2);
  eq('mapColumns: dueDate column detected', r.mapping.dueDate, 3);
  eq('mapColumns: customer column detected', r.mapping.customer, 4);
  eq('mapColumns: currency column detected', r.mapping.currency, 5);
  eq('mapColumns: paid column detected', r.mapping.paid, 6);
  eq('mapColumns: one invoice row parsed', r.invoices.length, 1);
  eq('mapColumns: invoice number', r.invoices[0].number, '2026001');
  eq('mapColumns: invoice vs', r.invoices[0].vs, '123');
  eq('mapColumns: invoice amount', r.invoices[0].amount, 450);
  eq('mapColumns: invoice dueDate', r.invoices[0].dueDate, '2026-08-01');
  eq('mapColumns: invoice paidFlag parsed false', r.invoices[0].paidFlag, false);
  eq('mapColumns: no error on a clean row', r.invoices[0].hasError, false);
}

{
  // English headers also auto-detected.
  const text = 'Invoice number\tVS\tAmount\tDue date\tCustomer\n2026002\t456\t100\t2026-08-05\tMária Nová';
  const r = parseInvoices(text);
  eq('mapColumns: English "Amount" header detected', r.mapping.amount, 2);
  eq('mapColumns: English "Due date" header detected', r.mapping.dueDate, 3);
  eq('mapColumns: English "Customer" header detected', r.mapping.customer, 4);
}

{
  // No recognizable header -> positional fallback (number, vs, amount, dueDate, customer).
  const text = 'F900\t111\t50.00\t2026-08-01\tPeter Kraj';
  const r = parseInvoices(text);
  eq('mapColumns: positional fallback has no header', r.hasHeader, false);
  eq('mapColumns: positional fallback number', r.invoices[0].number, 'F900');
  eq('mapColumns: positional fallback vs', r.invoices[0].vs, '111');
  eq('mapColumns: positional fallback amount', r.invoices[0].amount, 50);
}

{
  // Manual override wins over auto-detection.
  const text = 'A\tB\tC\nx\t123\t50';
  const auto = parseInvoices(text);
  const overridden = parseInvoices(text, { vs: 2, amount: 1 });
  eq('mapColumns: override changes vs column', overridden.mapping.vs, 2);
  eq('mapColumns: override changes amount column', overridden.mapping.amount, 1);
  ok('mapColumns: override differs from auto for this input', overridden.mapping.vs !== auto.mapping.vs || overridden.mapping.amount !== auto.mapping.amount);
}

{
  const r = parseInvoices('Číslo\tVS\tSuma\tSplatnosť\tFirma\nF1\t1\t\t2026-01-01\tX');
  eq('mapColumns: missing amount is a row error', r.invoices[0].hasError, true);
  includes('mapColumns: missing amount error text', r.invoices[0].errors[0], 'suma');
}

{
  const r = parseInvoices('Číslo\tVS\tSuma\tSplatnosť\tFirma\nF1\t1\tabc\t2026-01-01\tX');
  eq('mapColumns: unparsable amount is a row error', r.invoices[0].hasError, true);
}

// ═══════════════════════ invoice header templates (6 programs) ═════════════

{
  const rows = parseRows('Číslo\tVariabilní symbol\tCelkem\tDatum splatnosti\tFirma\nF1\t111\t50\t01.08.2026\tABC s.r.o.');
  const t = applyInvoiceTemplate('POHODA', rows);
  eq('template POHODA: number matched', t.matchedFields.includes('number'), true);
  eq('template POHODA: vs matched', t.matchedFields.includes('vs'), true);
  eq('template POHODA: amount matched', t.matchedFields.includes('amount'), true);
  eq('template POHODA: parsed amount', t.mapped.invoices[0].amount, 50);
}
{
  const rows = parseRows('Číslo faktúry\tVariabilný symbol\tSuma\tDátum splatnosti\tOdberateľ\nF2\t222\t80\t2026-08-01\tXYZ');
  const t = applyInvoiceTemplate('OMEGA', rows);
  eq('template OMEGA: vs matched', t.matchedFields.includes('vs'), true);
  eq('template OMEGA: amount matched', t.matchedFields.includes('amount'), true);
}
{
  const rows = parseRows('Číslo dokladu\tVariabilní symbol\tCelkem k úhradě\tDatum splatnosti\tNázev partnera\nF3\t333\t90\t2026-08-02\tACME');
  const t = applyInvoiceTemplate('MONEY_S3', rows);
  eq('template MONEY_S3: amount matched (Celkem k úhradě)', t.matchedFields.includes('amount'), true);
}
{
  const rows = parseRows('Číslo faktúry\tVariabilný symbol\tCelková suma\tDátum splatnosti\tMeno firmy\nF4\t444\t70\t2026-08-03\tFirma s.r.o.');
  const t = applyInvoiceTemplate('SUPERFAKTURA', rows);
  eq('template SUPERFAKTURA: amount matched', t.matchedFields.includes('amount'), true);
  eq('template SUPERFAKTURA: customer matched', t.matchedFields.includes('customer'), true);
}
{
  const rows = parseRows('Číslo dokladu\tVariabilní symbol\tCelkem\tDatum splatnosti\tOdběratel\nF5\t555\t60\t2026-08-04\tKlient s.r.o.');
  const t = applyInvoiceTemplate('IDOKLAD', rows);
  eq('template IDOKLAD: vs matched', t.matchedFields.includes('vs'), true);
}
{
  const rows = parseRows('Číslo\tVariabilní symbol\tCelkem\tDatum splatnosti\tOdběratel\nF6\t666\t65\t2026-08-05\tPartner s.r.o.');
  const t = applyInvoiceTemplate('FAKTUROID', rows);
  eq('template FAKTUROID: amount matched', t.matchedFields.includes('amount'), true);
}
{
  const t = applyInvoiceTemplate('NEEXISTUJE', parseRows('a\tb\n1\t2'));
  eq('template: unknown key returns null template', t.template, null);
  deepEq('template: unknown key matches nothing', t.matchedFields, []);
}

// ═══════════════════════════ camt.053 -> payments plumbing ══════════════════

{
  const parsed = parseCamt(SAMPLE_CAMT053_XML);
  eq('camt053.js: sample parses ok', parsed.ok, true);
  const rows = camtToRows(parsed);
  eq('camt053.js: sample has 3 entries', rows.length, 3);
  const payments = paymentsFromCamtRows(rows);
  eq('paymentsFromCamtRows: only the credit entry is kept', payments.length, 1);
  eq('paymentsFromCamtRows: credit vs extracted from EndToEndId', payments[0].vs, '2026001');
  eq('paymentsFromCamtRows: credit amount', payments[0].amount, 450);

  // Round-trip through the sibling tool's own CSV export.
  const csvText = camtToCsv(rows);
  const rows2 = parsePaymentsCsv(csvText);
  eq('parsePaymentsCsv: round-trips row count', rows2.length, rows.length);
  const credits2 = paymentsFromCamtRows(rows2);
  eq('parsePaymentsCsv: round-trips the one credit', credits2.length, 1);
  eq('parsePaymentsCsv: round-trips VS', credits2[0].vs, '2026001');
  close('parsePaymentsCsv: round-trips amount', credits2[0].amount, 450, 0.001);
}

eq('parsePaymentsCsv: unrecognized header returns empty', parsePaymentsCsv('foo;bar\n1;2').length, 0);
eq('parsePaymentsCsv: empty input returns empty', parsePaymentsCsv('').length, 0);

// ══════════════════════════════ match(): 4 branches ══════════════════════════

function inv(vs, amount, dueDate, extra) {
  return Object.assign({ number: 'F-' + vs, vs, amount, dueDate, customer: 'Zákazník ' + vs, currency: 'EUR', hasError: false }, extra || {});
}
function pay(idx, vs, amount, date, extra) {
  return Object.assign({ idx, vs, amount, date, counterparty: 'Platca', currency: 'EUR' }, extra || {});
}

{
  // Branch 1: VS + amount match exactly -> matched.
  const r = match([inv('100', 450, '2026-08-01')], [pay(0, '100', 450, '2026-08-02')]);
  eq('match branch 1: one matched', r.matched.length, 1);
  eq('match branch 1: no partial', r.partial.length, 0);
  eq('match branch 1: no proposed', r.proposed.length, 0);
  eq('match branch 1: no unmatched invoices', r.unmatchedInvoices.length, 0);
  eq('match branch 1: no unmatched payments', r.unmatchedPayments.length, 0);
  eq('match branch 1: matched diff is zero', r.matched[0].diff, 0);
}

{
  // Branch 1 with tolerance: a 0.5-cent difference within default 0.01 tolerance.
  const r = match([inv('101', 100, '2026-08-01')], [pay(0, '101', 100.005, '2026-08-01')]);
  eq('match branch 1: within default cent tolerance still matches', r.matched.length, 1);
}

{
  // Branch 2: VS matches, amount differs (underpaid) -> partial.
  const r = match([inv('200', 100, '2026-08-01')], [pay(0, '200', 60, '2026-08-02')]);
  eq('match branch 2: one partial (underpaid)', r.partial.length, 1);
  eq('match branch 2: nothing in matched', r.matched.length, 0);
  close('match branch 2: diff is negative (underpaid)', r.partial[0].diff, -40, 0.001);
}

{
  // Branch 2: VS matches, amount differs (overpaid) -> partial, positive diff.
  const r = match([inv('201', 100, '2026-08-01')], [pay(0, '201', 130, '2026-08-02')]);
  eq('match branch 2: one partial (overpaid)', r.partial.length, 1);
  close('match branch 2: diff is positive (overpaid)', r.partial[0].diff, 30, 0.001);
}

{
  // Branch 3: no VS on either side, amount + date proximity, unique -> proposed.
  const r = match([inv('', 77, '2026-08-01')], [pay(0, '', 77, '2026-08-20')]);
  eq('match branch 3: one proposed', r.proposed.length, 1);
  eq('match branch 3: proposal flagged', r.proposed[0].proposal, true);
  eq('match branch 3: nothing left unmatched on either side', r.unmatchedInvoices.length + r.unmatchedPayments.length, 0);
}

{
  // Branch 3 with a mistyped VS on the payment side: no invoice VS matches
  // it, but amount+date still proposes it — the tool's own stated purpose
  // ("VS sa píšu zle").
  const r = match([inv('300', 88, '2026-08-01')], [pay(0, '999', 88, '2026-08-10')]);
  eq('match branch 3: mistyped VS still proposed via amount+date', r.proposed.length, 1);
}

{
  // Branch 3: date outside the 45-day window -> not proposed, both unmatched.
  const r = match([inv('', 55, '2026-08-01')], [pay(0, '', 55, '2026-10-01')]);
  eq('match branch 3: outside date window is not proposed', r.proposed.length, 0);
  eq('match branch 3: invoice stays unmatched', r.unmatchedInvoices.length, 1);
  eq('match branch 3: payment stays unmatched', r.unmatchedPayments.length, 1);
}

{
  // Branch 3: ambiguous (two invoices, same amount+date candidate) -> neither proposed.
  const r = match(
    [inv('', 40, '2026-08-01'), inv('', 40, '2026-08-03')],
    [pay(0, '', 40, '2026-08-02')],
  );
  eq('match branch 3: ambiguous candidate is not proposed', r.proposed.length, 0);
  eq('match branch 3: both invoices remain unmatched when ambiguous', r.unmatchedInvoices.length, 2);
}

{
  // Branch 3: invoice with no dueDate cannot be proposed (no date to compare).
  const r = match([inv('', 33, null)], [pay(0, '', 33, '2026-08-02')]);
  eq('match branch 3: no dueDate blocks a proposal', r.proposed.length, 0);
}

{
  // Branch 4: everything else stays unmatched.
  const r = match([inv('400', 10, '2026-08-01')], [pay(0, '999', 999, '2026-01-01')]);
  eq('match branch 4: unmatched invoice', r.unmatchedInvoices.length, 1);
  eq('match branch 4: unmatched payment', r.unmatchedPayments.length, 1);
}

{
  // Installments: two payments with the same VS are summed before matching.
  const r = match(
    [inv('500', 300, '2026-08-01')],
    [pay(0, '500', 100, '2026-08-01'), pay(1, '500', 200, '2026-08-15')],
  );
  eq('match installments: sums to a full match', r.matched.length, 1);
  eq('match installments: paidAmount is the sum', r.matched[0].paidAmount, 300);
  eq('match installments: both payments attached', r.matched[0].payments.length, 2);
}

{
  // Configurable tolerance: a 1 EUR difference matched only with a wider tolerance.
  const strict = match([inv('600', 100, '2026-08-01')], [pay(0, '600', 101, '2026-08-01')]);
  eq('match tolerance: 1 EUR diff is partial at default tolerance', strict.partial.length, 1);
  const loose = match([inv('601', 100, '2026-08-01')], [pay(0, '601', 101, '2026-08-01')], { tolerance: 1 });
  eq('match tolerance: 1 EUR diff matches with tolerance:1', loose.matched.length, 1);
}

{
  // Configurable date window.
  const strict = match([inv('', 20, '2026-08-01')], [pay(0, '', 20, '2026-09-30')]);
  eq('match dateWindowDays: 60-day gap not proposed at default 45', strict.proposed.length, 0);
  const loose = match([inv('', 20, '2026-08-01')], [pay(0, '', 20, '2026-09-30')], { dateWindowDays: 90 });
  eq('match dateWindowDays: proposed with a wider window', loose.proposed.length, 1);
}

{
  // Invoices with a row error never enter matching.
  const r = match([inv('700', 10, '2026-08-01', { hasError: true, amount: null })], [pay(0, '700', 10, '2026-08-01')]);
  eq('match: invoice with hasError is skipped entirely', r.matched.length + r.partial.length, 0);
}

eq('match: DEFAULT_TOLERANCE constant', DEFAULT_TOLERANCE, 0.01);
eq('match: DEFAULT_DATE_WINDOW_DAYS constant', DEFAULT_DATE_WINDOW_DAYS, 45);

// ═══════════════════════════════ report() ═══════════════════════════════════

{
  const invoices = [
    inv('1', 450, '2026-08-01'),   // matched
    inv('2', 100, '2026-08-05'),   // partial (paid 90)
    inv('', 300, '2026-08-12'),    // proposed
    inv('3', 200, '2026-08-10'),   // unmatched -> overdue
  ];
  const payments = [
    pay(0, '1', 450, '2026-08-02'),
    pay(1, '2', 90, '2026-08-06'),
    pay(2, '', 300, '2026-08-20'),
    pay(3, '999', 50, '2026-08-01'),
  ];
  const mr = match(invoices, payments);
  const rep = report(mr, { today: '2026-09-06' });

  eq('report: matched includes confirmed + proposed', rep.matched.length, 2);
  eq('report: partial list length', rep.partial.length, 1);
  eq('report: overdueInvoices list length', rep.overdueInvoices.length, 1);
  eq('report: unmatchedPayments list length', rep.unmatchedPayments.length, 1);
  eq('report: overdue days computed against today', rep.overdueInvoices[0].daysOverdue, daysBetween('2026-08-10', '2026-09-06'));
  eq('report: summary.matchedCount excludes proposals', rep.summary.matchedCount, 1);
  eq('report: summary.proposedCount', rep.summary.proposedCount, 1);
  eq('report: summary.partialCount', rep.summary.partialCount, 1);
  eq('report: summary.overdueCount', rep.summary.overdueCount, 1);
  eq('report: summary.unmatchedPaymentsCount', rep.summary.unmatchedPaymentsCount, 1);
  close('report: summary.matchedSum', rep.summary.matchedSum, 450, 0.001);
  eq('report: markPaid only has the confirmed match (not the proposal)', rep.markPaid.length, 1);
  eq('report: markPaid invoice number', rep.markPaid[0].invoiceNumber, 'F-1');
  eq('report: markPaid paid date', rep.markPaid[0].paidDate, '2026-08-02');

  // CSV export of each list.
  const csvMatched = toCsv(rep.matched, { columns: MATCHED_COLUMNS });
  includes('toCsv matched: header row', csvMatched, 'Číslo faktúry');
  includes('toCsv matched: proposal flagged as návrh', csvMatched, 'návrh');
  const csvOverdue = toCsv(rep.overdueInvoices, { columns: OVERDUE_COLUMNS });
  includes('toCsv overdue: header includes days overdue', csvOverdue, 'Dní po splatnosti');
  const csvUnmatched = toCsv(rep.unmatchedPayments, { columns: UNMATCHED_PAYMENTS_COLUMNS });
  includes('toCsv unmatchedPayments: header includes protistrana', csvUnmatched, 'Protistrana');
  const csvMarkPaid = toCsv(rep.markPaid, { columns: MARK_PAID_COLUMNS });
  includes('toCsv markPaid: header includes dátum úhrady', csvMarkPaid, 'Dátum úhrady');
  ok('toCsv: BOM prefix present by default', csvMatched.charCodeAt(0) === 0xfeff);
  const csvNoBom = toCsv(rep.matched, { columns: MATCHED_COLUMNS, bom: false });
  ok('toCsv: bom:false omits the BOM', csvNoBom.charCodeAt(0) !== 0xfeff);
  const csvComma = toCsv(rep.matched, { columns: MATCHED_COLUMNS, decimalComma: true, bom: false });
  includes('toCsv: decimalComma swaps "." for ","', csvComma, '450,00');
}

deepEq('column sets: PARTIAL_COLUMNS has no proposal column', PARTIAL_COLUMNS.some((c) => c.key === 'proposal'), false);
ok('column sets: MATCHED_COLUMNS has a proposal column', MATCHED_COLUMNS.some((c) => c.key === 'proposal'));

// ═══════════════════════════════ licence.js ═════════════════════════════════

eq('licence: plan constant is the bundle plan sepa-pro', DEFAULT_PLAN, 'sepa-pro');
eq('licence: parse() rejects malformed key', parseLicence('not-a-licence'), null);
eq('licence: isValid() on garbage is malformed', (await isValidLicence('garbage')).reason, 'malformed');
eq('licence: load() starts empty', loadLicence(), null);
ok('licence: save() then load() round-trips', (saveLicence('abc.def'), loadLicence() === 'abc.def'));
ok('licence: clear() removes it', (clearLicence(), loadLicence() === null));
ok('licence: todayIso matches YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(licenceTodayIso()));
eq('licence: STORAGE_KEY is shared across the bundle', LICENCE_STORAGE_KEY, 'arling_licence_sepa-pro');

// ═══════════════════════════════ pro.js ═════════════════════════════════════

ok('pro: BUY_URL is the Stripe bundle link', BUY_URL.startsWith('https://buy.stripe.com/'));

{
  clearHistory();
  const before = loadMappingPresets();
  const res = saveMappingPreset({ name: 'Moja Pohoda', mapping: { vs: 1, amount: 2 } });
  eq('pro: saveMappingPreset ok', res.ok, true);
  eq('pro: loadMappingPresets grew by one', loadMappingPresets().length, before.length + 1);
  const after = removeMappingPreset(res.preset.id);
  eq('pro: removeMappingPreset removes it', after.some((p) => p.id === res.preset.id), false);
  eq('pro: saveMappingPreset without a name fails', saveMappingPreset({ mapping: {} }).ok, false);
}

{
  const defaults = loadToleranceSettings();
  eq('pro: default tolerance setting', defaults.tolerance, DEFAULT_TOLERANCE);
  eq('pro: default dateWindowDays setting', defaults.dateWindowDays, DEFAULT_DATE_WINDOW_DAYS);
  saveToleranceSettings({ tolerance: 0.5, dateWindowDays: 10 });
  const saved = loadToleranceSettings();
  eq('pro: saved tolerance round-trips', saved.tolerance, 0.5);
  eq('pro: saved dateWindowDays round-trips', saved.dateWindowDays, 10);
}

{
  const csv = buildMarkPaidExport('POHODA', [{ invoiceNumber: 'F1', vs: '1', paidDate: '2026-08-02', paidAmount: 450 }]);
  includes('pro: buildMarkPaidExport POHODA has expected header', csv, 'Variabilní symbol');
  eq('pro: buildMarkPaidExport unknown format returns null', buildMarkPaidExport('NOPE', []), null);
  ok('pro: MARK_PAID_EXPORT_FORMATS has all three programs', ['POHODA', 'OMEGA', 'MONEY_S3'].every((k) => k in MARK_PAID_EXPORT_FORMATS));
}

{
  const merged = mergeStatementPayments([{ payments: [{ idx: 0, vs: 'a' }] }, { payments: [{ idx: 0, vs: 'b' }] }]);
  eq('pro: mergeStatementPayments concatenates', merged.length, 2);
  deepEq('pro: mergeStatementPayments reindexes idx', merged.map((p) => p.idx), [0, 1]);
}

{
  clearHistory();
  eq('pro: loadHistory starts empty after clear', loadHistory().length, 0);
  for (let i = 0; i < HISTORY_MAX + 5; i++) addHistoryEntry({ invoiceCount: i, paymentCount: i });
  const hist = loadHistory();
  eq(`pro: addHistoryEntry caps history length at HISTORY_MAX (${HISTORY_MAX})`, hist.length, HISTORY_MAX);
  eq('pro: most recently added entry is first', hist[0].invoiceCount, HISTORY_MAX + 4);
  clearHistory();
}

// ═══════════════════════════════ summary ═══════════════════════════════════

console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total assertions)`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
