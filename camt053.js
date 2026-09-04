// camt053.js: camt.053 bank statement (ISO 20022) to table engine.
//
// Pure, deterministic, 100% client-side: given the text of a camt.053
// Bank-to-Customer Statement XML file (výpis z účtu, exported by internet
// banking), parses it with a small dependency-free tolerant parser (works
// identically in the browser and in Node: no DOMParser, no npm dependency,
// same approach as the sibling tool's doctor-pain001.js) and returns a flat
// row list ready for a table, CSV, or XLSX, plus a balance-checked summary.
//
// Nothing in this file makes a network request. It only reads the string
// you pass to parse().
//
// Supports camt.053.001.02 and camt.053.001.08 (namespace
// urn:iso:std:iso:20022:tech:xsd:camt.053.001.0{2,8}). The element names
// this engine reads (GrpHdr, Stmt, Acct, Bal, Ntry, NtryDtls/TxDtls, Refs,
// BkTxCd, RltdPties, RltdAgts, RmtInf) are stable across both versions; only
// optional fields around them differ (LEI, structured postal address, …),
// none of which this engine reads. A namespace outside that set is still
// parsed the same tolerant way and flagged with version "other".
//
// Verified against a real Tatra banka camt.053.001.02 sample statement
// (vypis_xml_camt053.xml, fetched from tatrabanka.sk, 2015 export, fetched
// 2026-09-06): root <Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">,
// <Stmt><Id>, <LglSeqNb>, <FrToDt><FrDtTm>/<ToDtTm>, <Acct><Id><IBAN>,
// <Ccy>, <Ownr><Nm>, <Bal><Tp><CdOrPrtry><Cd>OPBD/CLBD, <Amt Ccy="EUR">,
// <CdtDbtInd>, <Dt><Dt>, and per <Ntry>: <NtryRef>, <Amt Ccy="EUR">,
// <CdtDbtInd>, <Sts>, <BookgDt><Dt>, <ValDt><Dt>, <BkTxCd><Prtry><Cd>/<Issr>,
// <NtryDtls><TxDtls><Refs><AcctSvcrRef>/<EndToEndId>/<TxId>,
// <BkTxCd><Domn><Cd>/<Fmly><Cd>/<Fmly><SubFmlyCd>, <RltdPties><Cdtr><Nm>,
// <CdtrAcct><Id><IBAN>, <RltdAgts><CdtrAgt><FinInstnId><BIC>,
// <RmtInf><Ustrd>, with the VS/SS/KS convention written into EndToEndId as
// "/VS.../SS.../KS..." (same National Bank of Slovakia convention the
// sibling SEPA pain.001 tools already document and check).

// ───────────────────────────── small helpers ─────────────────────────────

function safeStr(v) {
  return typeof v === 'string' ? v : '';
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ───────────────────────── tolerant XML → tree parser ─────────────────────
// Deliberately not DOMParser (unavailable in Node, and we want byte-for-byte
// identical behaviour in the browser and in tests.mjs). Same approach as
// doctor-pain001.js: handles elements, attributes, text, CDATA, comments,
// and the XML declaration (skipped), and is tolerant of a malformed file
// (unclosed / mismatched tags) instead of throwing, since a partially
// readable statement is still useful to an accountant.

const ENTITY_MAP = { amp: '&', lt: '<', gt: '>', apos: "'", quot: '"' };

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENTITY_MAP, body) ? ENTITY_MAP[body] : m;
  });
}

function localName(tag) {
  const i = tag.lastIndexOf(':');
  return i === -1 ? tag : tag.slice(i + 1);
}

function parseAttrs(str) {
  const attrs = {};
  const re = /([^\s=\/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(str))) {
    attrs[m[1]] = decodeEntities(m[3] !== undefined ? m[3] : m[4]);
  }
  return attrs;
}

function makeNode(tag, attrs, parent) {
  return { tag: localName(tag), rawTag: tag, attrs: attrs || {}, children: [], parent: parent || null };
}

