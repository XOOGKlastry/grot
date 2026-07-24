/* Test dymny: uruchamia aplikacje bez przegladarki.
   Zaslepia Leaflet i siec, sprawdza start, wyszukiwarke, przystanki,
   solver, odnosniki Google, wybor podkladu i edycje adresu.

   Uruchomienie:  npm install jsdom && node tools/test.js  */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
let bledy = 0, testy = 0;

function ok(warunek, opis) {
  testy++;
  if (warunek) { console.log('  ok   ' + opis); }
  else { console.log('  BLAD ' + opis); bledy++; }
}

/* ---------- zaslepka Leaflet ---------- */
function leafletStub(win) {
  const noop = function () { return this; };
  const dodane = new Set();

  function warstwa(dane, opts) {
    opts = opts || {};
    const w = {
      _dane: null,
      addData: function (d) {
        this._dane = d;
        // Leaflet przyjmuje styl jako funkcje albo jako staly obiekt
        ((d && d.features) || []).forEach(f => {
          if (typeof opts.style === 'function') opts.style(f);
          if (opts.onEachFeature) opts.onEachFeature(f, { on: noop, bindPopup: noop, openPopup: noop });
        });
        return this;
      },
      clearLayers: function () { this._dane = null; return this; },
      setStyle: function (fn) {
        if (typeof fn === 'function' && this._dane) (this._dane.features || []).forEach(fn);
        return this;
      },
      addTo: function () { dodane.add(this); return this; },
      remove: noop, on: noop, bindPopup: noop, openPopup: noop, getElement: () => null
    };
    if (dane) w.addData(dane);
    return w;
  }

  let zoom = 6;
  const granice = {
    pad: () => granice, contains: () => true,
    getWest: () => 14, getEast: () => 24, getSouth: () => 49, getNorth: () => 55
  };

  win.L = {
    map: () => ({
      setView: noop, on: noop,
      createPane: () => ({ style: {} }), getPane: () => ({ style: {} }),
      removeLayer: function (l) { dodane.delete(l); }, addLayer: function (l) { dodane.add(l); },
      hasLayer: function (l) { return dodane.has(l); },
      closePopup: noop, invalidateSize: noop, panTo: noop, fitBounds: noop,
      getZoom: () => zoom, getBounds: () => granice,
      getContainer: () => win.document.getElementById('map')
    }),
    control: { zoom: () => ({ addTo: noop }) },
    tileLayer: () => ({ addTo: function () { dodane.add(this); return this; }, on: noop, remove: noop }),
    geoJSON: warstwa,
    polyline: () => ({ addTo: noop, remove: noop }),
    marker: () => ({ addTo: noop, bindPopup: noop, remove: noop, on: noop, getElement: () => null, _s: null }),
    layerGroup: () => {
      const kids = [];
      const g = {
        addLayer: function (l) { kids.push(l); return this; },
        removeLayer: function (l) { const i = kids.indexOf(l); if (i >= 0) kids.splice(i, 1); return this; },
        clearLayers: function () { kids.length = 0; return this; },
        eachLayer: function (fn) { kids.forEach(fn); return this; },
        addTo: function () { dodane.add(this); return this; }, remove: noop, on: noop
      };
      return g;
    },
    divIcon: o => o, svg: () => ({}),
    latLng: (a, b) => ({ lat: a, lng: b }),
    latLngBounds: () => ({ pad: () => ({}) })
  };
  win.__zoom = z => { zoom = z; };
}

