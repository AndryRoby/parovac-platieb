# Párovač platieb: výpis z banky proti faktúram

Live: https://arling.sk/parovac-platieb/

Bezplatný nástroj, ktorý beží celý v prehliadači a spáruje **výpis z
bankového účtu** (formát `camt.053` z Tatra banky, SLSP, VÚB alebo
ČSOB) so **zoznamom vydaných faktúr** (export z Pohody, Omegy, Money
S3, SuperFaktúry, iDokladu, Fakturoidu, alebo len ručná tabuľka v
Exceli), aby nebolo treba každý mesiac ručne prezerať výpis riadok po
riadku a hľadať, ktorá platba patrí ku ktorej faktúre.

## Pre koho je

Slovenský účtovník alebo firma, ktorá si mesačne (alebo častejšie)
kontroluje, ktoré vydané faktúry sú uhradené a ktoré nie, a robí to
dnes ručne: porovnávaním výpisu s tabuľkou faktúr podľa variabilného
symbolu a sumy. Táto kontrola je typický zdroj chýb (preklep vo VS,
klient zaplatí zlú sumu, platba príde v inom mesiaci ako splatnosť) a
pri väčšom počte faktúr zaberie hodiny.

## Vstup: platby

- `camt.053` XML výpis (formát, ktorý ako predvolený export do
  účtovníctva ponúkajú Tatra banka, SLSP, VÚB aj ČSOB), spracovaný cez
  ten istý parser ako sesterský nástroj camt.053 do Excelu
  (https://arling.sk/camt053-to-excel/): `camt053.js`,
  `window.CamtConverter.parse` / `.toRows`.
- alebo CSV export z toho istého nástroja (`camt053-to-excel`), ak už
  výpis máte prevedený do tabuľky.

## Vstup: faktúry

Vložený text skopírovaný z Excelu (tabulátormi oddelené stĺpce) alebo
nahraný CSV/TSV súbor. Stĺpce sa rozpoznávajú automaticky podľa
hlavičky:

| Pole | Rozpoznávané hlavičky |
|---|---|
| Číslo faktúry | `číslo faktúry`, `faktúra`, `doklad` |
| Variabilný symbol | `vs`, `variabilný symbol` |
| Suma / k úhrade | `suma`, `celkom`, `k úhrade`, `amount` |
| Splatnosť | `splatnosť`, `due date` |
| Odberateľ / firma | `odberateľ`, `firma`, `zákazník`, `customer` |
| Mena | `mena`, `currency` |
| Uhradené | `uhradené`, `zaplatené`, `paid` |

Ak automatické rozpoznanie stĺpec netrafí (alebo hlavičky sedia na
nič z tabuľky vyššie), každý stĺpec má vedľa seba ručný výber, ktorým
sa mapovanie prepíše pred spustením párovania. Pre exporty z Pohody,
Omegy, Money S3, SuperFaktúry, iDokladu a Fakturoidu sú pribalené
heuristiky (typické stĺpcové hlavičky, ktoré tieto programy pri
exporte používajú); sú to heuristiky, nie oficiálne overené
špecifikácie od výrobcov, a nástroj to pri výbere šablóny aj
poctivo hovorí.

## Ako prebieha párovanie

Pre každú faktúru sa platby z výpisu skúšajú priradiť v tomto poradí:

1. **VS zhodný a suma zhodná** (tolerancia v centoch je
   nastaviteľná, predvolene 0,01 EUR): spárované.
2. **VS zhodný, suma iná**: označené ako čiastočná úhrada alebo
   preplatok, s rozdielom sumy.
3. **Bez zhodného VS**: ak je suma zhodná, dátum platby je najviac 45
   dní od splatnosti faktúry a takáto zhoda je jediná možná (nie je
   viacznačná), platba sa označí ako **návrh** na spárovanie namiesto
   automatického priradenia.
4. **Zvyšok**: nespárované platby aj nespárované faktúry zostávajú
   v samostatných zoznamoch.

Viac platieb prislúchajúcich jednej faktúre (splátky) sa pri
párovaní podľa VS sčítajú, takže faktúra uhradená v dvoch alebo
viacerých čiastkach sa vyhodnotí správne ako uhradená.

Výstupom sú štyri zoznamy: spárované, čiastočné/preplatky, návrhy na
spárovanie (bez VS) a nespárované, s možnosťou stiahnuť ich ako CSV.

## Ako to funguje (len v prehliadači)

Nástroj beží ako statická stránka a jeden engine skript
(`parovac.js`, bez závislostí, funguje rovnako v prehliadači aj v
Node.js). Výpis aj zoznam faktúr sa spracujú priamo vo vašom
prehliadači; nikam sa neposielajú. Jediná sieťová aktivita, ktorú
stránka vyvolá:

- načítanie vlastných statických súborov (HTML/CSS/JS) z GitHub
  Pages,
- anonymné analytické udalosti (zobrazenie stránky, kliknutie na
  "spárovať" a podobne) do vlastnej inštancie Umami: len názvy
  udalostí a počty, nikdy obsah výpisu ani faktúr,
- a iba ak vyplníte e-mail do voliteľného formulára na odber
  noviniek, požiadavka na e-mailový endpoint s touto adresou a ničím
  iným.

Overiť si to môžete sami: otvorte si v prehliadači záložku Sieť
(Network) počas používania nástroja, alebo si prečítajte `index.html`
a `parovac.js` priamo; sú to statické súbory bez build kroku.

## Free a Pro

Základné párovanie (jeden výpis proti jednému zoznamu faktúr,
ktorýkoľvek z podporovaných formátov, bez limitu na počet riadkov)
je a zostáva úplne zadarmo.

**Pro** (9 EUR/mesiac alebo 79 EUR/rok) je pre účtovníka alebo firmu,
ktorá to robí opakovane každý mesiac, a pridáva:

- viac výpisov a účtov naraz v jednej relácii,
- uložené mapovanie stĺpcov (netreba prepisovať pri každom importe),
- nastaviteľné tolerancie (počet dní pri návrhu bez VS, centy pri
  zhode sumy) uložené ako predvoľba,
- export vo formáte pripravenom na import do Pohody, Omegy alebo
  Money S3,
- históriu predchádzajúcich párovaní.

Kúpa je cez Stripe: 9 € mesačne alebo 79 € ročne, ako súčasť balíka
[Bankové nástroje pre účtovníkov](https://arling.sk/bankove-nastroje/).
Jedna licencia odomkne Pro aj v Generátore a v camt.053 do Excelu.

Licenčný mechanizmus je identický so sesterským SEPA pain.001
Generátorom: podpísaná licencia (Ed25519, plán `sepa-pro`, spoločný pre celý balík Bankové nástroje)
overená celá na strane klienta cez WebCrypto, uložená v
`localStorage`; po platbe ju stránka získa cez
`https://homelab.tailbf8f27.ts.net/licence/api/claim?session_id=`.
Žiadny účet, žiadne prihlasovanie.

## Súkromie

- Žiadny účet, žiadne prihlasovanie, žiadne cookies pre samotný
  nástroj.
- Žiadne spracovanie výpisu ani faktúr na serveri; "backend" je váš
  vlastný prehliadač.
- Analytika (Umami) zaznamenáva, že párovanie prebehlo, nie čo bolo
  v jeho vstupe.

## Spustenie lokálne

Bez build kroku, statické súbory.

```bash
git clone https://github.com/AndryRoby/parovac-platieb.git
cd parovac-platieb
npx serve .
# alebo len otvorte index.html priamo v prehliadači
```

## Nahlásenie chybného alebo nerozpoznaného formátu

Nájdete stĺpcovú hlavičku, ktorú nástroj nerozpozná, alebo prípad
párovania, ktorý vyhodnotí zle? Založte issue na GitHub repe s:

1. hlavičkami stĺpcov, ktoré ste použili (alebo anonymizovaný
   vzorový riadok),
2. z ktorého programu export pochádza,
3. čo nástroj vyhodnotil a čo by malo byť správne.

Pred zverejnením anonymizujte citlivé údaje (reálne IBAN, mená,
sumy); issues sú verejné.

## Vylúčenie zodpovednosti

Nástroj je poskytovaný "tak ako je", bez záruky. Párovanie sa riadi
pravidlami opísanými vyššie (VS + suma, tolerancia centov, návrh bez
VS do 45 dní od splatnosti); pri nezvyčajných prípadoch (napríklad
preplatok rozdelený medzi viac faktúr) môže návrh vyžadovať ručnú
kontrolu. Výsledok párovania je pomôcka na kontrolu úhrad, nie
účtovný doklad ani náhrada za párovanie priamo vo vašom účtovnom
systéme.

## O nástroji

Vytvorila ARLing s. r. o. (Bratislava, Slovensko).
Kontakt: andrej@arling.sk

Súvisiace nástroje:
- camt.053 výpis banky do Excelu: https://arling.sk/camt053-to-excel/
- SEPA pain.001 Generátor (hromadný príkaz na úhradu z Excelu):
  https://arling.sk/sepa-pain001-generator/
- SEPA pain.001 Doctor (kontrola hotového pain.001 súboru):
  https://arling.sk/sepa-pain001-doctor/
- Ďalšie nástroje ARLing: https://arling.sk/