function parseXml(text) {
  const src = safeStr(text).replace(/^﻿/, '');
  const errors = [];
  const root = makeNode('#root', {}, null);
  let current = root;
  const stack = [root];
  let i = 0;
  const len = src.length;
  let sawAnyElement = false;

  while (i < len) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      const text = src.slice(i);
      if (text.trim()) current.children.push({ type: 'text', text: decodeEntities(text) });
      break;
    }
    if (lt > i) {
      const text = src.slice(i, lt);
      if (text.trim()) current.children.push({ type: 'text', text: decodeEntities(text) });
    }

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? len : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      const content = end === -1 ? src.slice(lt + 9) : src.slice(lt + 9, end);
      current.children.push({ type: 'text', text: content });
      i = end === -1 ? len : end + 3;
      continue;
    }
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2);
      i = end === -1 ? len : end + 2;
      continue;
    }
    if (src.startsWith('<!', lt)) {
      const end = src.indexOf('>', lt + 2);
      i = end === -1 ? len : end + 1;
      continue;
    }

    let j = lt + 1;
    let inQuote = null;
    while (j < len) {
      const c = src[j];
      if (inQuote) {
        if (c === inQuote) inQuote = null;
      } else if (c === '"' || c === "'") {
        inQuote = c;
      } else if (c === '>') {
        break;
      }
      j++;
    }
    if (j >= len) {
      errors.push('Nezatvorený tag na pozícii ' + lt + ' (chýba ">").');
      break;
    }
    const inner = src.slice(lt + 1, j);
    i = j + 1;

    if (inner.startsWith('/')) {
      const closeName = inner.slice(1).trim();
      let foundIdx = -1;
      for (let k = stack.length - 1; k >= 1; k--) {
        if (stack[k].rawTag === closeName) { foundIdx = k; break; }
      }
      if (foundIdx === -1) {
        errors.push(`Zatvárací tag </${closeName}> nemá zodpovedajúci otvárací tag.`);
      } else {
        if (foundIdx !== stack.length - 1) {
          errors.push(`Tag <${stack[stack.length - 1].rawTag}> nebol správne zatvorený pred </${closeName}>.`);
        }
        stack.length = foundIdx;
        current = stack[stack.length - 1];
      }
      continue;
    }

    const selfClosing = inner.endsWith('/');
    const body = (selfClosing ? inner.slice(0, -1) : inner).trim();
    const nameMatch = body.match(/^([^\s\/]+)/);
    if (!nameMatch) continue;
    const tagName = nameMatch[1];
    const attrs = parseAttrs(body.slice(nameMatch[0].length));
    const node = makeNode(tagName, attrs, current);
    current.children.push({ type: 'element', node });
    sawAnyElement = true;
    if (!selfClosing) {
      stack.push(node);
      current = node;
    }
  }

  if (stack.length > 1) {
    errors.push('Nasledovné tagy neboli zatvorené: ' + stack.slice(1).map((n) => n.rawTag).join(', '));
  }
  if (!sawAnyElement) {
    errors.push('V súbore sa nenašiel žiadny XML element.');
  }

  return { root, malformed: errors.length > 0, errors };
}

// ── tree query helpers (operate on the {tag, attrs, children} node shape) ──

function firstChild(node, tag) {
  if (!node) return null;
  const found = node.children.find((c) => c.type === 'element' && c.node.tag === tag);
  return found ? found.node : null;
}

function allChildren(node, tag) {
  if (!node) return [];
  return node.children.filter((c) => c.type === 'element' && c.node.tag === tag).map((c) => c.node);
}

function findFirstDeep(node, tag) {
  if (!node) return null;
  for (const c of node.children) {
    if (c.type === 'element') {
      if (c.node.tag === tag) return c.node;
      const deep = findFirstDeep(c.node, tag);
      if (deep) return deep;
    }
  }
  return null;
}

function textOf(node) {
  if (!node) return '';
  let out = '';
  for (const c of node.children) {
    if (c.type === 'text') out += c.text;
  }
  return out.trim();
}

// path(node, 'A', 'B', 'C') === firstChild(firstChild(firstChild(node,'A'),'B'),'C')
function path(node, ...tags) {
  let n = node;
  for (const t of tags) {
    n = firstChild(n, t);
    if (!n) return null;
  }
  return n;
}

function textAt(node, ...tags) {
  return textOf(path(node, ...tags));
}

// ─────────────────────────── amount / date helpers ─────────────────────────

