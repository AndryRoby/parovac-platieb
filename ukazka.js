// ukazka.js: čo dostane návštevník bez licencie.
//
// Prečo to existuje. Do 6. 9. 2026 tento nástroj rozdával celý pracovný súbor
// zadarmo: CSV aj Excel sa stiahli bez akejkoľvek kontroly a MT940 aj DATEV mali
// jeden voľný export na prehliadač, ktorý sa dal obnoviť inkognito oknom. Za celý
// čas z toho nevznikol ani jeden predaj, čo je logické: účtovník potreboval presne
// ten Excel a dostal ho.
//
// Nový model je „náhľad zadarmo, súbor za peniaze“:
//   - celá tabuľka sa zobrazí na obrazovke, úplná, bez licencie, navždy;
//   - stiahnutý súbor má bez licencie prvých 20 riadkov a v prvom riadku napísané,
//     že je to ukážka a koľko riadkov chýba.
// Inkognito okno tým prestáva byť cesta okolo: nezamykáme počet použití, zamykáme
// funkciu, a nová relácia dá presne to isté ako stará.
//
// Modul je čistý a bez závislostí, aby ho tests.mjs vedel importovať pod Node:
// žiadne DOM, žiadne localStorage, žiadny čas.

/** Koľko riadkov dostane návštevník bez licencie. */
export const UKAZKA_RIADKOV = 20;

/**
 * Oreže riadky pre návštevníka bez licencie.
 * @param {Array} rows všetky riadky výpisu
 * @param {boolean} licencia true, keď je licencia platná
 * @returns {{rows:Array, orezane:boolean, spolu:number, zobrazene:number}}
 */
export function orez(rows, licencia) {
  const spolu = Array.isArray(rows) ? rows.length : 0;
  if (licencia || spolu <= UKAZKA_RIADKOV) {
    return { rows: rows || [], orezane: false, spolu, zobrazene: spolu };
  }
  return { rows: rows.slice(0, UKAZKA_RIADKOV), orezane: true, spolu, zobrazene: UKAZKA_RIADKOV };
}

/**
 * Veta, ktorá ide do prvého riadku orezaného súboru. Musí byť zrozumiteľná
 * aj vtedy, keď súbor niekto otvorí o mesiac a nepamätá si, odkiaľ ho má.
 * @param {'sk'|'en'|'de'} lang
 * @param {number} zobrazene
 * @param {number} spolu
 * @param {string} url adresa, kde sa licencia kupuje
 */
export function hlavicka(lang, zobrazene, spolu, url) {
  const t = {
    sk: 'UKÁŽKA: prvých ' + zobrazene + ' z ' + spolu + ' riadkov. Celý súbor po aktivácii licencie: ' + url,
    en: 'SAMPLE: first ' + zobrazene + ' of ' + spolu + ' rows. Full file with a licence: ' + url,
    de: 'MUSTER: erste ' + zobrazene + ' von ' + spolu + ' Zeilen. Vollständige Datei mit Lizenz: ' + url,
  };
  return t[lang] || t.en;
}

/** Prípona, ktorá odlíši ukážku od ostrého súboru v priečinku Stiahnuté. */
export function priponaUkazky(orezane) {
  return orezane ? '-ukazka' : '';
}

if (typeof window !== 'undefined') {
  window.ArlingUkazka = { UKAZKA_RIADKOV, orez, hlavicka, priponaUkazky };
}
