# Payment matcher (Párovač platieb): bank statement against issued invoices

Payment matcher is a browser tool for Slovak accountants and companies that check every month which issued invoices were paid: it matches a camt.053 bank statement (Tatra banka, SLSP, VÚB, ČSOB) against a list of invoices by variable symbol (VS) and amount, suggests matches without a VS, and shows what is unpaid or overpaid. Matching and the full tables on screen are free with no row limit; without a licence the downloaded file holds the first 20 rows as a sample, and the full download plus convenience features come with the Pro licence for €9 a month or €79 a year (VAT included) at https://arling.sk/bankove-nastroje/, which also covers SEPA pain.001 Generator and camt.053 to Excel.

Live: https://arling.sk/parovac-platieb/ (Slovak) · https://arling.sk/parovac-platieb/en/ (English) · https://arling.sk/parovac-platieb/de/ (German)

## Who it is for

A Slovak bookkeeper or company that checks monthly (or more often)
which issued invoices are paid and which are not, and does it by hand
today: comparing the statement with a table of invoices by variable
symbol and amount. That check is a typical source of errors (a typo in
the VS, a client paying the wrong amount, a payment arriving in a
different month than the due date) and takes hours with many invoices.

## Input: payments

- A `camt.053` XML statement (the format Tatra banka, SLSP, VÚB and
  ČSOB offer as the default export for accounting), read by the same
  parser as the sibling tool camt.053 to Excel
  (https://arling.sk/camt053-to-excel/): `camt053.js`,
  `window.CamtConverter.parse` / `.toRows`.
- Or a CSV export from that same tool (`camt053-to-excel`), if the
  statement is already converted to a table.

## Input: invoices

Text pasted from Excel (tab-separated columns) or an uploaded CSV/TSV
file. Columns are detected automatically by their header:

| Field | Recognised headers |
|---|---|
| Invoice number | `číslo faktúry`, `faktúra`, `doklad` |
| Variable symbol | `vs`, `variabilný symbol` |
| Amount / to pay | `suma`, `celkom`, `k úhrade`, `amount` |
| Due date | `splatnosť`, `due date` |
| Customer / company | `odberateľ`, `firma`, `zákazník`, `customer` |
| Currency | `mena`, `currency` |
| Paid | `uhradené`, `zaplatené`, `paid` |

If automatic detection misses a column (or the headers match nothing in
the table above), every column has a manual selector to override the
mapping before matching. Exports from Pohoda, Omega, Money S3,
SuperFaktúra, iDoklad and Fakturoid come with bundled heuristics
(typical column headers these programs use in their exports); they are
heuristics, not specifications verified with the vendors, and the tool
says so when you pick a template.

## How matching works

For each invoice, payments from the statement are tried in this order:

1. **Same VS and same amount** (amount tolerance 0.01 EUR by
   default): matched.
2. **Same VS, different amount**: marked as a partial payment or an
   overpayment, with the difference.
3. **No matching VS**: if the amount matches, the payment date is at
   most 45 days from the invoice due date, and the match is the only
   possible one (not ambiguous), the payment is marked as a
   **suggestion** instead of being assigned automatically.
4. **The rest**: unmatched payments and unmatched invoices stay in
   separate lists.

Several payments for one invoice (instalments) are added up when
matching by VS, so an invoice paid in two or more parts is correctly
evaluated as paid.

The output is four lists: matched, partial or overpaid, suggestions
(no VS) and unmatched. All four are shown in full on screen for free.

## How it works (in the browser only)

The tool is a static page with one engine script (`parovac.js`, no
dependencies, works the same in the browser and in Node.js). The
statement and the invoice list are processed in your browser and are
not sent anywhere. The only network activity the page causes:

- loading its own static files (HTML/CSS/JS) from GitHub Pages,
- anonymous analytics events (page view, "match" clicked and similar)
  to a self-hosted Umami instance: event names and counts only, never
  the content of the statement or invoices,
- licence verification after a purchase,
- and, only if you fill in the optional news sign-up form, a request
  to the e-mail endpoint with that address and nothing else.

You can check this yourself in the browser's Network tab, or by
reading `index.html` and `parovac.js`; they are static files with no
build step.

## Free and Pro

Free, with no account: matching one statement against one invoice
list, in any supported format, with the full tables on screen and no
limit on the number of rows. Without a licence the downloaded "mark as
paid" CSV (invoice number, payment date, amount) holds the first 20
rows as a sample.

**Pro** is convenience for an accountant or company that does this
every month, not unlocked matching. It adds:

- the whole downloaded file,
- several statements and accounts at once in one session,
- saved column mapping (no remapping on every import),
- adjustable tolerances (amount in euro, days around the due date for
  a suggestion) saved as a preset,
- an export in a column format meant for import into Pohoda, Omega or
  Money S3 (an estimate of their import formats, not verified with
  the vendors, so check it before importing),
- a history of previous matching runs, stored in your browser.

Pricing: Pro is the Banking tools licence sold at
https://arling.sk/bankove-nastroje/ for €9 a month or €79 a year, VAT
included. One licence activates Pro here and in SEPA pain.001
Generator and camt.053 to Excel. SEPA pain.001 Doctor is free and
needs no licence.

Who sells and who sends the receipt: the licence is sold through
Stripe Managed Payments. The merchant of record is Link (Sold through
Link, LLC, which provides that service for Stripe): Link sends the
receipt and the invoice as a PDF, and Stripe calculates and remits the
VAT; ARLing s. r. o. delivers the tool and the licence key. Cancel or
change the subscription at any time in the Stripe customer portal
(https://billing.stripe.com/p/login/3cIaER9M63hNeFcg8B4ko00); it stays
active until the end of the paid period. For a monthly or yearly
subscription, ARLing refunds the payment on request within 14 days of
purchase, without you giving a reason: write to support@arling.sk.
Full terms: https://arling.sk/podmienky/en/ (sections 4 to 6).

The licence mechanism is the same as in the sibling SEPA pain.001
Generator: a signed licence (Ed25519, plan `sepa-pro`, shared by the
whole Banking tools bundle) verified entirely client-side with
WebCrypto and stored in `localStorage`; after payment the page claims
it from ARLing's licence service with the Stripe checkout session id.
No account, no login.

## Privacy

- No account, no login, no cookies for the tool itself.
- No server-side processing of the statement or the invoices; the
  "backend" is your own browser.
- Analytics (Umami) records that a matching run happened, not what was
  in its input.

## Running it locally

No build step, static files.

```bash
git clone https://github.com/AndryRoby/parovac-platieb.git
cd parovac-platieb
npx serve .
# or just open index.html directly in a browser
```

The live page at arling.sk/parovac-platieb/, with its English and
German versions, is published from the arling.sk site repository; this
repository holds the tool's engine and its Slovak page.

## Reporting a wrong or unrecognised format

Found a column header the tool does not recognise, or a matching case
it gets wrong? Open an issue on the GitHub repo with:

1. the column headers you used (or an anonymised sample row),
2. which program the export comes from,
3. what the tool decided and what would be correct.

Anonymise sensitive data (real IBANs, names, amounts) before posting;
issues are public.

## Disclaimer

The tool is provided as is, without warranty. Matching follows the
rules described above (VS plus amount, amount tolerance, suggestion
without VS within 45 days of the due date); unusual cases (for example
an overpayment split across several invoices) may need a manual check.
The result is an aid for checking payments, not an accounting document
or a replacement for matching in your accounting system.

## About

Made by ARLing s. r. o. (Bratislava, Slovakia).
Contact: support@arling.sk

Related tools:
- camt.053 to Excel: https://arling.sk/camt053-to-excel/
- SEPA pain.001 Generator (batch payment file from Excel):
  https://arling.sk/sepa-pain001-generator/
- SEPA pain.001 Doctor (check a finished pain.001 file):
  https://arling.sk/sepa-pain001-doctor/
- More ARLing tools: https://arling.sk/

## Slovensky (skrátene)

Párovač platieb spáruje výpis z banky (camt.053) so zoznamom vydaných
faktúr podľa variabilného symbolu a sumy, celé v prehliadači. Párovanie
a celé tabuľky na obrazovke sú zadarmo bez limitu riadkov; bez licencie
má stiahnutý súbor prvých 20 riadkov ako ukážku. Pro za 9 € mesačne
alebo 79 € ročne (DPH v cene) je jedna licencia pre tri nástroje:
https://arling.sk/bankove-nastroje/. Kontakt: support@arling.sk.