(async function () {
  console.log('\n== Test aplikacji ==\n');

  const cssTxt = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const appTxt = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

  const html = cssTxt
    .replace(/<script src="https:\/\/unpkg[^"]*"><\/script>/, '')
    .replace(/<link rel="stylesheet"[^>]*>/g, '')
    .replace(/<script src="data\/powiaty.js"><\/script>/, '')
    .replace(/<script src="data\/strony.js"><\/script>/, '')
    .replace(/<script src="app.js"><\/script>/, '');

  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.test/' });
  const win = dom.window;
  const doc = win.document;

  leafletStub(win);
  win.confirm = () => true;
  win.alert = (m) => { console.log('  BLAD nieoczekiwany komunikat: ' + m); bledy++; testy++; };

  let trybSieci = 'ok';
  win.fetch = (url) => {
    if (trybSieci === 'padnij') return Promise.reject(new Error('offline'));
    if (url.includes('/table/')) {
      const n = url.split('/driving/')[1].split('?')[0].split(';').length;
      const d = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => i === j ? 0 : 600 + Math.abs(i - j) * 300));
      return Promise.resolve({ json: () => Promise.resolve({ code: 'Ok', durations: d }) });
    }
    if (url.includes('/route/')) {
      const krok = (ref, m, lng, lat) => ({ ref, distance: m, maneuver: { location: [lng, lat] } });
      return Promise.resolve({ json: () => Promise.resolve({
        code: 'Ok',
        routes: [{
          distance: 184200, duration: 9660,
          legs: [{ distance: 40000, duration: 2000, steps: [
            krok('S1', 32000, 19.1, 49.7),
            krok('A4', 51000, 19.4, 50.1),
            krok('94', 18000, 19.9, 50.2),
            krok('781', 22000, 19.5, 50.3),   // wojewodzka - powinna wypasc
            krok('S1', 1200, 19.2, 49.8)      // za krotki odcinek - powinien wypasc
          ] }],
          geometry: { coordinates: [[19.1, 49.6], [19.2, 49.7]] }
        }]
      }) });
    }
    if (url.includes('nominatim')) {
      const zapytanie = decodeURIComponent((url.split('&q=')[1] || ''));
      if (/nieistniej/i.test(zapytanie)) return Promise.resolve({ json: () => Promise.resolve([]) });
      return Promise.resolve({ json: () => Promise.resolve([
        { lat: '50.0500', lon: '19.9400', display_name: zapytanie + ', Kraków, Polska' }
      ]) });
    }
    return Promise.resolve({ json: () => Promise.resolve([]) });
  };

  /* jsdom konczy parsowanie dopiero po tiku */
  await new Promise(r => setTimeout(r, 30));

  /* ---------- start aplikacji ---------- */
  try {
    win.eval(fs.readFileSync(path.join(ROOT, 'data', 'powiaty.js'), 'utf8'));
    win.eval(fs.readFileSync(path.join(ROOT, 'data', 'gminy.js'), 'utf8'));
    win.eval(fs.readFileSync(path.join(ROOT, 'data', 'strony.js'), 'utf8'));
    win.eval(appTxt);
  } catch (e) {
    console.log('  BLAD start aplikacji: ' + e.message + '\n' + e.stack);
    process.exit(1);
  }
  await new Promise(r => setTimeout(r, 40));   // gminy dociagane w tle

  /* ---------- dane ---------- */
  console.log('Dane');
  const P = win.POWIATY_DB, G = win.GMINY_DB;
  ok(P.centers.length === 380, 'baza powiatow ma 380 pozycji');
  ok(G.centers.length === 2477, 'baza gmin ma 2477 pozycji');
  ok(win.WOJ_DB.features.length === 16, 'granice 16 wojewodztw');
  ok(P.centers.concat(G.centers).every(c => c[6] > 48.9 && c[6] < 55 && c[7] > 13.9 && c[7] < 24.3),
     'wszystkie siedziby leza w granicach Polski');
  ok(G.centers.every(c => c[3]), 'kazda gmina dziedziczy sprzedawce po powiecie');

  /* ---------- start ---------- */
  console.log('\nInterfejs po starcie');
  ok(doc.querySelector('.tab.on').getAttribute('data-page') === 'pgAdd', 'zaczynamy na zakladce Dodaj');
  ok(doc.getElementById('btnGo').className.includes('off'), 'przycisk Google nieaktywny przy pustej trasie');
  ok(doc.getElementById('btnOpt').disabled, 'wyznaczanie kolejnosci nieaktywne');
  ok(doc.getElementById('btnClear').disabled, 'czyszczenie nieaktywne przy pustej trasie');
  ok(doc.getElementById('resStrip').hidden, 'pasek wyniku ukryty, dopoki nie ma wyniku');
  ok(doc.querySelector('.dock #btnGo') && doc.querySelector('.dock #resStrip'),
     'wynik i przycisk siedza w doku, nie w przewijanej liscie');

  console.log('\nUsuniete elementy');
  ['wojSel', 'sellSel', 'btnBulk', 'dwell', 'opa', 'calT', 'useAddr', 'viewswitch']
    .forEach(id => ok(!doc.getElementById(id), 'nie ma juz #' + id));

  /* ---------- wyszukiwarka gmin i powiatow w jednym ---------- */
  console.log('\nWyszukiwarka');
  const q = doc.getElementById('q');
  const szukaj = (t) => { q.value = t; q.oninput.call(q); };

  szukaj('kobierzyce');
  ok(doc.querySelectorAll('#qres .ri').length > 0, 'gmina znaleziona');
  ok(doc.getElementById('qres').textContent.includes('gmina'), 'wynik oznaczony jako gmina');

  szukaj('zywiecki');
  const rodzaje = Array.from(doc.querySelectorAll('#qres .kind')).map(e => e.textContent);
  ok(rodzaje.includes('powiat'), 'powiat tez jest w wynikach');
  ok(rodzaje.includes('gmina'), 'jedno pole zwraca oba rodzaje jednostek');
  ok(rodzaje[0] === 'gmina', 'gminy ida wyzej niz powiaty');

  szukaj('lodzki');
  ok(doc.getElementById('qres').textContent.includes('łódzki'), 'szukanie bez ogonkow dziala');

  /* ---------- dodawanie ---------- */
  console.log('\nPrzystanki');
  function dodajKod(kod) {
    const el = doc.querySelector('#qres [data-kod="' + kod + '"]');
    if (!el) { ok(false, 'brak wyniku o kodzie ' + kod); return; }
    el.onclick();
  }
  szukaj('zywiecki'); dodajKod('2417');
  szukaj('cieszyn'); dodajKod('2403');
  szukaj('kobierzyce'); dodajKod('0223052');
  szukaj('pszczyna'); dodajKod('2410');
  szukaj('mikolow'); dodajKod('2408');

  ok(doc.getElementById('cntStops').textContent === '5', 'dodano 5 przystankow');
  ok(doc.getElementById('cntStops2').textContent === '5', 'licznik na karcie zgadza sie z licznikiem w zakladce');
  szukaj('zywiecki'); dodajKod('2417');
  ok(doc.getElementById('cntStops').textContent === '5', 'ta sama jednostka nie dubluje sie');

  const href = doc.getElementById('btnGo').getAttribute('href');
  ok(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1/.test(href), 'odnosnik Google ma poprawny format');
  ok(decodeURIComponent(href).includes('Starostwo'), 'nawigacja prowadzi do urzedu');
  ok(decodeURIComponent(href).includes('Urząd Gminy Kobierzyce'), 'gmina prowadzi do urzedu gminy');

  /* ---------- tryby trasy ---------- */
  console.log('\nTryby trasy');
  const tryby = Array.from(doc.querySelectorAll('#modeSeg .mode'));
  ok(tryby.length === 3, 'trzy tryby do wyboru');
  ok(tryby.every(b => b.querySelector('.m-ico svg')), 'kazdy tryb ma ikone');
  ok(doc.querySelector('.ico-loop') && doc.querySelector('.ico-flag') && doc.querySelector('.ico-open'),
     'petla, flaga mety i trasa otwarta maja osobne ikony');
  ok(/@keyframes obrot/.test(cssTxt) && /@keyframes powiew/.test(cssTxt) && /@keyframes wybieg/.test(cssTxt),
     'kazda ikona ma wlasna animacje');
  tryby[2].onclick();
  ok(tryby[2].classList.contains('on'), 'tryb otwarty wlacza sie');
  ok(doc.getElementById('modeHint').textContent.includes('najszybciej'),
     'opis trybu otwartego mowi o najszybszym zakonczeniu');
  tryby[0].onclick();

  /* ---------- kolejnosc ---------- */
  console.log('\nZmiana kolejnosci');
  const ul = doc.getElementById('stops');
  ok(ul.querySelectorAll('.drag').length === 5, 'kazdy przystanek ma uchwyt do przeciagania');
  const przed = Array.from(ul.querySelectorAll('.stop-name')).map(e => e.textContent);
  ul.querySelectorAll('.drag')[2].dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  const po = Array.from(ul.querySelectorAll('.stop-name')).map(e => e.textContent);
  ok(przed[2] === po[1] && przed[1] === po[2], 'strzalka w gore przestawia przystanek');

  const czolo = ul.querySelector('.stop-name').textContent;
  const mysz = (typ, y) => new win.MouseEvent(typ, { bubbles: true, clientY: y });
  ul.querySelectorAll('.drag')[0].dispatchEvent(mysz('pointerdown', 0));
  ok(ul.querySelector('.lift') !== null, 'chwycony wiersz dostaje klase lift');
  ul.dispatchEvent(mysz('pointermove', 500));
  ul.dispatchEvent(mysz('pointerup', 500));
  ok(Array.from(ul.querySelectorAll('.stop-name')).pop().textContent === czolo,
     'przeciagniety przystanek laduje na koncu');
  ok(ul.querySelector('.lift') === null, 'po puszczeniu klasa lift znika');
  ok(doc.getElementById('cntStops').textContent === '5', 'przeciaganie nie gubi przystankow');

  /* ---------- edycja adresu ---------- */
  console.log('\nEdycja adresu przystanku');
  doc.querySelector('#stops [data-edit]').onclick();
  ok(doc.querySelector('#stops .stop.edit'), 'wiersz przechodzi w tryb edycji');
  const pole = doc.querySelector('#stops [data-adres]');
  ok(pole && pole.value.length > 3, 'pole edycji ma podstawiony obecny adres');
  pole.value = 'Rynek Główny 1, Kraków';
  doc.querySelector('#stops [data-find]').onclick();
  await new Promise(r => setTimeout(r, 40));
  ok(!doc.querySelector('#stops .stop.edit'), 'po znalezieniu adresu edycja sie zamyka');
  ok(doc.querySelector('#stops .stop-name').textContent.includes('Rynek Główny'),
     'nazwa przystanku zmienia sie na nowy adres');
  ok(decodeURIComponent(doc.getElementById('btnGo').getAttribute('href')).includes('Rynek Główny 1'),
     'nowy adres trafia do nawigacji');

  doc.querySelector('#stops [data-edit]').onclick();
  doc.querySelector('#stops [data-adres]').value = 'nieistniejacy adres xyz';
  doc.querySelector('#stops [data-find]').onclick();
  await new Promise(r => setTimeout(r, 40));
  ok(doc.querySelector('[data-status]').textContent.includes('nie znaleziono'),
     'brak wyniku jest zglaszany, a wiersz zostaje w edycji');
  doc.querySelector('#stops [data-cancel]').onclick();
  ok(!doc.querySelector('#stops .stop.edit'), 'anulowanie zamyka edycje');

  /* ---------- optymalizacja i pasek wyniku ---------- */
  console.log('\nOptymalizacja');
  const pierwszyPrzed = doc.querySelector('#stops .stop-name').textContent;
  doc.querySelectorAll('#stops [data-prio]')[3].onclick();
  doc.getElementById('btnOpt').onclick();
  await new Promise(r => setTimeout(r, 60));

  ok(!doc.getElementById('resStrip').hidden, 'pasek wyniku sie pokazuje');
  ok(doc.getElementById('rsDist').textContent.includes('km'), 'dystans ma jednostke');
  ok(doc.getElementById('rsTime').textContent.length > 2, 'czas jazdy podany');
  ok(doc.getElementById('rsNote').textContent.includes('OSRM'), 'zrodlo szacunku podpisane');
  ok(doc.querySelector('#stops .stop-name').textContent === pierwszyPrzed, 'start zostaje pierwszy');
  ok(doc.getElementById('cntStops').textContent === '5', 'optymalizacja nie gubi przystankow');
  const prioIdx = Array.from(doc.querySelectorAll('#stops .stop')).findIndex(e => e.className.includes('is-prio'));
  ok(prioIdx === 1, 'priorytet trafil zaraz za start (pozycja ' + prioIdx + ')');

  console.log('\nDrogi na trasie');
  const rd = doc.getElementById('rsRoads').textContent;
  ok(rd.includes('A4') && rd.includes('S1') && rd.includes('DK94'), 'A4, S1 i DK94 wypisane');
  ok(!rd.includes('781'), 'droga wojewodzka pominieta');
  ok(doc.querySelectorAll('#rsRoads .shield').length === 3, 'trzy tarczki w pasku wyniku');
  ok(/iconSize:\s*null/.test(appTxt), 'etykieta drogi nie ma narzuconej szerokosci');
  ok(/roadsPane[\s\S]{0,80}?650/.test(appTxt), 'etykiety drog maja wlasna warstwe nad trasa');
  ok(/\.shield,\.road-pin\{[^}]*Drogowskaz/.test(cssTxt.replace(/\s*\n\s*/g, '')),
     'tarczki uzywaja liternictwa drogowego');

  console.log('\nWariant awaryjny');
  trybSieci = 'padnij';
  doc.getElementById('btnOpt').onclick();
  await new Promise(r => setTimeout(r, 60));
  ok(doc.getElementById('rsNote').className.includes('warn'), 'ostrzezenie widoczne w pasku wyniku');
  ok(doc.getElementById('rsDist').textContent.startsWith('~'), 'liczby oznaczone tylda');
  ok(doc.getElementById('cntStops').textContent === '5', 'brak sieci nie gubi przystankow');
  trybSieci = 'ok';

  /* ---------- podklad mapy ---------- */
  console.log('\nMapa bazowa');
  const bazy = Array.from(doc.querySelectorAll('#bases .base'));
  ok(bazy.length === 4, 'cztery podklady do wyboru');
  const nazwy = bazy.map(b => b.querySelector('b').textContent);
  ok(nazwy.includes('Satelita') && nazwy.includes('OSM') && nazwy.includes('Topograficzna'),
     'jest satelita, OSM i topograficzna');
  ok(bazy.every(b => b.querySelector('img').getAttribute('src').startsWith('http')),
     'kazdy podklad ma miniaturke');
  ok(bazy[3].querySelector('small').textContent === 'OpenTopoMap', 'topograficzna z OpenTopoMap');

  ok(doc.getElementById('basePanel').hidden, 'panel wyboru domyslnie schowany');
  doc.getElementById('baseBtn').onclick();
  ok(!doc.getElementById('basePanel').hidden, 'przycisk otwiera panel wyboru');
  bazy[3].onclick();
  ok(bazy[3].classList.contains('on'), 'topograficzna wybrana');
  ok(doc.getElementById('basePanel').hidden, 'po wyborze panel sie zamyka');
  ok(doc.getElementById('map').className.includes('plain'), 'ciepły filtr zdjety z obcego podkladu');
  bazy[1].onclick();
  ok(bazy[1].classList.contains('on') && doc.getElementById('map').className.includes('plain'),
     'satelita wybrana i bez filtra');
  bazy[0].onclick();
  ok(!doc.getElementById('map').className.includes('plain'), 'wlasna mapa wraca z filtrem');

  /* ---------- warstwy ---------- */
  console.log('\nWarstwy mapy');
  ok(doc.getElementById('legend').textContent.includes('380'), 'przy oddaleniu legenda liczy powiaty');
  ok(/ZOOM_GMINY = 8/.test(appTxt), 'przelaczenie na gminy dzieje sie od przyblizenia 8');

  /* ---------- dlugie trasy ---------- */
  console.log('\nDlugie trasy i etapy');
  doc.getElementById('btnClear').onclick();
  ok(doc.getElementById('cntStops').textContent === '0', 'czyszczenie dziala');
  ['2401', '2402', '2403', '2405', '2406', '2407', '2408', '2409', '2410', '2411', '2412', '2413']
    .forEach(kod => { szukaj(kod); dodajKod(kod); });
  const ile = +doc.getElementById('cntStops').textContent;
  ok(ile === 12, 'dodano 12 przystankow po kodzie TERYT (' + ile + ')');
  const sg = doc.querySelectorAll('#segs .sg');
  ok(sg.length >= 2, 'trasa podzielona na ' + sg.length + ' etapow');
  const linki = Array.from(doc.querySelectorAll('#segs a')).map(a => a.getAttribute('href'));
  ok(linki.every(u => (u.match(/%7C/g) || []).length <= 8), 'kazdy etap ma najwyzej 9 punktow posrednich');
  const dest = u => decodeURIComponent(u.split('destination=')[1].split('&')[0]);
  const orig = u => decodeURIComponent(u.split('origin=')[1].split('&')[0]);
  let zazebia = true;
  for (let i = 0; i < linki.length - 1; i++) if (dest(linki[i]) !== orig(linki[i + 1])) zazebia = false;
  ok(zazebia, 'etapy zazebiaja sie — nic nie wypada miedzy nimi');
  ok(dest(linki[linki.length - 1]) === orig(linki[0]), 'petla wraca do startu');

  /* ---------- strony urzedow ---------- */
  console.log('\nStrony urzedow');
  doc.getElementById('btnClear').onclick();
  win.STRONY = { '2417': { www: 'https://powiat.zywiec.pl' }, '2403': { bip: 'https://bip.cieszyn.pl' } };
  szukaj('zywiecki'); dodajKod('2417');
  szukaj('cieszyn'); dodajKod('2403');
  szukaj('pszczyna'); dodajKod('2410');
  const www = Array.from(doc.querySelectorAll('#stops a.ibtn')).map(a => a.getAttribute('href'));
  ok(www[0] === 'https://powiat.zywiec.pl', 'znana strona trafia wprost');
  ok(www[1] === 'https://bip.cieszyn.pl', 'gdy nie ma strony, idzie BIP');
  ok(www[2].startsWith('https://www.google.com/search?q='), 'bez danych - wyszukiwarka');
  ok(decodeURIComponent(www[2]).includes('Starostwo Powiatowe Pszczyna BIP'), 'zapytanie zawiera nazwe urzedu');
  win.STRONY = {};

  /* ---------- zapis ---------- */
  console.log('\nZapis tras');
  const zapisanych = +doc.getElementById('cntStops').textContent;
  doc.getElementById('saveName').value = 'Test slaskie';
  doc.getElementById('btnSave').onclick();
  doc.querySelector('.tab[data-page="pgSaved"]').onclick();
  ok(doc.getElementById('savedCnt').textContent === '1', 'trasa zapisana');
  doc.getElementById('btnClear').onclick();
  doc.querySelector('#savedList [data-load]').onclick();
  ok(+doc.getElementById('cntStops').textContent === zapisanych, 'wczytana trasa ma tyle samo przystankow');
  ok(doc.querySelector('.tab.on').getAttribute('data-page') === 'pgRoute', 'wczytanie przenosi na zakladke Trasa');
  ok(doc.getElementById('btnGo').getAttribute('href'), 'po wczytaniu odnosnik Google jest aktualny');

  /* ---------- telefon i dostepnosc ---------- */
  console.log('\nTelefon i dostepnosc');
  const css1 = cssTxt.replace(/\s*\n\s*/g, '');
  ok(/maximum-scale=5/.test(cssTxt) && /viewport-fit=cover/.test(cssTxt),
     'viewport pozwala przyblizac i obejmuje wciecie ekranu');
  ok(/\.inp,textarea\{[^}]*font-size:16px/.test(css1),
     'pola maja 16px, wiec iOS nie przybliza strony przy focusie');
  ok(/--tap:44px/.test(cssTxt), 'zdefiniowany minimalny cel dotyku');
  ok(/@media \(min-width:880px\)/.test(cssTxt), 'uklad pisany od telefonu w gore');
  ok(/env\(safe-area-inset-bottom\)/.test(cssTxt), 'dok respektuje pasek gestow');
  ok(doc.querySelectorAll('[aria-label]').length >= 6, 'przyciski ikonowe maja etykiety dla czytnikow');
  ok(/prefers-reduced-motion/.test(cssTxt), 'animacje wylaczane na zyczenie systemu');

  console.log('\n== ' + (testy - bledy) + '/' + testy + ' testow przeszlo ==\n');
  process.exit(bledy ? 1 : 0);
})();
