# Launch: Párovač platieb (výpis z banky proti faktúram)

Tool: https://arling.sk/parovac-platieb/
Repo: https://github.com/AndryRoby/parovac-platieb
Researched: 2026-09-06 (WebSearch + WebFetch + GitHub REST search API; `gh` CLI not available in
this environment; unauthenticated `api.github.com` calls hit the 60/hour rate limit partway
through and were replaced with WebFetch on the same URLs, noted where it happened).

## 1) Live-thread research: what was actually found

Same rule as the three earlier ARLing launches in this niche (SEPA pain.001 Generátor, SEPA
pain.001 Doctor, camt.053-to-Excel): **closed + last human activity older than 12 months ->
skip.** Beyond the literal rule, a thread only counts as **post**-worthy if replying with this
specific tool would be real, on-topic help to the actual poster, not a keyword match.

**Bottom line up front: one genuine candidate, everything else skips.** Unlike the three earlier
launches in this product family (each of which found zero postable threads), this round found
one open, recent, closely on-topic GitHub issue: a maintainer of a Czech/Slovak invoicing system
actively designing the exact fallback logic ("no variable symbol, how do I still safely match a
payment") that this tool's own rule 3 already implements. It is not a plain "help me" thread, so
it needs a judgment call, laid out below the table, not an automatic post.

| Query / source | What came back | URL | Status | Date | Verdict |
|---|---|---|---|---|---|
| GitHub search: `"variabilní symbol"` (Czech spelling, 30 results checked) | `radekhulan/myinvoice` issue #259, "Automatické párování EUR/SEPA plateb podle reference nebo zprávy pro příjemce": author `andrlikt` reports a correctly issued and paid EUR/SEPA invoice that automatic matching missed because the transaction had no variable symbol at all (foreign SEPA transfers typically don't carry one; the invoice number only appears in the free-text reference). Asks for fallback logic: search the transaction description/reference for the invoice number, require exact token match, matching currency, matching amount, and only auto-match when exactly one candidate is unambiguous, plus regression tests for the ambiguous/mismatched cases. | https://github.com/radekhulan/myinvoice/issues/259 | **Open**, no labels | Opened ~2026-08, last activity 2026-08-05 (1 month old) | **candidate, owner's call** (see below): real, live, on-topic design problem; not a plain "help me fix my export" thread |
| Same search, `radekhulan/myinvoice` issue #249, "oddělit číslo dokladu a platební variabilní symbol" | Author `lzahradil-afk`: iDoklad imports carry document number and payment VS as two separate fields that the importer collapses into one, breaking recurring-billing cases where the same VS should be reusable across several distinct invoice numbers. Proposes a separate nullable `payment_variable_symbol` column. | https://github.com/radekhulan/myinvoice/issues/249 | Open | Opened 2026-07-29, active | **skip**: import/data-model bug inside their own app, not a matching-logic question this tool answers |
| Same search, `Melebius/FioMailer` issue #2, "Ořezávat úvodní nuly z VS" | The repo owner (`Melebius`) filing a bug against their own project: mBank statements carry a VS with leading zeros, which breaks their own VS filters. One line, no discussion. | https://github.com/Melebius/FioMailer/issues/2 | Open | Opened 2026-08-06 | **skip**: self-filed maintainer bug ticket, not a question anyone external would answer |
| GitHub search: `"variabilny symbol"` (Slovak spelling, 20 results checked) | `csob/paymentgateway` issue #692, "Rovnaky variabilny symbol u opakujucich sa platbach": a developer integrating ČSOB's card **payment gateway** (not bank-statement reconciliation) asks how to identify recurring card payments when `orderNo` must be unique. Different problem domain (gateway API, not camt.053/statement matching). | https://github.com/csob/paymentgateway/issues/692 | Closed, assigned + "help wanted" | Closed 2025-01-02 (~20 months old) | **skip**: closed, stale, and wrong domain (payment gateway integration, not statement-to-invoice reconciliation) |
| Same search, `magi-9/e-plant` issue #99, "[Platby] Bankový prevod + automatické párovanie cez KROS webhook" | Backend feature request for a Slovak e-shop: match bank transfers to orders via a KROS webhook after checkout. Internal dev backlog ticket for one repo owner's own project, not a public question. | https://github.com/magi-9/e-plant/issues/99 | **Closed as not planned** | Closed 2026-04-02 | **skip**: closed, not planned, internal ticket |
| `site:porada.sk párovanie banka faktúry` | `t-199904`, "parovanie banky - presúvanie úhrad z minulého roka": about moving already-matched payments between fiscal years after an audit, not about matching payments to invoices in the first place. Confirms porada.sk is a genuine, recurring venue for bank/invoice-matching questions in accounting software (MRP, MKSOFT, KROS Omega all come up in adjacent threads), but this specific thread is a different problem than this tool solves. Live (non-archive) URL also exists: `porada.sk/t199904-parovanie-banky-presuvanie-uhrad-z-minuleho-roka.html`. | https://www.porada.sk/t199904-parovanie-banky-presuvanie-uhrad-z-minuleho-roka.html | Unknown (403 to automated fetch, both archive and live URL) | Unknown | **skip for now, flagged below**: real venue, wrong specific thread; needs Andrej's own eyes for anything fresher |
| `site:porada.sk camt.053 import banka`, `site:porada.sk "variabilný symbol" výpis kontrola úhrad` | Same porada.sk 403 wall hit by every earlier launch in this family: real, topically adjacent archived threads exist (`Kros Import bankových výpisov - OMEGA`, `Pohoda import bankových výpisov`, `Variabilný symbol`, `Môže byť variabilný symbol iný ako č. FA?`), but none is specifically about matching a statement against a spreadsheet of invoices, and direct fetch of every one (archive and live URL alike) returns HTTP 403 to automated requests. | https://www.porada.sk/ | Unknown (403) | Unknown | **skip**: nothing specifically on-topic found within reach, and the site blocks automated verification either way |
| `bizforum.sk` search for párovanie/výpis/faktúry | No matching discussion thread; only a generic "Splatnosť faktúry" page and the `bizforum.sk/diskusia/uctovnictvo/` section itself (already found stale, 2018-2020, by the SEPA pain.001 Generátor launch research). | https://www.bizforum.sk/diskusia/uctovnictvo/ | n/a | n/a (last confirmed activity 2018-2020) | **skip**: no on-topic thread, and the forum section was already found inactive |
| GitHub search API: `repo:alyf-de/erpnext_bank_utils is:issue` (camt.053-to-invoice matcher for ERPNext) | Zero issues, open or closed, on the whole repository. | https://github.com/alyf-de/erpnext_bank_utils | n/a | n/a | **skip**: nothing to reply to |
| `github issue "match payments" "variable symbol" invoice bank statement reconciliation` (English, generic) | Only large-ERP internal tickets (Odoo #20804, #32266; OCA/bank-statement-import #481, closed as stale 2022, about partner detection in Belgium/France, no VS or Slovak angle) and an old, already-shipped Invoice Ninja feature request (#2481, closed "fixed-in-v5", opened 2018). None open, none Slovak, none about camt.053 specifically. | (4 issues, listed above) | Closed (all) | 2018-2022 | **skip (all)**: closed, stale, and no Slovak/camt.053/VS angle |

### Market context (not a thread, but relevant to positioning)

Every mainstream Slovak online invoicing tool (SuperFaktúra, topfaktúra.sk, Trovi, eFaktúra
centrum) already markets a built-in "automatické párovanie platieb" feature, matching by VS and
amount once a bank feed or SEPA XML statement is connected *inside their own system*. That
built-in matching only covers invoices issued and tracked inside that same tool. It does nothing
for: a spreadsheet-based invoice list kept outside any of them, a second bank account or
statement source the accounting program isn't connected to, or a one-off reconciliation someone
wants to run without granting a bank-feed connection to a SaaS account. That gap, not
"nobody has automatic matching," is this tool's actual differentiation, worth using in the
owner's own post (see FACTS below), not something to lead a forum reply with.

## Why only one candidate, and what to do with it

Same underlying shape as the three earlier launches: this is a narrow, Slovak/Czech-specific
accounting niche, and the people who hit "my payment has no VS, how do I still know which invoice
it's for" mostly either use their accounting program's own (imperfect) matching, ask their
accountant directly, or post inside a closed Facebook/WhatsApp group, none of which are
search-indexed. What's different this round is that one of the tool-building communities working
on this exact problem (Czech/Slovak self-hosted invoicing software) does have a public,
active GitHub issue tracker, and one issue on it (`myinvoice` #259) is, right now, a maintainer
actively designing the same fallback rule this tool ships (rule 3: no VS, but amount matches and
date is close enough and the match is unique -> propose, don't auto-confirm).

**This is a judgment call for Andrej, not an automatic post**, for two reasons a script can't
weigh: (1) it's a feature-request thread on someone else's product, where the honest, useful
contribution is design input, not "use my tool instead" (the poster wants matching built into
*their* invoicing system, not a separate manual step); (2) whether the tone lands as genuinely
helpful engineering discussion versus an unsolicited plug depends on reading the maintainer's
usual style on that repo, which needs a human glance, not a script's guess.

**If Andrej decides to reply**, the honest, substantive contribution available is describing the
specific heuristic this tool already ships for exactly this situation, offered as design input,
not a pitch: require the amount match to be exact (within a small tolerance), require the date to
fall within a bounded window of the due date (this tool uses 45 days) rather than matching on
description text alone, and only propose the match (never auto-confirm it) when it is the single
unambiguous candidate. A one-line mention that a live tool applies this exact rule is a fair,
honest "by the way," not the point of the comment. See the draft in section 2.

**Standing watch (2 minutes, zero cost):**
- GitHub: watch `radekhulan/myinvoice` (and its stated successor `myúčto`) issues for anything
  else touching VS-less matching, camt.053, or Slovak banks specifically.
- Google/Bing Alerts: `"párovanie platieb" faktúry výpis excel`, `"nezaplatené faktúry" kontrola
  excel banka`, `camt.053 excel párovanie faktúr`.
- porada.sk: Andrej to check `t199904` and the Kros/Pohoda/Omega import threads above manually
  (logged in) the way the camt.053-to-Excel launch flagged the same 403 wall; none of this
  research's automated checks could get past it.

## 2) Reply draft, if Andrej decides to post (myinvoice #259 only; nothing else qualified)

Not a template to fill in blind, like the earlier launches' "nothing found" fallback: this is a
draft for the one real candidate, meant to be read and adjusted by Andrej before posting, not
sent as-is.

**Czech/Slovak (GitHub issue comment, `radekhulan/myinvoice` #259):**

> Riešil som presne tento prípad (platba bez VS, len suma a dátum) v malom vlastnom nástroji na
> párovanie výpisu s faktúrami, tak dávam pre inšpiráciu, ako som to nastavil: namiesto
> hľadania čísla faktúry v texte referencie (čo môže byť krehké, ak platca napíše iný formát)
> matchujem len na presnú zhodu sumy (s toleranciou v centoch) a dátum platby do 45 dní od
> splatnosti faktúry, a to len vtedy, keď je taká zhoda jediná možná (žiadna iná faktúra nie je
> rovnako dobrý kandidát). Vždy to označím ako návrh, nikdy nepotvrdím automaticky. Pri viacerých
> čiastkových platbách na jednu faktúru (splátky) sčítavam všetky platby s tou istou VS pred
> porovnaním so sumou faktúry.
>
> Mimochodom, presne toto beží ako malý bezplatný nástroj tu:
> https://arling.sk/parovac-platieb/ (statická stránka, nič sa neposiela na server), ak by bol
> zaujímavý referenčný príklad správania, nie návrh, aby ste to prerábali na integráciu.

## 3) FACTS for the owner (not ready-made text): for your own Show HN / Reddit / porada.sk post

1. It matches a `camt.053` bank statement (Tatra banka, SLSP, VÚB, ČSOB) against a pasted or
   uploaded list of issued invoices, entirely in the browser: no account, no upload, no server
   round-trip for either the statement or the invoice list.
2. Matching runs in a fixed, disclosed order: VS + amount within tolerance (default 0.01 EUR) ->
   matched; VS matches but amount differs -> partial/overpayment; no VS but amount matches
   exactly and payment date is within 45 days of the due date and the match is unique ->
   proposed (never auto-confirmed); everything else -> unmatched.
3. Payments sharing the same VS are summed before matching, so an invoice paid in installments
   across two or more transfers is correctly evaluated against the total received.
4. Every mainstream Slovak online invoicing tool (SuperFaktúra, topfaktúra.sk, Trovi, eFaktúra
   centrum) already advertises built-in automatic payment matching, but only for invoices issued
   and tracked inside that same tool with a connected bank feed. None of them help someone
   keeping an invoice list in a spreadsheet, using a second account those tools aren't connected
   to, or wanting to check reconciliation without granting a SaaS a bank-feed connection.
5. It does not connect to any bank account, does not verify statement completeness against a
   bank-reported balance, and does not post anything back to an accounting system. It is a
   one-way, offline comparison: it reads a statement and a list, and produces four lists back.
6. Research today found exactly one live, on-topic technical discussion of this same matching
   problem: an open GitHub issue on `myinvoice` (a Czech/Slovak self-hosted invoicing project,
   288 stars) where the maintainer is actively designing a fallback for payments with no VS,
   the same case this tool's rule 3 already covers (see section 1). No forum thread (porada.sk,
   BizFórum) or other GitHub issue found today is both live and specifically about matching a
   bank statement against an invoice list; the closest porada.sk thread (`t199904`) is about a
   different problem (moving already-matched payments between fiscal years).
7. The engine (`parovac.js`) and the camt.053 parser (`camt053.js`, shared unmodified with the
   sibling camt.053-to-Excel tool) are dependency-free and run identically in Node.js and the
   browser; this is a fact worth stating plainly (no framework, no build step) rather than
   dressing up as a feature.
8. Same cheapest, most scalable channel as every earlier launch in this family: SEO. It's
   passive (no cold e-mail, no cold DM) but takes weeks, not days, for Google to index and rank
   the page.

## 4) Article outline

**Title (SK):** *Výpis z banky sedí, faktúra nie. Ako spárovať platby bez ručného prezerania.*
**Title (SK alt, keyword-forward):** *Nezaplatené faktúry: kontrola oproti výpisu z banky bez
Excelu riadok po riadku.*

1. **The setup.** Koniec mesiaca: výpis z banky (camt.053) na jednej strane, tabuľka vydaných
   faktúr (z Pohody, Omegy, Money S3, SuperFaktúry, iDokladu, Fakturoidu, alebo len Excel) na
   druhej. Ručná kontrola: prejsť riadok po riadku, hľadať VS, hľadať sumu.
2. **Prečo automatické párovanie v účtovnom programe nestačí vždy.** Ak faktúry žijú mimo
   programu (druhý účet, tabuľka vedená súbežne), vstavané párovanie sa ich netýka; odkázať na
   FACTS bod 4 vyššie (žiadny z veľkých SK nástrojov toto nerieši mimo vlastného systému).
3. **Čo sa deje, keď VS chýba alebo nesedí.** Zahraničná platba bez VS, preklep, platba v inom
   mesiaci ako splatnosť. Presne prípad, ktorý rieši aj otvorené GitHub issue #259 na projekte
   myinvoice (odkázať, s poctivým rámcom: iný projekt, rovnaký problém, nie "pozrite, spomínajú
   ma").
4. **Ako to rieši tento nástroj.** Poradie pravidiel (VS+suma, čiastočná úhrada, návrh bez VS do
   45 dní, nespárované), sčítanie splátok, prečo je krok 3 vždy "návrh" a nikdy automatické
   potvrdenie (odkázať na llms-full.txt FAQ).
5. **Ako to funguje (súkromie).** Statická stránka, žiadny účet, nič sa neodosiela okrem
   voliteľného e-mailu do newslettra; odkázať README.
6. **Otvorená výzva.** Nerozpoznaný formát hlavičky faktúr alebo zle vyhodnotené párovanie:
   odkázať README sekciu nahlásenia chyby.

## 5) SK kľúčové slová do title / h1 / FAQ

Frázy, ktoré sa oplatí mať doslovne (nie len rozhádzané v texte), zo zadania a z toho, čo
výskum potvrdil ako reálne používané spojenia (SuperFaktúra/Trovi/topfaktúra marketing aj
porada.sk vlákna používajú presne tieto tvary):

- „párovanie platieb s faktúrami“
- „výpis z banky párovanie“
- „nezaplatené faktúry kontrola“
- „automatické párovanie platieb“ (frekventovaný marketingový aj vyhľadávací tvar, potvrdené
  u konkurencie: SuperFaktúra, topfaktúra.sk, Trovi, eFaktúra centrum)
- „camt.053 faktúry“ / „camt.053 párovanie“
- „variabilný symbol platba nesedí“
- „kontrola úhrad faktúr“

Frázy s konkrétnym účtovným programom (do FAQ otázok, nie do h1, keďže presne sedia len na
podskupinu čitateľov podľa toho, aký program používajú):

- „Pohoda párovanie platieb“
- „iDoklad platba nespárovaná“
- „SuperFaktúra platba bez VS“
- „Fakturoid párovanie faktúr“

## Files referenced

- README's "Nahlásenie chybného alebo nerozpoznaného formátu" section: `../README.md`
- llms-full.txt FAQ (matching algorithm, why a no-VS match is always "návrh", installment
  handling): `../llms-full.txt`
- Sibling launch research this round builds on: `../../sepa-pain001-generator/launch/launch-posts.md`,
  `../../camt053-to-excel/launch/launch-posts.md` (same porada.sk 403 wall, same "SEO is the real
  channel" conclusion, not re-verified here since already sourced directly).