function parseAmount(raw) {
  const s = safeStr(raw).trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// <Dt>YYYY-MM-DD</Dt> or <DtTm>YYYY-MM-DDThh:mm:ss...</DtTm>: return the date
// part only (yyyy-mm-dd), which is what an accountant reconciling entries by
// day wants; the full timestamp (when present) is kept in *Full.
function dateFrom(node) {
  if (!node) return { date: '', full: '' };
  const dt = firstChild(node, 'Dt');
  if (dt) {
    const t = textOf(dt);
    return { date: t.slice(0, 10), full: t };
  }
  const dtTm = firstChild(node, 'DtTm');
  if (dtTm) {
    const t = textOf(dtTm);
    return { date: t.slice(0, 10), full: t };
  }
  return { date: '', full: '' };
}

// ──────────────────────────── VS/SS/KS extraction ──────────────────────────
// Slovak banks have no dedicated pain.001/camt.053 field for variabilný
// (VS), špecifický (ŠS) and konštantný (KS) symbol. The National Bank of
// Slovakia convention (the same one the sibling SEPA pain.001 tools check)
// packs them into EndToEndId as "/VS.../SS.../KS...", in that order, any
// of the three optional. Some banks instead (or additionally) put a plain
// reference into RmtInf/Strd/CdtrRefInf/Ref, or leave only free text in
// RmtInf/Ustrd ("VS: 1234", "VS1234", "vs.1234"…). This engine tries, in
// order, and records which one matched so the UI can show it:
//   1. EndToEndId  /VS.../SS.../KS...   (vsSource: "endtoend")
//   2. RmtInf/Strd/CdtrRefInf/Ref, digits only, used as VS (vsSource: "structured")
//   3. RmtInf/Ustrd free text "VS", "ŠS"/"SS", "KS" followed by digits (vsSource: "ustrd")

// Same pattern (and the same "keep leading zeros, they're part of a
// constant symbol like 0308") as the sibling SEPA pain.001 Doctor's own
// EndToEndId reader: /\/(VS|SS|KS)(\d*)/gi, first match per kind wins.
function extractFromEndToEnd(e2e) {
  const s = safeStr(e2e);
  const re = /\/(VS|SS|KS)(\d*)/gi;
  const out = { vs: '', ss: '', ks: '' };
  let m;
  while ((m = re.exec(s))) {
    const kind = m[1].toLowerCase();
    if (!out[kind] && m[2]) out[kind] = m[2];
  }
  return out;
}

function extractFromUstrd(text) {
  const s = safeStr(text);
  const vs = s.match(/(?:^|[^A-Za-zÁ-Žá-ž])VS\.?:?\s*(\d{1,10})/i);
  const ss = s.match(/(?:^|[^A-Za-zÁ-Žá-ž])(?:ŠS|SS)\.?:?\s*(\d{1,10})/i);
  const ks = s.match(/(?:^|[^A-Za-zÁ-Žá-ž])KS\.?:?\s*(\d{1,10})/i);
  return { vs: vs ? vs[1] : '', ss: ss ? ss[1] : '', ks: ks ? ks[1] : '' };
}

function extractSymbols(endToEndId, structuredRef, ustrd) {
  const fromE2E = extractFromEndToEnd(endToEndId);
  if (fromE2E.vs || fromE2E.ss || fromE2E.ks) {
    return { vs: fromE2E.vs, ss: fromE2E.ss, ks: fromE2E.ks, source: 'endtoend' };
  }
  const ref = safeStr(structuredRef).replace(/\D/g, '');
  if (ref) {
    return { vs: ref, ss: '', ks: '', source: 'structured' };
  }
  const fromUstrd = extractFromUstrd(ustrd);
  if (fromUstrd.vs || fromUstrd.ss || fromUstrd.ks) {
    return { vs: fromUstrd.vs, ss: fromUstrd.ss, ks: fromUstrd.ks, source: 'ustrd' };
  }
  return { vs: '', ss: '', ks: '', source: '' };
}

// ────────────────────────────── bank detection ─────────────────────────────
// Four-digit Slovak domestic bank codes → BIC, used only to label the
// Umami "convert" event (never sent anywhere with payment content: see
// index.html) and to show a friendly bank name in the summary.

const SK_BANK_BIC = {
  TATRSKBX: 'tatrabanka', GIBASKBX: 'slsp', SUBASKBX: 'vub', CEKOSKBX: 'csob',
  UNCRSKBX: 'unicredit', POBNSKBA: 'postovabanka', KOMASK2X: 'kb', OTPVSKBX: 'otp',
  BSLOSK22: 'wustenrot', PRVASK21: 'primabanka', FIOZSKBA: 'fio', AIRASK21: 'zunosk',
};

function bankFromBic(bic) {
  const b = safeStr(bic).trim().toUpperCase();
  return SK_BANK_BIC[b] || (b ? 'iná' : '');
}

// ──────────────────────────────── parse() ──────────────────────────────────

function readAccount(acctNode) {
  if (!acctNode) return { iban: '', otherId: '', currency: '', ownerName: '' };
  const iban = textAt(acctNode, 'Id', 'IBAN');
  const otherId = iban ? '' : textAt(acctNode, 'Id', 'Othr', 'Id');
  return {
    iban,
    otherId,
    currency: textOf(firstChild(acctNode, 'Ccy')),
    ownerName: textAt(acctNode, 'Ownr', 'Nm'),
  };
}

function readBalances(stmtNode) {
  return allChildren(stmtNode, 'Bal').map((bal) => {
    const amtNode = firstChild(bal, 'Amt');
    const amount = parseAmount(textOf(amtNode));
    const cdi = textOf(firstChild(bal, 'CdtDbtInd'));
    const signed = amount === null ? null : (cdi === 'DBIT' ? -amount : amount);
    const { date } = dateFrom(firstChild(bal, 'Dt'));
    return {
      type: textAt(bal, 'Tp', 'CdOrPrtry', 'Cd') || textAt(bal, 'Tp', 'CdOrPrtry', 'Prtry'),
      amount: signed,
      currency: amtNode ? (amtNode.attrs.Ccy || '') : '',
      date,
    };
  });
}

function readBkTxCd(node) {
  // node is either the Ntry itself or a TxDtls: both can carry BkTxCd, with
  // either a structured Domn/Fmly/SubFmlyCd path or a bank-proprietary one.
  const bkTxCd = firstChild(node, 'BkTxCd');
  if (!bkTxCd) return null;
  const domn = firstChild(bkTxCd, 'Domn');
  const fmly = domn ? firstChild(domn, 'Fmly') : null;
  const prtry = firstChild(bkTxCd, 'Prtry');
  return {
    domainCode: domn ? textOf(firstChild(domn, 'Cd')) : '',
    familyCode: fmly ? textOf(firstChild(fmly, 'Cd')) : '',
    subFamilyCode: fmly ? textOf(firstChild(fmly, 'SubFmlyCd')) : '',
    proprietaryCode: prtry ? textOf(firstChild(prtry, 'Cd')) : '',
    proprietaryIssuer: prtry ? textOf(firstChild(prtry, 'Issr')) : '',
  };
}

function formatTxType(bkTxCd) {
  if (!bkTxCd) return '';
  const parts = [bkTxCd.domainCode, bkTxCd.familyCode, bkTxCd.subFamilyCode].filter(Boolean);
  const structured = parts.join('-');
  const proprietary = bkTxCd.proprietaryCode
    ? bkTxCd.proprietaryCode + (bkTxCd.proprietaryIssuer ? ' (' + bkTxCd.proprietaryIssuer + ')' : '')
    : '';
  if (structured && proprietary) return structured + ' / ' + proprietary;
  return structured || proprietary;
}

// One TxDtls (or, when an entry has no NtryDtls/TxDtls at all, the Ntry
// itself standing in for one) turned into a flat row of parsed fields. This
// is where "one row per underlying payment" comes from for a batched entry
// with several TxDtls: each gets its own row so VS/SS/KS pairing against
// invoices works per payment, not per bank-side batch entry.
function readTxDtls(txDtlsNode, ntryNode, direction) {
  const refs = txDtlsNode ? firstChild(txDtlsNode, 'Refs') : null;
  const endToEndId = refs ? textOf(firstChild(refs, 'EndToEndId')) : '';
  const acctSvcrRef = (refs ? textOf(firstChild(refs, 'AcctSvcrRef')) : '') || textOf(firstChild(ntryNode, 'NtryRef'));
  const txId = refs ? textOf(firstChild(refs, 'TxId')) : '';

  const rltdPties = txDtlsNode ? firstChild(txDtlsNode, 'RltdPties') : null;
  const rltdAgts = txDtlsNode ? firstChild(txDtlsNode, 'RltdAgts') : null;
  // DBIT: money leaves the account owner's account, so the interesting
  // counterparty is the Creditor. CRDT: money arrives, counterparty is the
  // Debtor. (Confirmed against the real Tatra banka sample: a DBIT entry
  // carries RltdPties/Cdtr, not Dbtr.)
  const partyTag = direction === 'DBIT' ? 'Cdtr' : 'Dbtr';
  const acctTag = direction === 'DBIT' ? 'CdtrAcct' : 'DbtrAcct';
  const agtTag = direction === 'DBIT' ? 'CdtrAgt' : 'DbtrAgt';
  const counterpartyName = textAt(rltdPties, partyTag, 'Nm');
  const counterpartyIban = textAt(rltdPties, acctTag, 'Id', 'IBAN');
  const counterpartyBic = textAt(rltdAgts, agtTag, 'FinInstnId', 'BIC') || textAt(rltdAgts, agtTag, 'FinInstnId', 'BICFI');

  const rmtInf = txDtlsNode ? firstChild(txDtlsNode, 'RmtInf') : null;
  const message = rmtInf ? allChildren(rmtInf, 'Ustrd').map(textOf).filter(Boolean).join(' | ') : '';
  const structuredRef = rmtInf ? textAt(rmtInf, 'Strd', 'CdtrRefInf', 'Ref') : '';

  const symbols = extractSymbols(endToEndId, structuredRef, message);

  const chrgsNode = txDtlsNode ? firstChild(txDtlsNode, 'Chrgs') : null;
  const charges = chrgsNode ? parseAmount(textAt(chrgsNode, 'TtlChrgsAndTaxAmt') || textOf(firstChild(chrgsNode, 'Amt'))) : null;

  // A TxDtls only repeats Amt/CdtDbtInd of its own when it splits a batched
  // entry into several differently-sized payments; a plain single-payment
  // entry leaves them out and the Ntry-level Amt/CdtDbtInd applies.
  const ownAmtNode = txDtlsNode ? firstChild(txDtlsNode, 'Amt') : null;
  const ownAmount = ownAmtNode ? parseAmount(textOf(ownAmtNode)) : null;
  const ownCdi = txDtlsNode ? textOf(firstChild(txDtlsNode, 'CdtDbtInd')) : '';

  return {
    endToEndId, acctSvcrRef, txId,
    counterpartyName, counterpartyIban, counterpartyBic,
    message, structuredRef,
    vs: symbols.vs, ss: symbols.ss, ks: symbols.ks, vsSource: symbols.source,
    charges,
    ownAmount, ownDirection: ownCdi || direction,
  };
}

function readEntry(ntryNode, ctx) {
  const amount = parseAmount(textOf(firstChild(ntryNode, 'Amt')));
  const amtNode = firstChild(ntryNode, 'Amt');
  const currency = amtNode ? (amtNode.attrs.Ccy || ctx.accountCurrency || '') : (ctx.accountCurrency || '');
  const direction = textOf(firstChild(ntryNode, 'CdtDbtInd'));
  const status = textOf(firstChild(ntryNode, 'Sts')) || textAt(ntryNode, 'Sts', 'Cd');
  const { date: bookingDate } = dateFrom(firstChild(ntryNode, 'BookgDt'));
  const { date: valueDate } = dateFrom(firstChild(ntryNode, 'ValDt'));
  const ntryLevelBkTxCd = readBkTxCd(ntryNode);

  const ntryDtls = firstChild(ntryNode, 'NtryDtls');
  const txDtlsList = ntryDtls ? allChildren(ntryDtls, 'TxDtls') : [];

  const bases = txDtlsList.length > 0 ? txDtlsList : [null];

  return bases.map((txDtls) => {
    const parsed = readTxDtls(txDtls, ntryNode, direction);
    const txBkTxCd = txDtls ? readBkTxCd(txDtls) : null;
    const bkTxCd = txBkTxCd || ntryLevelBkTxCd;
    const rowAmount = parsed.ownAmount !== null ? parsed.ownAmount : amount;
    const rowDirection = parsed.ownAmount !== null ? parsed.ownDirection : direction;
    const signedAmount = rowAmount === null ? null : round2(rowDirection === 'DBIT' ? -rowAmount : rowAmount);

    return {
      statementId: ctx.statementId,
      account: ctx.account,
      bookingDate,
      valueDate,
      amount: signedAmount,
      currency,
      direction: rowDirection,
      status,
      bankRef: parsed.acctSvcrRef,
      txId: parsed.txId,
      txType: formatTxType(bkTxCd),
      counterpartyName: parsed.counterpartyName,
      counterpartyIban: parsed.counterpartyIban,
      counterpartyBic: parsed.counterpartyBic,
      endToEndId: parsed.endToEndId,
      vs: parsed.vs,
      ss: parsed.ss,
      ks: parsed.ks,
      vsSource: parsed.vsSource,
      message: parsed.message,
      charges: parsed.charges,
    };
  });
}

function readStatement(stmtNode) {
  const account = readAccount(firstChild(stmtNode, 'Acct'));
  const id = textOf(firstChild(stmtNode, 'Id'));
  const legalSeqNb = textOf(firstChild(stmtNode, 'LglSeqNb'));
  const elctrncSeqNb = textOf(firstChild(stmtNode, 'ElctrncSeqNb'));
  const creDtTm = textOf(firstChild(stmtNode, 'CreDtTm'));
  const frToDt = firstChild(stmtNode, 'FrToDt');
  const fromDateTime = frToDt ? (textOf(firstChild(frToDt, 'FrDtTm')) || textAt(frToDt, 'FrDt', 'Dt')) : '';
  const toDateTime = frToDt ? (textOf(firstChild(frToDt, 'ToDtTm')) || textAt(frToDt, 'ToDt', 'Dt')) : '';
  const servicerBic = textAt(stmtNode, 'Svcr', 'FinInstnId', 'BIC') || textAt(stmtNode, 'Svcr', 'FinInstnId', 'BICFI');

  const balances = readBalances(stmtNode);
  const ctx = { statementId: id, account: account.iban || account.otherId, accountCurrency: account.currency };
  const entries = [];
  allChildren(stmtNode, 'Ntry').forEach((ntryNode, idx) => {
    const rows = readEntry(ntryNode, ctx);
    rows.forEach((r) => { r.entryIndex = idx + 1; entries.push(r); });
  });

  return {
    id, legalSeqNb, elctrncSeqNb, creDtTm, fromDateTime, toDateTime,
    account, servicerBic, balances, entries,
  };
}

/**
 * Parse a camt.053 XML document into a normalized, engine-native shape.
 * Tolerant of malformed XML: returns as much as it could read plus an
 * `errors` list, never throws on bad input (only on a non-string argument
 * failing safeStr, which never happens since safeStr coerces).
 */
function parse(xmlText) {
  const { root, malformed, errors } = parseXml(xmlText);
  const docNode = findFirstDeep(root, 'Document') || firstChild(root, 'Document');
  const namespace = docNode ? (docNode.attrs.xmlns || '') : '';
  const versionMatch = namespace.match(/camt\.053\.001\.(\d+)/);
  const version = versionMatch ? '001.' + versionMatch[1].padStart(2, '0') : (namespace ? 'other' : '');

  const bkToCstmr = docNode ? firstChild(docNode, 'BkToCstmrStmt') : null;
  const grpHdrNode = bkToCstmr ? firstChild(bkToCstmr, 'GrpHdr') : null;
  const groupHeader = { msgId: textOf(firstChild(grpHdrNode, 'MsgId')), creDtTm: textOf(firstChild(grpHdrNode, 'CreDtTm')) };

  const stmtNodes = bkToCstmr ? allChildren(bkToCstmr, 'Stmt') : [];
  const statements = stmtNodes.map(readStatement);

  const allErrors = errors.slice();
  if (!docNode) allErrors.push('Nenašiel sa koreňový element <Document>. Toto pravdepodobne nie je camt.053 XML súbor.');
  else if (!bkToCstmr) allErrors.push('Nenašiel sa element <BkToCstmrStmt>. Toto pravdepodobne nie je camt.053 (Bank-to-Customer Statement) súbor.');
  else if (statements.length === 0) allErrors.push('V súbore sa nenašiel žiadny <Stmt> (výpis).');

  const bankBic = statements.length ? statements[0].servicerBic : '';

  return {
    ok: !malformed && !!docNode && !!bkToCstmr && statements.length > 0,
    malformed,
    errors: allErrors,
    namespace,
    version,
    groupHeader,
    statements,
    bank: bankFromBic(bankBic),
  };
}

// ──────────────────────────────── toRows() ──────────────────────────────────

const COLUMNS = [
  { key: 'statementId', label: 'Číslo výpisu' },
  { key: 'account', label: 'Účet (IBAN)' },
  { key: 'bookingDate', label: 'Dátum zaúčtovania' },
  { key: 'valueDate', label: 'Dátum valuty' },
  { key: 'amount', label: 'Suma' },
  { key: 'currency', label: 'Mena' },
  { key: 'status', label: 'Status' },
  { key: 'bankRef', label: 'Referencia banky' },
  { key: 'txType', label: 'Typ transakcie' },
  { key: 'counterpartyName', label: 'Protistrana' },
  { key: 'counterpartyIban', label: 'IBAN protistrany' },
  { key: 'counterpartyBic', label: 'BIC protistrany' },
  { key: 'endToEndId', label: 'EndToEndId' },
  { key: 'vs', label: 'VS' },
  { key: 'ss', label: 'ŠS' },
  { key: 'ks', label: 'KS' },
  { key: 'message', label: 'Správa pre príjemcu' },
  { key: 'charges', label: 'Poplatok' },
];

/**
 * Flatten a parse() result (or any object with a `.statements` array, e.g.
 * one hand-assembled from several parse() calls to merge multiple uploaded
 * files) into a flat row list, one row per underlying payment.
 */
function toRows(parsed) {
  if (!parsed || !Array.isArray(parsed.statements)) return [];
  const rows = [];
  parsed.statements.forEach((stmt) => {
    stmt.entries.forEach((e) => rows.push(e));
  });
  return rows;
}

// ──────────────────────────────── toCsv() ──────────────────────────────────

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
 * Build CSV text from rows produced by toRows(). Slovak Excel defaults to
 * ";" as the list separator (it reserves "," for decimals), so that is the
 * default delimiter here; decimalComma additionally swaps "." for "," in
 * amounts to match a Slovak locale Excel install. Returns the text with a
 * UTF-8 BOM prefixed by default (bom:false to omit), CRLF line endings.
 */
function toCsv(rows, opts) {
  const o = opts || {};
  const delimiter = o.delimiter || ';';
  const decimalComma = !!o.decimalComma;
  const bom = o.bom !== false;
  const columns = Array.isArray(o.columns) && o.columns.length
    ? COLUMNS.filter((c) => o.columns.includes(c.key))
    : COLUMNS;

  const lines = [];
  lines.push(columns.map((c) => csvCell(c.label, delimiter)).join(delimiter));
  (rows || []).forEach((r) => {
    const line = columns.map((c) => {
      const raw = c.key === 'amount' || c.key === 'charges' ? formatAmountForCsv(r[c.key], decimalComma) : r[c.key];
      return csvCell(raw, delimiter);
    }).join(delimiter);
    lines.push(line);
  });

  const text = lines.join('\r\n');
  return bom ? '﻿' + text : text;
}

// ──────────────────────────────── summarize() ──────────────────────────────

function pickBalance(balances, codes) {
  for (const code of codes) {
    const found = balances.find((b) => b.type === code);
    if (found) return found;
  }
  return null;
}

function summarizeStatement(stmt) {
  const entryCount = stmt.entries.length;
  let creditSum = 0, debitSum = 0, creditCount = 0, debitCount = 0;
  const currencies = new Set();
  stmt.entries.forEach((e) => {
    if (e.currency) currencies.add(e.currency);
    if (e.amount === null) return;
    if (e.amount >= 0) { creditSum += e.amount; creditCount++; }
    else { debitSum += -e.amount; debitCount++; }
  });
  creditSum = round2(creditSum);
  debitSum = round2(debitSum);
  const netSum = round2(creditSum - debitSum);

  const opening = pickBalance(stmt.balances, ['OPBD', 'PRCD']);
  const closing = pickBalance(stmt.balances, ['CLBD', 'CLAV']);
  const openingBalance = opening ? opening.amount : null;
  const closingBalance = closing ? closing.amount : null;

  let balanceCheckOk = null;
  let balanceDiff = null;
  if (openingBalance !== null && closingBalance !== null) {
    balanceDiff = round2(openingBalance + netSum - closingBalance);
    balanceCheckOk = Math.abs(balanceDiff) < 0.005;
  }

  return {
    statementId: stmt.id,
    account: stmt.account.iban || stmt.account.otherId,
    fromDateTime: stmt.fromDateTime,
    toDateTime: stmt.toDateTime,
    entryCount, creditCount, debitCount, creditSum, debitSum, netSum,
    currencies: Array.from(currencies),
    openingBalance, openingDate: opening ? opening.date : '',
    closingBalance, closingDate: closing ? closing.date : '',
    balanceCheckOk, balanceDiff,
  };
}

/**
 * Summarize a parse() result (or any object with a `.statements` array):
 * per-statement entry counts, credit/debit totals, and the opening +
 * movements = closing balance check, plus the same totals aggregated
 * across every statement (relevant when several files/accounts were
 * uploaded together).
 */
function summarize(parsed) {
  if (!parsed || !Array.isArray(parsed.statements)) {
    return {
      ok: false, statementCount: 0, entryCount: 0, creditCount: 0, debitCount: 0,
      creditSum: 0, debitSum: 0, netSum: 0, currencies: [],
      openingBalance: null, closingBalance: null, balanceCheckOk: null, balanceDiff: null,
      perStatement: [],
    };
  }
  const perStatement = parsed.statements.map(summarizeStatement);
  const agg = perStatement.reduce((acc, s) => {
    acc.entryCount += s.entryCount;
    acc.creditCount += s.creditCount;
    acc.debitCount += s.debitCount;
    acc.creditSum = round2(acc.creditSum + s.creditSum);
    acc.debitSum = round2(acc.debitSum + s.debitSum);
    s.currencies.forEach((c) => acc.currencies.add(c));
    return acc;
  }, { entryCount: 0, creditCount: 0, debitCount: 0, creditSum: 0, debitSum: 0, currencies: new Set() });

  const allChecksKnown = perStatement.length > 0 && perStatement.every((s) => s.balanceCheckOk !== null);
  const balanceCheckOk = allChecksKnown ? perStatement.every((s) => s.balanceCheckOk) : null;

  return {
    ok: parsed.ok !== false,
    statementCount: parsed.statements.length,
    entryCount: agg.entryCount,
    creditCount: agg.creditCount,
    debitCount: agg.debitCount,
    creditSum: agg.creditSum,
    debitSum: agg.debitSum,
    netSum: round2(agg.creditSum - agg.debitSum),
    currencies: Array.from(agg.currencies),
    openingBalance: perStatement.length === 1 ? perStatement[0].openingBalance : null,
    closingBalance: perStatement.length === 1 ? perStatement[0].closingBalance : null,
    balanceCheckOk,
    balanceDiff: perStatement.length === 1 ? perStatement[0].balanceDiff : null,
    perStatement,
  };
}

// ──────────────────────────────── sample file ──────────────────────────────
// A small, valid camt.053.001.02 statement with 3 entries (one credit, two
// debits, no real personal data), shaped after the real Tatra banka sample
// this engine was built against. Used by the "ukážka" button in index.html
// and by tests.mjs.

const SAMPLE_CAMT053_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr>
      <MsgId>ARL-20260906-000001</MsgId>
      <CreDtTm>2026-09-06T08:00:00+02:00</CreDtTm>
    </GrpHdr>
    <Stmt>
      <Id>SK6809000000000012345678-001-260906</Id>
      <LglSeqNb>1</LglSeqNb>
      <CreDtTm>2026-09-06T08:00:00+02:00</CreDtTm>
      <FrToDt>
        <FrDtTm>2026-09-01T00:00:00+02:00</FrDtTm>
        <ToDtTm>2026-09-05T23:59:59+02:00</ToDtTm>
      </FrToDt>
      <Acct>
        <Id><IBAN>SK6809000000000012345678</IBAN></Id>
        <Ccy>EUR</Ccy>
        <Ownr><Nm>Ukazkova firma s. r. o.</Nm></Ownr>
      </Acct>
      <Svcr><FinInstnId><BIC>TATRSKBX</BIC></FinInstnId></Svcr>
      <Bal>
        <Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">1000.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2026-09-01</Dt></Dt>
      </Bal>
      <Bal>
        <Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">1239.30</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2026-09-05</Dt></Dt>
      </Bal>
      <Ntry>
        <NtryRef>2026090100001</NtryRef>
        <Amt Ccy="EUR">450.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-09-02</Dt></BookgDt>
        <ValDt><Dt>2026-09-02</Dt></ValDt>
        <BkTxCd><Prtry><Cd>PMNT-RCDT</Cd><Issr>TATRA</Issr></Prtry></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <AcctSvcrRef>2026090100001</AcctSvcrRef>
              <EndToEndId>/VS2026001/SS0000/KS0308</EndToEndId>
            </Refs>
            <BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>RCDT</Cd><SubFmlyCd>ESCT</SubFmlyCd></Fmly></Domn></BkTxCd>
            <RltdPties><Dbtr><Nm>Jozef Odberatel</Nm></Dbtr><DbtrAcct><Id><IBAN>SK0502000000272000000018</IBAN></Id></DbtrAcct></RltdPties>
            <RltdAgts><DbtrAgt><FinInstnId><BIC>SUBASKBX</BIC></FinInstnId></DbtrAgt></RltdAgts>
            <RmtInf><Ustrd>Uhrada faktury 2026-0912</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <NtryRef>2026090300002</NtryRef>
        <Amt Ccy="EUR">89.90</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-09-03</Dt></BookgDt>
        <ValDt><Dt>2026-09-03</Dt></ValDt>
        <BkTxCd><Prtry><Cd>PMNT-ICDT</Cd><Issr>TATRA</Issr></Prtry></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <AcctSvcrRef>2026090300002</AcctSvcrRef>
              <EndToEndId>/VS789/KS0308</EndToEndId>
            </Refs>
            <BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>ICDT</Cd><SubFmlyCd>ESCT</SubFmlyCd></Fmly></Domn></BkTxCd>
            <RltdPties><Cdtr><Nm>Dodavatel Novak s. r. o.</Nm></Cdtr><CdtrAcct><Id><IBAN>SK8709000000002000000018</IBAN></Id></CdtrAcct></RltdPties>
            <RltdAgts><CdtrAgt><FinInstnId><BIC>GIBASKBX</BIC></FinInstnId></CdtrAgt></RltdAgts>
            <RmtInf><Ustrd>Kancelarske potreby</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <NtryRef>2026090500003</NtryRef>
        <Amt Ccy="EUR">120.80</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-09-05</Dt></BookgDt>
        <ValDt><Dt>2026-09-05</Dt></ValDt>
        <BkTxCd><Prtry><Cd>SVC-FEE</Cd><Issr>TATRA</Issr></Prtry></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <AcctSvcrRef>2026090500003</AcctSvcrRef>
              <EndToEndId>NOTPROVIDED</EndToEndId>
            </Refs>
            <BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>ICDT</Cd><SubFmlyCd>ESCT</SubFmlyCd></Fmly></Domn></BkTxCd>
            <RltdPties><Cdtr><Nm>Energie SK a. s.</Nm></Cdtr><CdtrAcct><Id><IBAN>SK5809000000000123456789</IBAN></Id></CdtrAcct></RltdPties>
            <RmtInf><Ustrd>Zaloha elektrina VS: 445566</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>
`;

// ─────────────────────────────────── exports ────────────────────────────────

const CamtConverter = { parse, toRows, toCsv, summarize, COLUMNS, SAMPLE_CAMT053_XML, bankFromBic };

// Loaded as an ES module (import { parse, toRows, toCsv, summarize } from
// './camt053.js') in both Node (tests.mjs) and the browser; when loaded in
// the browser via <script type="module" src="camt053.js">, also publishes
// window.CamtConverter for console/debug use, same pattern as the sibling
// tool's doctor-pain001.js / window.SepaDoctor.
if (typeof window !== 'undefined') {
  window.CamtConverter = CamtConverter;
}

export { parse, toRows, toCsv, summarize, COLUMNS, SAMPLE_CAMT053_XML, bankFromBic, parseXml };
