/* Mapa sprzedaży — logika aplikacji.
   Punktem każdej jednostki jest siedziba jej władz, nie środek geometryczny.
   Kolejność przystanków liczy OSRM, nawigację prowadzi Google Maps. */
(function () {
'use strict';

/* ====================== narzędzia ====================== */

var $ = function (s) { return document.querySelector(s); };
var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* 'ł' nie rozkłada się w NFD, więc trzeba je podmienić przed normalizacją */
function norm(s) {
  return String(s || '')
    .replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim();
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function odm(n, a, b, c) {
  n = Math.abs(n);
  if (n === 1) return a;
  var d = n % 10, s = n % 100;
  return (d >= 2 && d <= 4 && (s < 10 || s >= 20)) ? b : c;
}

function fmtMinPlain(min) {
  min = Math.max(0, Math.round(min));
  var h = Math.floor(min / 60), m = min % 60;
  return h ? (h + ' h ' + m + ' min') : (m + ' min');
}

function hav(a, b) {
  var R = 6371, r = Math.PI / 180;
  var dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/* Zapis odporny na tryb prywatny — tam localStorage rzuca wyjątkiem */
var store = (function () {
  var ok = false, mem = {};
  try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); ok = true; } catch (e) {}
  return {
    get: function (k) { try { return ok ? localStorage.getItem(k) : (mem[k] || null); } catch (e) { return mem[k] || null; } },
    set: function (k, v) { try { if (ok) localStorage.setItem(k, v); else mem[k] = v; } catch (e) { mem[k] = v; } },
    trwaly: ok
  };
})();

/* ====================== stan ====================== */

var KEY_ROUTES = 'mapa_trasy_v2';
var KEY_PREFS = 'mapa_ustawienia_v4';

var OSRM = 'https://router.project-osrm.org';
var NOMINATIM = 'https://nominatim.openstreetmap.org';
var GM_WAYPOINTS = 8;            // 8 pośrednich + start + meta = 10, limit odnośnika Google
var ZOOM_GMINY = 8;              // niżej gminy są nieczytelne i tylko mulą mapę
var ZOOM_TWARZE_MAX = 10;        // wyżej twarze schodzą z drogi — miejsce na pracę w gminach
var MAX_OSRM = 95;               // publiczny serwer przyjmuje 100 punktów
var KRYCIE = 0.55;
var KRYCIE_ZDJECIE = 0.26;       // na zdjęciu lotniczym wypełnienie musi być lżejsze

var S = {
  stops: [],
  mode: 'loop',
  podklad: 'mapa',
  filter: 'all',
  twarze: true,                  // twarze handlowców na mapie (można schować)
  edycja: null,                  // id przystanku w trybie edycji adresu
  wynik: null
};

var SELLERS = [];
var seq = 1;

var ZBIORY = {
  powiaty: { idx: [], wg: {}, geo: null, gotowy: false },
  gminy:   { idx: [], wg: {}, geo: null, gotowy: false }
};

/* Kod powiatu ma 4 znaki, kod gminy 7 — po długości wiadomo, gdzie szukać.
   Słownik zamiast przeszukiwania listy: warstwa gmin przerysowuje się przy
   każdym przesunięciu mapy i skan po 2477 pozycjach byłby odczuwalny. */
function jednostkaPoKodzie(kod) {
  var z = ZBIORY[String(kod).length > 4 ? 'gminy' : 'powiaty'];
  return z.wg[kod] || null;
}

function zapiszWgKodu(z) {
  z.wg = {};
  z.idx.forEach(function (j) { z.wg[j.kod] = j; });
}

/* ====================== paleta sprzedawców ====================== */

var BARWY = ['#6E7A4B', '#8C5A3C', '#4E6B7A', '#6B4A63', '#B08A3E', '#A15544', '#4A4E57', '#7E8C79'];

function barwa(s) {
  if (!s || s === 'nikt') return '#C9C3A8';
  var i = SELLERS.indexOf(s);
  if (i < 0) {
    var h = 0;
    for (var j = 0; j < s.length; j++) h = (h * 31 + s.charCodeAt(j)) >>> 0;
    i = h;
  }
  return BARWY[i % BARWY.length];
}

/* ====================== twarze handlowców ====================== */

/* Klucz to nazwa handlowca z danych, wartość to plik w assets/twarze/.
   Nazwy plików bez polskich znaków, żeby uniknąć kłopotów z kodowaniem. */
var TWARZE = {
  'Aleksander': 'assets/twarze/aleksander.jpg',
  'Dominik':    'assets/twarze/dominik.jpg',
  'Jakub':      'assets/twarze/jakub.jpg',
  'Michał':     'assets/twarze/michal.jpg',
  'WMKK':       'assets/twarze/wmkk.jpg'
};
function twarzUrl(s) { return (s && TWARZE[s]) || null; }

/* ====================== dane ====================== */

function zbudujIndeks(db, typ) {
  return db.centers.map(function (c) {
    return {
      typ: typ,
      kod: c[0], nazwa: c[1], woj: c[2], sprzedawca: c[3] || 'nikt',
      lat: c[4], lng: c[5],            // punkt etykiety, zawsze wewnątrz granicy
      uLat: c[6], uLng: c[7],          // siedziba władz, cel nawigacji
      miasto: c[8], urzad: c[9],
      powiat: c[10] || null,
      n: norm([c[1], c[8], c[2], c[0], c[10] || ''].join(' ')),
      nn: norm(c[1])
    };
  });
}

function initDane() {
  var db = window.POWIATY_DB;
  if (!db || !db.centers) throw new Error('Brak data/powiaty.js');

  ZBIORY.powiaty.idx = zbudujIndeks(db, 'powiat');
  ZBIORY.powiaty.geo = db.geo;
  zapiszWgKodu(ZBIORY.powiaty);
  ZBIORY.powiaty.gotowy = true;

  var s = {};
  ZBIORY.powiaty.idx.forEach(function (p) { s[p.sprzedawca] = 1; });
  SELLERS = Object.keys(s).filter(function (x) { return x !== 'nikt'; })
              .sort(function (a, b) { return a.localeCompare(b, 'pl'); });
  if (s['nikt']) SELLERS.push('nikt');
}

var ladowanieGmin = null;
function wczytajGminy() {
  if (ZBIORY.gminy.gotowy) return Promise.resolve();
  if (ladowanieGmin) return ladowanieGmin;

  ladowanieGmin = new Promise(function (res, rej) {
    if (window.GMINY_DB) return res();
    var sc = document.createElement('script');
    sc.src = 'data/gminy.js';
    sc.onload = function () { res(); };
    sc.onerror = function () { rej(new Error('Nie udało się wczytać danych gmin.')); };
    document.head.appendChild(sc);
  }).then(function () {
    if (!window.GMINY_DB) throw new Error('Plik gmin wczytany, ale pusty.');
    ZBIORY.gminy.idx = zbudujIndeks(window.GMINY_DB, 'gmina');
    ZBIORY.gminy.geo = window.GMINY_DB.geo;
    zapiszWgKodu(ZBIORY.gminy);
    // ramki do szybkiego filtrowania po widocznym kadrze
    ZBIORY.gminy.geo.features.forEach(function (f) {
      var minx = 999, miny = 999, maxx = -999, maxy = -999;
      f.geometry.coordinates.forEach(function (poly) {
        poly[0].forEach(function (c) {
          if (c[0] < minx) minx = c[0];
          if (c[0] > maxx) maxx = c[0];
          if (c[1] < miny) miny = c[1];
          if (c[1] > maxy) maxy = c[1];
        });
      });
      f._b = [minx, miny, maxx, maxy];
    });
    ZBIORY.gminy.gotowy = true;
  });
  return ladowanieGmin;
}

/* ====================== podkłady ====================== */

/* Podgląd to prawdziwy kafelek z tej samej okolicy (Kraków, zoom 12),
   więc kafelki w wyborze wyglądają dokładnie tak jak mapa po kliknięciu. */
var PODGLAD_Z = 12, PODGLAD_X = 2274, PODGLAD_Y = 1388;

function ortoUrl(z, y, x) {
  return 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution' +
    '?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA' +
    '&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:' + z + '&TILEROW=' + y + '&TILECOL=' + x;
}

var PODKLADY = [
  {
    id: 'mapa', nazwa: 'Mapa', zrodlo: 'CARTO Voyager', cieply: true,
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    opcje: { subdomains: 'abcd', maxZoom: 19, attribution: '&copy; OpenStreetMap, &copy; CARTO' },
    podglad: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/' + PODGLAD_Z + '/' + PODGLAD_X + '/' + PODGLAD_Y + '.png'
  },
  {
    id: 'satelita', nazwa: 'Satelita', zrodlo: 'Geoportal GUGiK',
    url: ortoUrl('{z}', '{y}', '{x}'),
    opcje: { maxZoom: 19, maxNativeZoom: 19, attribution: 'Ortofotomapa: <a href="https://www.geoportal.gov.pl/">GUGiK</a>' },
    podglad: ortoUrl(PODGLAD_Z, PODGLAD_Y, PODGLAD_X),
    zapas: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      opcje: { maxZoom: 19, attribution: 'Zdjęcia: Esri, Maxar, Earthstar Geographics' }
    }
  },
  {
    id: 'osm', nazwa: 'OSM', zrodlo: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    opcje: { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
    podglad: 'https://tile.openstreetmap.org/' + PODGLAD_Z + '/' + PODGLAD_X + '/' + PODGLAD_Y + '.png'
  },
  {
    id: 'topo', nazwa: 'Topograficzna', zrodlo: 'OpenTopoMap',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    opcje: { subdomains: 'abc', maxZoom: 17, attribution: '&copy; OpenStreetMap, SRTM · <a href="https://opentopomap.org/">OpenTopoMap</a> (CC-BY-SA)' },
    podglad: 'https://a.tile.opentopomap.org/' + PODGLAD_Z + '/' + PODGLAD_X + '/' + PODGLAD_Y + '.png'
  }
];

function podkladPoId(id) {
  for (var i = 0; i < PODKLADY.length; i++) if (PODKLADY[i].id === id) return PODKLADY[i];
  return PODKLADY[0];
}

/* ====================== mapa ====================== */

var map, warstwaPow, warstwaGm, warstwaWoj, warstwaWojCien, warstwaKafelki;
var warstwaTwarze = null, markeryTwarzy = [], pozycjeTwarzy = null;
var liniaTrasy = null, markeryStopow = [], markeryDrog = [];
var rendererTrasy, rendererStopow, rendererWoj, bledyKafelkow = 0;

function initMapa() {
  map = L.map('map', {
    zoomControl: false, minZoom: 5, maxZoom: 17,
    preferCanvas: true,                     // wszystko na jednym płótnie zamiast setek elementów SVG
    attributionControl: true
  }).setView([52.05, 19.35], 6);

  L.control.zoom({ position: 'topright' }).addTo(map);

  map.createPane('wojPane');   map.getPane('wojPane').style.zIndex = 500;   // granice województw nad wypełnieniem, pod trasą
  map.createPane('twarzePane');map.getPane('twarzePane').style.zIndex = 615; // twarze nad granicami, pod przystankami trasy
  map.createPane('routePane'); map.getPane('routePane').style.zIndex = 620;
  map.createPane('roadsPane'); map.getPane('roadsPane').style.zIndex = 650;  // tarczki nad linią trasy
  map.createPane('stopsPane'); map.getPane('stopsPane').style.zIndex = 660;
  rendererTrasy = L.svg({ pane: 'routePane' });
  rendererStopow = L.svg({ pane: 'stopsPane' });
  rendererWoj = L.svg({ pane: 'wojPane' });                                 // 16 obszarów, SVG daje ostre, ciągłe linie

  ustawPodklad(S.podklad, true);

  warstwaPow = L.geoJSON(ZBIORY.powiaty.geo, { style: stylObszaru, onEachFeature: podepnijKlik });
  warstwaGm = L.geoJSON(null, { style: stylObszaru, onEachFeature: podepnijKlik });

  // Granice województw rysujemy dwiema liniami: jasna otoczka pod spodem daje
  // kontrast na każdym podkładzie (także na zdjęciu lotniczym), ciemna linia na
  // wierzchu to sama granica. Dzięki temu struktura kraju czyta się od pierwszego
  // rzutu oka i nigdy nie zlewa się z cienkimi liniami powiatów i gmin.
  warstwaWojCien = L.geoJSON(null, {
    pane: 'wojPane', renderer: rendererWoj, interactive: false,
    style: { fill: false, color: '#FBF5DD', weight: 5, opacity: 0.85, lineJoin: 'round', lineCap: 'round' }
  });
  warstwaWoj = L.geoJSON(null, {
    pane: 'wojPane', renderer: rendererWoj, interactive: false,
    style: { fill: false, color: '#2E3220', weight: 2.2, opacity: 0.95, lineJoin: 'round', lineCap: 'round' }
  });
  warstwaPow.addTo(map);
  zbudujWojewodztwa();       // WOJ_DB ładuje się od razu (data/wojewodztwa.js), więc granice są od startu

  map.on('moveend zoomend', odswiezWarstwy);

  map.on('popupopen', function (e) {
    var el = e.popup.getElement();
    if (!el) return;
    var b = el.querySelector('[data-add]');
    if (b) b.onclick = function () {
      dodajJednostke(jednostkaPoKodzie(b.getAttribute('data-add')));
      map.closePopup();
    };
  });
}

function ustawPodklad(id, cicho) {
  var p = podkladPoId(id);
  S.podklad = p.id;

  if (warstwaKafelki && map.hasLayer(warstwaKafelki)) map.removeLayer(warstwaKafelki);
  bledyKafelkow = 0;
  warstwaKafelki = L.tileLayer(p.url, p.opcje);

  // Geoportal bywa niedostępny. Zamiast pustej szachownicy wchodzą zdjęcia Esri.
  if (p.zapas) {
    warstwaKafelki.on('tileerror', function () {
      if (++bledyKafelkow < 8 || !p.zapas) return;
      var zapas = p.zapas; p.zapas = null;
      map.removeLayer(warstwaKafelki);
      warstwaKafelki = L.tileLayer(zapas.url, zapas.opcje).addTo(map);
      pokazPodpowiedz('Geoportal nie odpowiada — pokazuję zdjęcia zapasowe.', 4500);
    });
  }
  warstwaKafelki.addTo(map);

  var el = map.getContainer();
  if (el && el.classList) el.classList.toggle('plain', !p.cieply);
  stylujWojewodztwa();

  $$('#bases .base').forEach(function (b) {
    b.classList.toggle('on', b.getAttribute('data-base') === p.id);
    b.setAttribute('aria-pressed', b.getAttribute('data-base') === p.id ? 'true' : 'false');
  });

  if (!cicho) { odswiezStyle(); zapiszUstawienia(); }
}

function rysujWyborPodkladu() {
  $('#bases').innerHTML = PODKLADY.map(function (p) {
    return '<button class="base' + (p.id === S.podklad ? ' on' : '') + '" data-base="' + p.id + '" ' +
      'aria-pressed="' + (p.id === S.podklad) + '">' +
      '<img src="' + esc(p.podglad) + '" alt="" loading="lazy" width="104" height="66">' +
      '<span class="lab"><b>' + esc(p.nazwa) + '</b><small>' + esc(p.zrodlo) + '</small></span></button>';
  }).join('');

  $$('#bases .base').forEach(function (b) {
    b.onclick = function () {
      ustawPodklad(b.getAttribute('data-base'));
      pokazWyborPodkladu(false);
    };
  });
}

function pokazWyborPodkladu(pokaz) {
  $('#basePanel').hidden = !pokaz;
  $('#baseBtn').hidden = pokaz;
  $('#baseBtn').setAttribute('aria-expanded', pokaz ? 'true' : 'false');
}

function podepnijKlik(f, layer) {
  layer.on('click', function () {
    var j = jednostkaPoKodzie(f.properties.k);
    if (j) pokazPopup(j, layer);
  });
}

function stylObszaru(f) {
  var j = jednostkaPoKodzie(f.properties.k);
  var s = j ? j.sprzedawca : (f.properties.s || 'nikt');
  var pasuje = S.filter === 'all' || s === S.filter;
  var zdjecie = S.podklad === 'satelita';
  var drobne = String(f.properties.k).length > 4;
  return {
    fillColor: barwa(s),
    // przygaszamy zamiast ukrywać: struktura mapy zostaje czytelna
    fillOpacity: pasuje ? (zdjecie ? KRYCIE_ZDJECIE : KRYCIE) : 0.05,
    color: zdjecie ? '#FFFFFF' : '#FBF5DD',
    weight: pasuje ? (drobne ? (zdjecie ? 0.8 : 0.5) : (zdjecie ? 1.2 : 0.8)) : 0.3,
    opacity: pasuje ? (zdjecie ? 0.95 : 0.85) : 0.2
  };
}

function pelnaNazwa(j) {
  return j.typ === 'gmina' ? ('gmina ' + j.nazwa) : j.nazwa;
}

/* Strona urzędu. Kolejność: własna strona, potem BIP, a gdy nie znamy żadnej —
   wyszukiwarka z gotowym zapytaniem. Zgadywanie adresu dałoby martwe odnośniki,
   a to gorsze niż jedno kliknięcie więcej. */
function stronaJednostki(j) {
  var s = (window.STRONY || {})[j.kod];
  if (s && s.www) return { url: s.www, etykieta: 'Strona urzędu', pewne: true };
  if (s && s.bip) return { url: s.bip, etykieta: 'BIP', pewne: true };
  var q = (j.typ === 'gmina' ? (j.urzad + ' ' + j.nazwa) : (j.urzad + ' ' + j.miasto)) + ' BIP';
  return { url: 'https://www.google.com/search?q=' + encodeURIComponent(q),
           etykieta: 'Znajdź stronę', pewne: false };
}

function domena(url) {
  var m = String(url).match(/^https?:\/\/([^/]+)/);
  return m ? m[1].replace(/^www\./, '') : url;
}

function pokazPopup(j, layer) {
  var jest = S.stops.some(function (s) { return s.kod === j.kod; });
  var w = stronaJednostki(j);
  var podpis = j.typ === 'gmina' ? (j.powiat || j.woj) : j.woj;
  var av = twarzUrl(j.sprzedawca);
  var avHtml = av ? '<img class="pop-av" src="' + esc(av) + '" alt="" style="--kolor:' + barwa(j.sprzedawca) + '">' : '';
  var html =
    '<div class="pop-t">' + esc(pelnaNazwa(j)) + '</div>' +
    '<div class="pop-s" style="color:' + barwa(j.sprzedawca) + '">' + avHtml + '<span>' + esc(j.sprzedawca) + ' · ' + esc(podpis) + '</span></div>' +
    '<div class="pop-a">' + esc(j.urzad) + '<br>' + esc(j.miasto) + '</div>' +
    '<div class="pop-btns">' +
      (jest ? '<span class="tag">już na trasie</span>'
            : '<button class="btn sm primary" data-add="' + esc(j.kod) + '">Dodaj do trasy</button>') +
      '<a class="pop-www' + (w.pewne ? '' : ' szukaj') + '" href="' + esc(w.url) + '" target="_blank" rel="noopener" ' +
        'title="' + esc(w.pewne ? domena(w.url) : 'szukaj w Google') + '">' + esc(w.etykieta) + ' ↗</a>' +
    '</div>';
  layer.bindPopup(html, { minWidth: 210, maxWidth: 270 }).openPopup();
}

/* Powiaty służą już tylko za widok z lotu ptaka. Od przybliżenia 8 mapa
   przechodzi na gminy i rysuje tylko te, które mieszczą się w kadrze —
   2477 obszarów naraz dławi telefon. */
/* Granice województw są zawsze na mapie (warstwa dodana raz, w wojPane nad
   wypełnieniem). Tu przełączamy tylko powiaty <-> gminy i odświeżamy twarze. */
function zbudujWojewodztwa() {
  if (!window.WOJ_DB || warstwaWoj._wgotowe) return;
  warstwaWojCien.clearLayers(); warstwaWojCien.addData(window.WOJ_DB);
  warstwaWoj.clearLayers();     warstwaWoj.addData(window.WOJ_DB);
  warstwaWojCien.addTo(map);
  warstwaWoj.addTo(map);
  warstwaWoj._wgotowe = true;
  stylujWojewodztwa();
}

/* Na zdjęciu lotniczym otoczka schodzi na biel i cieńczeje, żeby nie dominowała
   nad terenem; na własnej mapie zostaje ciepła i mocna. */
function stylujWojewodztwa() {
  if (!warstwaWoj || !warstwaWoj._wgotowe) return;
  var zdjecie = S.podklad === 'satelita';
  warstwaWojCien.setStyle({
    color: zdjecie ? '#FFFFFF' : '#FBF5DD',
    weight: zdjecie ? 4 : 5,
    opacity: zdjecie ? 0.7 : 0.85
  });
  warstwaWoj.setStyle({
    color: zdjecie ? '#12140C' : '#2E3220',
    weight: zdjecie ? 1.8 : 2.2,
    opacity: zdjecie ? 0.9 : 0.95
  });
}

function odswiezWarstwy() {
  var chceGminy = map.getZoom() >= ZOOM_GMINY;

  if (chceGminy && ZBIORY.gminy.gotowy) {
    if (map.hasLayer(warstwaPow)) map.removeLayer(warstwaPow);
    rysujGminyWKadrze();
    schowajPodpowiedz();
  } else {
    if (map.hasLayer(warstwaGm)) map.removeLayer(warstwaGm);
    if (!map.hasLayer(warstwaPow)) warstwaPow.addTo(map);
    if (chceGminy && !ZBIORY.gminy.gotowy) pokazPodpowiedz('Wczytuję gminy…', 2500);
    else schowajPodpowiedz();
  }
  odswiezTwarze();
  rysujLegende();
}

/* ====================== twarze na mapie ====================== */

/* Jedna twarz na handlowca, w medoidzie jego terytorium: bierzemy punkt etykiety
   powiatu najbliższy średniej wszystkich jego powiatów, więc twarz zawsze siedzi
   wewnątrz obszaru danej osoby, a nie w morzu ani u sąsiada. */
function policzPozycjeTwarzy() {
  var wg = {};
  ZBIORY.powiaty.idx.forEach(function (p) {
    if (!twarzUrl(p.sprzedawca)) return;
    (wg[p.sprzedawca] = wg[p.sprzedawca] || []).push(p);
  });
  pozycjeTwarzy = Object.keys(wg).map(function (s) {
    var pts = wg[s], alat = 0, alng = 0;
    pts.forEach(function (p) { alat += p.lat; alng += p.lng; });
    alat /= pts.length; alng /= pts.length;
    var best = pts[0], bd = Infinity;
    pts.forEach(function (p) {
      var d = (p.lat - alat) * (p.lat - alat) + (p.lng - alng) * (p.lng - alng);
      if (d < bd) { bd = d; best = p; }
    });
    return { s: s, lat: best.lat, lng: best.lng, ile: pts.length };
  });
}

function zbudujTwarze() {
  if (!pozycjeTwarzy) policzPozycjeTwarzy();
  if (warstwaTwarze) { map.removeLayer(warstwaTwarze); }
  warstwaTwarze = L.layerGroup();
  markeryTwarzy = [];
  pozycjeTwarzy.forEach(function (o) {
    var html =
      '<div class="twarz" style="--kolor:' + barwa(o.s) + '">' +
        '<img src="' + esc(twarzUrl(o.s)) + '" alt="' + esc(o.s) + '" loading="lazy" draggable="false">' +
        '<span class="twarz-lab">' + esc(o.s) + '</span>' +
      '</div>';
    var m = L.marker([o.lat, o.lng], {
      pane: 'twarzePane',
      icon: L.divIcon({ className: 'twarz-ic', html: html, iconSize: [52, 52], iconAnchor: [26, 26] }),
      keyboard: false, riseOnHover: true, title: o.s + ' · ' + o.ile + ' powiatów'
    });
    m._s = o.s;
    m.on('click', function () {
      S.filter = (S.filter === o.s) ? 'all' : o.s;
      odswiezStyle(); rysujLegende();
    });
    warstwaTwarze.addLayer(m);
    markeryTwarzy.push(m);
  });
}

/* „Odpowiedni zoom": twarze widać w widoku przeglądowym (kraj i powiaty), a przy
   zejściu w gminy schodzą z drogi. Przy aktywnym filtrze przygaszamy pozostałe. */
function odswiezTwarze() {
  if (!map) return;
  if (!warstwaTwarze) zbudujTwarze();
  var pokaz = S.twarze && map.getZoom() <= ZOOM_TWARZE_MAX;
  if (!pokaz) {
    if (map.hasLayer(warstwaTwarze)) map.removeLayer(warstwaTwarze);
    return;
  }
  if (!map.hasLayer(warstwaTwarze)) warstwaTwarze.addTo(map);
  markeryTwarzy.forEach(function (m) {
    var el = m.getElement(); if (!el) return;
    var wybrany = S.filter === 'all' || S.filter === m._s;
    el.classList.toggle('twarz-dim', !wybrany);
    el.classList.toggle('twarz-on', S.filter === m._s);
  });
}

function aktualizujTwarzeBtn() {
  var b = $('#twarzeBtn'); if (!b) return;
  b.classList.toggle('on', !!S.twarze);
  b.setAttribute('aria-pressed', S.twarze ? 'true' : 'false');
  b.title = S.twarze ? 'Ukryj twarze handlowców' : 'Pokaż twarze handlowców';
}

function rysujGminyWKadrze() {
  var b = map.getBounds().pad(0.25);
  var w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();
  var widoczne = ZBIORY.gminy.geo.features.filter(function (f) {
    var r = f._b;
    return r[0] <= e && r[2] >= w && r[1] <= n && r[3] >= s;
  });
  warstwaGm.clearLayers();
  warstwaGm.addData({ type: 'FeatureCollection', features: widoczne });
  if (!map.hasLayer(warstwaGm)) warstwaGm.addTo(map);
}

function warstwaAktywna() {
  return (ZBIORY.gminy.gotowy && map.getZoom() >= ZOOM_GMINY) ? ZBIORY.gminy : ZBIORY.powiaty;
}

function pokazPodpowiedz(tekst, ms) {
  var el = $('#zoomHint');
  el.textContent = tekst;
  el.hidden = false;
  clearTimeout(pokazPodpowiedz._t);
  if (ms) pokazPodpowiedz._t = setTimeout(schowajPodpowiedz, ms);
}

function schowajPodpowiedz() {
  clearTimeout(pokazPodpowiedz._t);
  $('#zoomHint').hidden = true;
}

function dosun(latlng) {
  // przesuwamy mapę tylko wtedy, gdy punkt wypadł poza kadr
  if (!map.getBounds().pad(-0.12).contains(latlng)) map.panTo(latlng, { animate: true });
}

function odswiezStyle() {
  warstwaPow.setStyle(stylObszaru);
  if (map.hasLayer(warstwaGm)) warstwaGm.setStyle(stylObszaru);
  odswiezTwarze();
}

/* ====================== legenda ====================== */

function rysujLegende() {
  var box = $('#legend');
  var idx = warstwaAktywna().idx;
  if (box._n === idx.length && box._f === S.filter) return;   // bez potrzeby nie przerysowujemy
  box._n = idx.length; box._f = S.filter;
  box.innerHTML = '';

  function chip(klucz, etykieta, kolor, ile) {
    var d = document.createElement('div');
    d.className = 'chip' + (S.filter === klucz ? ' on' : '');
    var ikona = twarzUrl(etykieta)
      ? '<span class="chip-av" style="--kolor:' + kolor + '"><img src="' + esc(twarzUrl(etykieta)) + '" alt="" loading="lazy"></span>'
      : '<span class="dot" style="background:' + kolor + '"></span>';
    d.innerHTML = ikona + '<div>' + esc(etykieta) + '</div><div class="c">' + ile + '</div>';
    d.onclick = function () {
      S.filter = (S.filter === klucz && klucz !== 'all') ? 'all' : klucz;
      box._f = null;
      odswiezStyle();
      rysujLegende();
    };
    box.appendChild(d);
  }

  chip('all', 'Wszyscy', '#3A3E2C', idx.length);
  SELLERS.forEach(function (s) {
    chip(s, s, barwa(s), idx.filter(function (p) { return p.sprzedawca === s; }).length);
  });
}

/* ====================== przystanki ====================== */

function dodajStop(o) {
  if (o.kod && S.stops.some(function (s) { return s.kod === o.kod; })) return false;
  o.id = 's' + (seq++);
  o.prio = !!o.prio;
  S.stops.push(o);
  S.wynik = null;
  rysujTrase();
  render();
  return true;
}

function dodajJednostke(j) {
  if (!j) return false;
  // do Google idzie nazwa urzędu — trafia w budynek, nie w środek działki
  var zapytanie = j.typ === 'gmina'
    ? (j.urzad + ' ' + j.nazwa + (norm(j.miasto) !== norm(j.nazwa) ? ', ' + j.miasto : ''))
    : (j.urzad + ', ' + j.miasto);
  var w = stronaJednostki(j);

  var ok = dodajStop({
    kod: j.kod, nazwa: pelnaNazwa(j),
    opis: j.urzad + ', ' + j.miasto,
    lat: j.uLat, lng: j.uLng,
    zapytanie: zapytanie, krotko: j.miasto,
    strona: w.url, stronaEtykieta: w.etykieta
  });
  if (ok) dosun(L.latLng(j.uLat, j.uLng));
  return ok;
}

function usunStop(id) {
  S.stops = S.stops.filter(function (s) { return s.id !== id; });
  if (S.edycja === id) S.edycja = null;
  S.wynik = null; rysujTrase(); render();
}

function przelaczPrio(id) {
  var s = S.stops.find(function (x) { return x.id === id; });
  if (s) { s.prio = !s.prio; S.wynik = null; rysujTrase(); render(); }
}

function przestaw(od, doIdx) {
  if (od === doIdx || od < 0 || doIdx < 0 || od >= S.stops.length || doIdx >= S.stops.length) return;
  var el = S.stops.splice(od, 1)[0];
  S.stops.splice(doIdx, 0, el);
  S.wynik = null; rysujTrase(); render();
}

/* Adres przystanku można poprawić w każdej chwili i wyszukać od nowa —
   OCR i wklejone listy bywają niedokładne, a urząd czasem się przeprowadza. */
function szukajAdresu(id, tekst) {
  var s = S.stops.find(function (x) { return x.id === id; });
  if (!s || !tekst.trim()) return;
  var stat = $('[data-status="' + id + '"]');
  if (stat) { stat.className = 'stat wait'; stat.textContent = 'szukam…'; }

  return fetch(NOMINATIM + '/search?format=jsonv2&limit=1&countrycodes=pl&q=' + encodeURIComponent(tekst))
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (!res || !res.length) {
        if (stat) { stat.className = 'stat err'; stat.textContent = 'nie znaleziono'; }
        return;
      }
      s.lat = parseFloat(res[0].lat);
      s.lng = parseFloat(res[0].lon);
      s.nazwa = res[0].display_name.split(',').slice(0, 2).join(', ');
      s.opis = tekst.trim();
      s.zapytanie = tekst.trim();
      s.krotko = s.nazwa.split(',')[0];
      S.edycja = null;
      S.wynik = null;
      rysujTrase(); render();
      dosun(L.latLng(s.lat, s.lng));
    })
    .catch(function () {
      if (stat) { stat.className = 'stat err'; stat.textContent = 'błąd sieci'; }
    });
}

/* ====================== solver ====================== */

function macierzHav(pts) {
  var n = pts.length, m = [];
  for (var i = 0; i < n; i++) {
    m[i] = [];
    for (var j = 0; j < n; j++) {
      // linia prosta * 1.30 (krętość dróg) przy średniej 62 km/h
      m[i][j] = i === j ? 0 : hav(pts[i], pts[j]) * 1.30 / 62 * 3600;
    }
  }
  return m;
}

function wspolrzedne(pts) {
  // OSRM przyjmuje lng,lat — odwrotnie niż Leaflet [lat,lng]
  return pts.map(function (p) { return p.lng.toFixed(6) + ',' + p.lat.toFixed(6); }).join(';');
}

function promienie(pts) {
  // 800 m: dość ciasno, żeby nie przyciągnąć punktu do drogi polnej,
  // i dość luźno, żeby całe zapytanie nie padło przez jeden trudny adres
  return pts.map(function () { return '800'; }).join(';');
}

function osrmTable(pts) {
  var url = OSRM + '/table/v1/driving/' + wspolrzedne(pts) +
            '?annotations=duration&radiuses=' + promienie(pts);
  return fetch(url).then(function (r) { return r.json(); }).then(function (d) {
    return (d && d.code === 'Ok' && d.durations) ? d.durations : null;
  }).catch(function () { return null; });
}

function osrmRoute(pts) {
  var url = OSRM + '/route/v1/driving/' + wspolrzedne(pts) +
            '?overview=full&geometries=geojson' +
            '&steps=true' +                       // numery dróg do pokazania na mapie
            '&continue_straight=false' +          // pozwól zawrócić na przystanku
            '&radiuses=' + promienie(pts);
  return fetch(url).then(function (r) { return r.json(); }).then(function (d) {
    if (!d || d.code !== 'Ok' || !d.routes || !d.routes.length) return null;
    var r0 = d.routes[0];
    return {
      dystans: r0.distance, czas: r0.duration, legs: r0.legs || [],
      linia: r0.geometry.coordinates.map(function (c) { return [c[1], c[0]]; })
    };
  }).catch(function () { return null; });
}

function odwroc(a, i, k) {
  while (i < k) { var t = a[i]; a[i] = a[k]; a[k] = t; i++; k--; }
}

function najblizszySasiad(cost, od, wezly) {
  var rem = wezly.slice(), sciezka = [], cur = od;
  while (rem.length) {
    var bi = 0;
    for (var i = 1; i < rem.length; i++) if (cost[cur][rem[i]] < cost[cur][rem[bi]]) bi = i;
    cur = rem[bi]; sciezka.push(cur); rem.splice(bi, 1);
  }
  return sciezka;
}

/* 2-opt ograniczone do pozycji od `lo` do `hi`.
   Zakres pilnuje, żeby poprawianie kolejności nie wyrzuciło startu, mety
   ani bloku priorytetów z przypisanego im miejsca. */
function dwaOpt(cost, f, lo, hi) {
  if (hi <= lo) return f;
  var poprawa = true, iter = 0;
  while (poprawa && iter++ < 200) {
    poprawa = false;
    for (var i = lo; i <= hi; i++) {
      for (var k = i + 1; k <= hi; k++) {
        var a = f[i - 1], b = f[i], c = f[k], d = (k + 1 < f.length) ? f[k + 1] : null;
        var przed = cost[a][b] + (d !== null ? cost[c][d] : 0);
        var po    = cost[a][c] + (d !== null ? cost[b][d] : 0);
        if (po < przed - 1e-9) { odwroc(f, i, k); poprawa = true; }   // margines chroni przed oscylacją
      }
    }
  }
  return f;
}

function ustawKolejnosc(pts, cost) {
  var n = pts.length;
  var meta = (S.mode === 'ends' && n > 2) ? n - 1 : -1;

  var reszta = [];
  for (var i = 1; i < n; i++) if (i !== meta) reszta.push(i);

  var prio = reszta.filter(function (i) { return pts[i].prio; });
  var zwykle = reszta.filter(function (i) { return !pts[i].prio; });

  var a = najblizszySasiad(cost, 0, prio);
  var ostatni = a.length ? a[a.length - 1] : 0;
  var b = najblizszySasiad(cost, ostatni, zwykle);

  var f = [0].concat(a, b);
  var domkniecie = (S.mode === 'loop') ? 0 : meta;
  if (domkniecie >= 0) f.push(domkniecie);

  dwaOpt(cost, f, 1, a.length);                            // blok priorytetów
  dwaOpt(cost, f, a.length + 1, a.length + b.length);      // reszta

  if (S.mode === 'loop') f.pop();   // powrót do startu dopisujemy dopiero przy rysowaniu
  return f;
}

function optymalizuj() {
  if (S.stops.length < 2) return;
  var btn = $('#btnOpt'), etykieta = btn.querySelector('.act-txt');
  btn.disabled = true; etykieta.textContent = 'Liczę…';

  var pts = S.stops.slice();
  var zaDuzo = pts.length > MAX_OSRM;
  var wstep = zaDuzo ? Promise.resolve(null) : osrmTable(pts);

  wstep.then(function (cost) {
    var powod = null;
    if (!cost) { cost = macierzHav(pts); powod = zaDuzo ? 'limit' : 'siec'; }

    var kolejnosc = ustawKolejnosc(pts, cost);
    S.stops = kolejnosc.map(function (i) { return pts[i]; });

    var trasa = S.stops.slice();
    if (S.mode === 'loop') trasa.push(S.stops[0]);

    return (zaDuzo ? Promise.resolve(null) : osrmRoute(trasa)).then(function (r) {
      if (r) {
        S.wynik = { dystans: r.dystans, czas: r.czas, linia: r.linia,
                    przyblizone: false, legs: r.legs, drogi: drogiZTrasy(r.legs) };
      } else {
        if (!powod) powod = 'siec';
        var czas = 0, km = 0;
        for (var i = 0; i < trasa.length - 1; i++) {
          var a = kolejnosc[i], b = kolejnosc[i + 1];
          czas += (a != null && b != null && cost[a] && cost[a][b] != null)
                  ? cost[a][b] : hav(trasa[i], trasa[i + 1]) * 1.30 / 62 * 3600;
          km += hav(trasa[i], trasa[i + 1]) * 1.30;
        }
        S.wynik = { dystans: km * 1000, czas: czas, linia: null,
                    przyblizone: true, powod: powod, legs: [], drogi: [] };
      }
      rysujTrase(); render();
    });
  }).catch(function (e) {
    console.error(e);
    S.wynik = null; render();
  }).then(function () {
    btn.disabled = S.stops.length < 2;
    etykieta.textContent = 'Wyznacz kolejność';
  });
}

/* ====================== drogi na trasie ====================== */

/* W Polsce autostrady to A1..A18, ekspresowe S1..S74, krajowe to sama liczba
   od 1 do 99. Trzycyfrowe numery to drogi wojewódzkie — te pomijamy. */
function klasaDrogi(ref) {
  if (/^A\d{1,2}$/.test(ref)) return 'A';
  if (/^S\d{1,2}$/.test(ref)) return 'S';
  if (/^(DK\s?)?\d{1,2}$/i.test(ref)) return 'DK';
  return null;
}

function drogiZTrasy(legs) {
  var kolejne = [];
  (legs || []).forEach(function (leg) {
    (leg.steps || []).forEach(function (st) {
      var ref = String(st.ref || '').split(';')[0].trim();
      if (!ref) return;
      var kl = klasaDrogi(ref);
      if (!kl) return;
      var etykieta = kl === 'DK' ? ('DK' + ref.replace(/^DK\s?/i, '')) : ref;
      var loc = st.maneuver && st.maneuver.location;

      var ost = kolejne[kolejne.length - 1];
      if (ost && ost.etykieta === etykieta) {
        ost.metry += st.distance || 0;
        if (loc) ost.punkty.push(loc);
      } else {
        kolejne.push({ etykieta: etykieta, klasa: kl, metry: st.distance || 0, punkty: loc ? [loc] : [] });
      }
    });
  });

  // krótkie wjazdy na drogę krajową tylko zaśmiecają mapę
  var istotne = kolejne.filter(function (d) { return d.metry >= 4000; });

  var wg = {};
  istotne.forEach(function (d) {
    if (!wg[d.etykieta]) wg[d.etykieta] = { etykieta: d.etykieta, klasa: d.klasa, metry: 0, odcinki: [] };
    wg[d.etykieta].metry += d.metry;
    wg[d.etykieta].odcinki.push(d.punkty);
  });

  return Object.keys(wg).map(function (k) { return wg[k]; })
    .sort(function (a, b) { return b.metry - a.metry; });
}

/* ====================== rysowanie trasy ====================== */

function rysujTrase() {
  if (liniaTrasy) { map.removeLayer(liniaTrasy); liniaTrasy = null; }
  markeryStopow.forEach(function (m) { map.removeLayer(m); });
  markeryDrog.forEach(function (m) { map.removeLayer(m); });
  markeryStopow = []; markeryDrog = [];

  if (S.wynik && S.wynik.linia) {
    liniaTrasy = L.polyline(S.wynik.linia, {
      pane: 'routePane', renderer: rendererTrasy,
      color: '#3A3E2C', weight: 4, opacity: 0.9, lineJoin: 'round', lineCap: 'round'
    }).addTo(map);
  } else if (S.stops.length > 1) {
    var pkt = S.stops.map(function (s) { return [s.lat, s.lng]; });
    if (S.mode === 'loop') pkt.push(pkt[0]);
    liniaTrasy = L.polyline(pkt, {
      pane: 'routePane', renderer: rendererTrasy,
      color: '#A09B81', weight: 2.5, opacity: 0.8, dashArray: '5,6'
    }).addTo(map);
  }

  if (S.wynik && S.wynik.drogi) {
    S.wynik.drogi.forEach(function (d) {
      d.odcinki.forEach(function (punkty) {
        if (!punkty.length) return;
        var p = punkty[Math.floor(punkty.length / 2)];    // środek odcinka
        // iconSize null => Leaflet nie narzuca wymiarów, etykieta rośnie do treści
        markeryDrog.push(L.marker([p[1], p[0]], {
          pane: 'roadsPane',
          icon: L.divIcon({
            className: 'road-icon',
            html: '<div class="road-pin ' + d.klasa + '">' + esc(d.etykieta) + '</div>',
            iconSize: null, iconAnchor: [0, 0]
          }),
          interactive: false, keyboard: false
        }).addTo(map));
      });
    });
  }

  S.stops.forEach(function (s, i) {
    var klasa = 'pin-num' + (i === S.stops.length - 1 && S.mode === 'ends' ? ' end' : '') +
                (s.prio ? ' prio' : '');
    var m = L.marker([s.lat, s.lng], {
      pane: 'stopsPane',
      icon: L.divIcon({ className: '', html: '<div class="' + klasa + '">' + (i + 1) + '</div>',
                        iconSize: [26, 26], iconAnchor: [13, 13] }),
      title: s.nazwa
    }).addTo(map);
    m.bindPopup('<div class="pop-t">' + esc(s.nazwa) + '</div><div class="pop-a">' + esc(s.opis || '') + '</div>');
    markeryStopow.push(m);
  });
}

/* ====================== Google Maps ====================== */

function punktGoogle(s) {
  return encodeURIComponent(s.zapytanie || (s.lat.toFixed(6) + ',' + s.lng.toFixed(6)));
}

/* Google przyjmuje najwyżej 10 punktów w jednym odnośniku, więc dłuższe trasy
   dzielimy na zazębiające się etapy: meta etapu jest startem następnego. */
function etapy(stops) {
  var lista = stops.slice();
  if (S.mode === 'loop' && lista.length > 1) lista.push(lista[0]);
  var krok = GM_WAYPOINTS + 1, out = [];
  for (var i = 0; i < lista.length - 1; i += krok) {
    var kawalek = lista.slice(i, Math.min(i + krok + 1, lista.length));
    if (kawalek.length > 1) out.push(kawalek);
  }
  return out;
}

function urlGoogle(kawalek) {
  var srodek = kawalek.slice(1, -1).map(punktGoogle).join('%7C');
  return 'https://www.google.com/maps/dir/?api=1' +
         '&origin=' + punktGoogle(kawalek[0]) +
         '&destination=' + punktGoogle(kawalek[kawalek.length - 1]) +
         (srodek ? '&waypoints=' + srodek : '') +
         '&travelmode=driving&dir_action=navigate';
}

/* href trzymamy gotowy w <a>. window.open po await bywa blokowane na telefonie. */
function odswiezGoogle() {
  var a = $('#btnGo'), sub = $('#goSub'), box = $('#segs');

  if (S.stops.length < 2) {
    a.className = 'go off'; a.removeAttribute('href');
    sub.textContent = 'dodaj co najmniej dwa przystanki';
    box.innerHTML = '';
    return;
  }

  var sg = etapy(S.stops);
  a.className = 'go';
  a.href = urlGoogle(sg[0]);
  sub.textContent = S.stops.length + ' ' + odm(S.stops.length, 'przystanek', 'przystanki', 'przystanków') +
                    (sg.length > 1 ? ' · etap 1 z ' + sg.length : '');

  if (sg.length < 2) { box.innerHTML = ''; return; }

  box.innerHTML = '<div class="eyebrow" style="margin:8px 0 4px">Etapy <span class="n">' + sg.length + '</span></div>' +
    sg.map(function (k, i) {
      return '<div class="sg">' +
        '<div class="sg-n">' + (i + 1) + '</div>' +
        '<div class="sg-b"><b>' + esc(k[0].krotko || k[0].nazwa) + ' → ' + esc(k[k.length - 1].krotko || k[k.length - 1].nazwa) + '</b>' +
        '<small>' + k.length + ' ' + odm(k.length, 'punkt', 'punkty', 'punktów') + '</small></div>' +
        '<a class="btn sm" href="' + urlGoogle(k) + '" target="_blank" rel="noopener">Otwórz</a>' +
        '<button class="ibtn" data-kopiuj="' + i + '" title="Kopiuj odnośnik">⧉</button>' +
      '</div>';
    }).join('');

  box.querySelectorAll('[data-kopiuj]').forEach(function (b) {
    b.onclick = function () {
      var url = urlGoogle(sg[+b.getAttribute('data-kopiuj')]);
      var done = function () { b.textContent = '✓'; setTimeout(function () { b.textContent = '⧉'; }, 1400); };
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, done);
      else window.prompt('Skopiuj odnośnik:', url);
    };
  });
}

/* ====================== render panelu ====================== */

function render() {
  $('#cntStops').textContent = S.stops.length;
  $('#cntStops2').textContent = S.stops.length;
  $('#emptyStops').style.display = S.stops.length ? 'none' : 'block';
  $('#btnOpt').disabled = S.stops.length < 2;
  $('#btnClear').disabled = !S.stops.length;
  $('#dragHint').style.display = S.stops.length > 1 ? 'block' : 'none';

  var ul = $('#stops');
  ul.innerHTML = S.stops.map(function (s, i) {
    if (S.edycja === s.id) return wierszEdycji(s, i);
    var meta = (S.mode === 'ends' && i === S.stops.length - 1 && S.stops.length > 1);
    var noga = (S.wynik && S.wynik.legs && i > 0) ? S.wynik.legs[i - 1] : null;
    return '<li class="stop' + (i === 0 ? ' is-start' : '') + (meta ? ' is-end' : '') +
             (s.prio ? ' is-prio' : '') + '" data-id="' + s.id + '">' +
      '<button class="drag" title="Przeciągnij, żeby zmienić kolejność" aria-label="Zmień kolejność">⠿</button>' +
      '<div class="stop-n">' + (i + 1) + '</div>' +
      '<div class="stop-text" data-edit="' + s.id + '" title="Kliknij, aby zmienić adres">' +
        '<div class="stop-name">' + esc(s.nazwa) + '</div>' +
        (s.opis ? '<div class="stop-addr">' + esc(s.opis) + '</div>' : '') +
        '<div class="stop-tags">' +
          (i === 0 ? '<span class="tag">start</span>' : '') +
          (meta ? '<span class="tag">meta</span>' : '') +
          (s.prio ? '<span class="tag prio">priorytet</span>' : '') +
          (noga ? '<span class="tag">' + (noga.distance / 1000).toFixed(0) + ' km · ' +
                  fmtMinPlain(noga.duration / 60) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="stop-act">' +
        '<button class="ibtn' + (s.prio ? ' on' : '') + '" data-prio="' + s.id + '" title="Priorytet" aria-label="Priorytet">★</button>' +
        '<button class="ibtn" data-del="' + s.id + '" title="Usuń" aria-label="Usuń">✕</button>' +
      '</div></li>';
  }).join('');

  ul.querySelectorAll('[data-prio]').forEach(function (b) { b.onclick = function () { przelaczPrio(b.getAttribute('data-prio')); }; });
  ul.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { usunStop(b.getAttribute('data-del')); }; });
  ul.querySelectorAll('[data-edit]').forEach(function (b) {
    b.onclick = function () { S.edycja = b.getAttribute('data-edit'); render(); zafokusujEdycje(); };
  });
  podepnijEdycje(ul);

  renderWynik();
  odswiezGoogle();
}

function wierszEdycji(s, i) {
  return '<li class="stop edit" data-id="' + s.id + '">' +
    '<div class="stop-n">' + (i + 1) + '</div>' +
    '<div class="stop-edit">' +
      '<input class="inp" data-adres="' + s.id + '" value="' + esc(s.zapytanie || s.opis || s.nazwa) + '" ' +
        'enterkeyhint="search" autocomplete="off">' +
      '<div class="row">' +
        '<button class="btn sm primary" data-find="' + s.id + '">Szukaj adresu</button>' +
        '<button class="btn sm" data-cancel="' + s.id + '">Anuluj</button>' +
        '<span class="stat" data-status="' + s.id + '"></span>' +
      '</div>' +
    '</div></li>';
}

function podepnijEdycje(ul) {
  ul.querySelectorAll('[data-find]').forEach(function (b) {
    var id = b.getAttribute('data-find');
    b.onclick = function () {
      var inp = ul.querySelector('[data-adres="' + id + '"]');
      szukajAdresu(id, inp ? inp.value : '');
    };
  });
  ul.querySelectorAll('[data-cancel]').forEach(function (b) {
    b.onclick = function () { S.edycja = null; render(); };
  });
  ul.querySelectorAll('[data-adres]').forEach(function (inp) {
    inp.onkeydown = function (e) {
      if (e.key === 'Enter') { e.preventDefault(); szukajAdresu(inp.getAttribute('data-adres'), inp.value); }
      if (e.key === 'Escape') { S.edycja = null; render(); }
    };
  });
}

function zafokusujEdycje() {
  var inp = $('#stops [data-adres]');
  if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}

function renderWynik() {
  var strip = $('#resStrip');
  if (!S.wynik) { strip.hidden = true; return; }
  strip.hidden = false;

  var km = S.wynik.dystans / 1000;
  var jazda = S.wynik.czas / 60;
  var prefiks = S.wynik.przyblizone ? '~' : '';

  $('#rsDist').textContent = prefiks + km.toFixed(0) + ' km';
  $('#rsTime').textContent = prefiks + fmtMinPlain(S.wynik.przyblizone ? Math.round(jazda / 15) * 15 : jazda);

  var drogi = S.wynik.drogi || [];
  $('#rsRoads').innerHTML = drogi.slice(0, 4).map(function (d) {
    return '<span class="shield ' + d.klasa + '" title="' + (d.metry / 1000).toFixed(0) + ' km">' + esc(d.etykieta) + '</span>';
  }).join('');

  var note = $('#rsNote');
  if (S.wynik.przyblizone) {
    note.className = 'rs-note warn';
    note.textContent = S.wynik.powod === 'limit'
      ? 'Powyżej ' + MAX_OSRM + ' przystanków serwer tras odmawia — to szacunek z linii prostej.'
      : 'Serwer tras nie odpowiedział — to szacunek z linii prostej.';
  } else {
    note.className = 'rs-note';
    note.textContent = S.stops.length + ' ' + odm(S.stops.length, 'przystanek', 'przystanki', 'przystanków') +
      ' · szacunek OSRM, bez ruchu drogowego';
  }
}

/* ====================== przeciąganie kolejności ====================== */

function wlaczPrzeciaganie(ul) {
  var li = null, poczY = 0;

  function podKursorem(y) {
    var wynik = null;
    Array.prototype.forEach.call(ul.children, function (c) {
      if (c === li) return;
      var r = c.getBoundingClientRect();
      if (y > r.top + r.height / 2) wynik = c;
    });
    return wynik;   // ostatni element, którego środek minął kursor
  }

  ul.addEventListener('pointerdown', function (e) {
    var uchwyt = e.target.closest && e.target.closest('.drag');
    if (!uchwyt) return;
    li = uchwyt.closest('.stop');
    if (!li) return;
    e.preventDefault();
    poczY = e.clientY;
    li.classList.add('lift');
    try { uchwyt.setPointerCapture(e.pointerId); } catch (err) {}
  });

  ul.addEventListener('pointermove', function (e) {
    if (!li) return;
    li.style.transform = 'translateY(' + (e.clientY - poczY) + 'px)';
    var po = podKursorem(e.clientY);
    var trzeba = po ? (po.nextSibling !== li) : (ul.firstChild !== li);
    if (trzeba) {
      ul.insertBefore(li, po ? po.nextSibling : ul.firstChild);
      poczY = e.clientY;
      li.style.transform = '';
    }
  });

  function koniec() {
    if (!li) return;
    li.style.transform = '';
    li.classList.remove('lift');
    li = null;
    zastosujKolejnoscZDOM(ul);
  }

  ul.addEventListener('pointerup', koniec);
  ul.addEventListener('pointercancel', koniec);

  // klawiatura: uchwyt reaguje na strzałki, żeby dało się przestawić bez myszy
  ul.addEventListener('keydown', function (e) {
    var uchwyt = e.target.closest && e.target.closest('.drag');
    if (!uchwyt || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    var id = uchwyt.closest('.stop').getAttribute('data-id');
    var i = S.stops.findIndex(function (s) { return s.id === id; });
    e.preventDefault();
    przestaw(i, i + (e.key === 'ArrowUp' ? -1 : 1));
    var nowy = ul.querySelector('[data-id="' + id + '"] .drag');
    if (nowy) nowy.focus();
  });
}

function zastosujKolejnoscZDOM(ul) {
  var kolejnosc = Array.prototype.map.call(ul.children, function (c) { return c.getAttribute('data-id'); });
  var bezZmian = S.stops.every(function (s, i) { return s.id === kolejnosc[i]; });
  if (bezZmian) return;
  S.stops.sort(function (a, b) { return kolejnosc.indexOf(a.id) - kolejnosc.indexOf(b.id); });
  S.wynik = null;
  rysujTrase(); render();
}

/* ====================== wyszukiwarka ====================== */

/* Jedno pole na gminy i powiaty. Gminy idą wyżej, bo to one są jednostką
   pracy — powiat służy głównie za widok z lotu ptaka. */
function szukaj(q) {
  var box = $('#qres');
  var n = norm(q);
  if (n.length < 2) { box.innerHTML = ''; return; }

  var pula = ZBIORY.powiaty.idx.concat(ZBIORY.gminy.idx);
  var trafienia = pula.filter(function (p) { return p.n.indexOf(n) >= 0; });

  trafienia.sort(function (a, b) {
    var pa = a.nn.indexOf(n) === 0 ? 0 : 1, pb = b.nn.indexOf(n) === 0 ? 0 : 1;
    if (pa !== pb) return pa - pb;
    var ta = a.typ === 'gmina' ? 0 : 1, tb = b.typ === 'gmina' ? 0 : 1;
    if (ta !== tb) return ta - tb;
    return a.nazwa.localeCompare(b.nazwa, 'pl');
  });

  if (!trafienia.length) {
    box.innerHTML = '<p class="muted" style="padding:8px 4px">' +
      (ZBIORY.gminy.gotowy ? 'Nic nie pasuje.' : 'Nic nie pasuje wśród powiatów. Gminy jeszcze się wczytują…') +
      '</p>';
    return;
  }

  box.innerHTML = trafienia.slice(0, 40).map(function (p) {
    var pod = p.typ === 'gmina' ? (p.powiat + ' · ' + p.sprzedawca)
                                : (p.woj + ' · ' + p.miasto + ' · ' + p.sprzedawca);
    return '<div class="ri" data-kod="' + esc(p.kod) + '">' +
      '<div class="dot" style="background:' + barwa(p.sprzedawca) + '"></div>' +
      '<div class="t"><b>' + esc(p.typ === 'gmina' ? p.nazwa : p.nazwa) + '</b><small>' + esc(pod) + '</small></div>' +
      '<span class="kind' + (p.typ === 'gmina' ? ' g' : '') + '">' + (p.typ === 'gmina' ? 'gmina' : 'powiat') + '</span>' +
      '</div>';
  }).join('');

  box.querySelectorAll('[data-kod]').forEach(function (el) {
    el.onclick = function () {
      var j = jednostkaPoKodzie(el.getAttribute('data-kod'));
      if (!j) return;
      if (dodajJednostke(j)) {
        el.querySelector('.kind').textContent = 'dodano';
      }
      map.setView([j.uLat, j.uLng], Math.max(map.getZoom(), j.typ === 'gmina' ? 10 : 9));
    };
  });
}

/* ====================== zapisane trasy ====================== */

function wczytajZapisane() {
  try { return JSON.parse(store.get(KEY_ROUTES) || '[]'); } catch (e) { return []; }
}

function zapiszWszystkie(arr) { store.set(KEY_ROUTES, JSON.stringify(arr)); }

function renderZapisane() {
  var arr = wczytajZapisane();
  $('#savedCnt').textContent = arr.length;
  var box = $('#savedList');
  if (!arr.length) { box.innerHTML = '<p class="muted">Brak zapisanych tras.</p>'; return; }

  box.innerHTML = arr.map(function (t, i) {
    return '<div class="saved"><div class="t"><b>' + esc(t.nazwa) + '</b>' +
      '<small class="tiny">' + t.stops.length + ' ' + odm(t.stops.length, 'przystanek', 'przystanki', 'przystanków') +
      ' · ' + new Date(t.ts).toLocaleDateString('pl-PL') + '</small></div>' +
      '<button class="btn sm" data-load="' + i + '">Wczytaj</button>' +
      '<button class="ibtn" data-drop="' + i + '" title="Usuń" aria-label="Usuń">✕</button></div>';
  }).join('');

  box.querySelectorAll('[data-load]').forEach(function (b) {
    b.onclick = function () {
      var t = wczytajZapisane()[+b.getAttribute('data-load')];
      if (!t) return;
      S.mode = t.tryb || 'loop';
      S.stops = t.stops.map(function (s) { s.id = 's' + (seq++); return s; });
      S.wynik = null; S.edycja = null;
      ustawTryb(S.mode, true);
      pokazStrone('pgRoute'); rysujTrase(); render(); dopasujWidok();
    };
  });

  box.querySelectorAll('[data-drop]').forEach(function (b) {
    b.onclick = function () {
      if (!confirm('Usunąć tę trasę na stałe?')) return;
      var arr2 = wczytajZapisane();
      arr2.splice(+b.getAttribute('data-drop'), 1);
      zapiszWszystkie(arr2); renderZapisane();
    };
  });
}

function dopasujWidok() {
  if (!S.stops.length) return;
  var b = L.latLngBounds(S.stops.map(function (s) { return [s.lat, s.lng]; }));
  map.fitBounds(b.pad(0.15));
}

/* ====================== import ====================== */

var doWeryfikacji = [];

function pokazWeryfikacje(linie) {
  doWeryfikacji = linie.map(function (a, i) {
    return { id: 'v' + i, wpis: a, nazwa: a, lat: null, lng: null, stan: 'czeka' };
  });

  $('#verifyCard').style.display = '';
  $('#vCnt').textContent = doWeryfikacji.length;

  $('#verifyBox').innerHTML = '<table class="vt"><thead><tr><th style="width:16px"></th><th>Adres</th><th style="width:82px">Stan</th></tr></thead><tbody>' +
    doWeryfikacji.map(function (r) {
      return '<tr id="row-' + r.id + '"><td><span class="vs wait"></span></td>' +
        '<td><input value="' + esc(r.wpis) + '" data-id="' + r.id + '"></td>' +
        '<td id="st-' + r.id + '" class="tiny">szukam…</td></tr>';
    }).join('') + '</tbody></table>';

  $('#verifyBox').querySelectorAll('input[data-id]').forEach(function (inp) {
    inp.onchange = function () {
      var r = doWeryfikacji.find(function (x) { return x.id === inp.getAttribute('data-id'); });
      if (r) { r.wpis = inp.value; r.stan = 'czeka'; geokoduj(r); }
    };
  });

  (function kolejno(i) {
    if (i >= doWeryfikacji.length) return;
    geokoduj(doWeryfikacji[i]).then(function () {
      return sleep(1100);           // Nominatim: najwyżej 1 zapytanie na sekundę
    }).then(function () { kolejno(i + 1); });
  })(0);
}

function geokoduj(r) {
  var st = document.getElementById('st-' + r.id);
  var row = document.getElementById('row-' + r.id);
  if (st) st.textContent = 'szukam…';

  return fetch(NOMINATIM + '/search?format=jsonv2&limit=1&countrycodes=pl&q=' + encodeURIComponent(r.wpis))
    .then(function (x) { return x.json(); })
    .then(function (res) {
      if (res && res.length) {
        r.lat = parseFloat(res[0].lat); r.lng = parseFloat(res[0].lon);
        r.nazwa = res[0].display_name.split(',').slice(0, 2).join(', ');
        r.stan = 'ok';
        if (st) st.innerHTML = 'znaleziono';
        if (row) { row.className = 'ok'; row.querySelector('.vs').className = 'vs ok'; }
      } else {
        r.stan = 'blad';
        if (st) st.innerHTML = 'brak wyniku';
        if (row) { row.className = 'err'; row.querySelector('.vs').className = 'vs err'; }
      }
    })
    .catch(function () {
      r.stan = 'blad';
      if (st) st.innerHTML = 'błąd sieci';
      if (row) { row.className = 'err'; row.querySelector('.vs').className = 'vs err'; }
    });
}

var tess = null;
function initTess() {
  if (tess) return Promise.resolve(tess);
  return new Promise(function (res, rej) {
    if (window.Tesseract) return res(window.Tesseract);
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    s.onload = function () { res(window.Tesseract); };
    s.onerror = function () { rej(new Error('Nie udało się wczytać biblioteki OCR.')); };
    document.head.appendChild(s);
  }).then(function (T) { return T.createWorker(['pol', 'eng']); })
    .then(function (w) { tess = w; return w; });
}

/* ====================== zakładki i tryby ====================== */

function pokazStrone(id) {
  $$('.page').forEach(function (p) { p.classList.toggle('on', p.id === id); });
  $$('.tab').forEach(function (t) { t.classList.toggle('on', t.getAttribute('data-page') === id); });
  if (id === 'pgSaved') renderZapisane();
}

var OPISY_TRYBU = {
  loop: 'Wracasz tam, skąd wyjechałeś.',
  ends: 'Ostatni przystanek na liście jest metą.',
  open: 'Kończysz tam, gdzie wypada najszybciej.'
};

function ustawTryb(tryb, cicho) {
  S.mode = tryb;
  $$('#modeSeg .mode').forEach(function (b) {
    var on = b.getAttribute('data-mode') === tryb;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  $('#modeHint').textContent = OPISY_TRYBU[tryb] || '';
  if (!cicho) { S.wynik = null; zapiszUstawienia(); rysujTrase(); render(); }
}

/* ====================== ustawienia ====================== */

function zapiszUstawienia() {
  store.set(KEY_PREFS, JSON.stringify({ mode: S.mode, podklad: S.podklad, twarze: S.twarze }));
}

function wczytajUstawienia() {
  try {
    var p = JSON.parse(store.get(KEY_PREFS) || '{}');
    if (p.mode) S.mode = p.mode;
    if (p.podklad) S.podklad = p.podklad;
    if (typeof p.twarze === 'boolean') S.twarze = p.twarze;
  } catch (e) {}
}

/* ====================== podłączenie zdarzeń ====================== */

function podlacz() {
  $$('.tab').forEach(function (t) {
    t.onclick = function () { pokazStrone(t.getAttribute('data-page')); };
  });

  $$('#modeSeg .mode').forEach(function (b) {
    b.onclick = function () { ustawTryb(b.getAttribute('data-mode')); };
  });

  $('#twarzeBtn').onclick = function () {
    S.twarze = !S.twarze;
    aktualizujTwarzeBtn();
    odswiezTwarze();
    zapiszUstawienia();
    if (S.twarze && map.getZoom() > ZOOM_TWARZE_MAX) {
      pokazPodpowiedz('Twarze widać w widoku przeglądowym — oddal mapę.', 3000);
    }
  };

  $('#baseBtn').onclick = function () { pokazWyborPodkladu(true); };
  document.addEventListener('click', function (e) {
    if ($('#basePanel').hidden) return;
    if (e.target.closest && (e.target.closest('#basePanel') || e.target.closest('#baseBtn'))) return;
    pokazWyborPodkladu(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('#basePanel').hidden) pokazWyborPodkladu(false);
  });

  $('#btnOpt').onclick = optymalizuj;

  $('#btnClear').onclick = function () {
    if (!S.stops.length) return;
    if (!confirm('Usunąć wszystkie ' + S.stops.length + ' przystanków?')) return;
    S.stops = []; S.wynik = null; S.edycja = null; rysujTrase(); render();
  };

  $('#q').oninput = function () { szukaj(this.value); };

  $('#btnGeo').onclick = function () {
    if (!navigator.geolocation) return alert('Przeglądarka nie udostępnia lokalizacji.');
    var b = $('#btnGeo'), tekst = b.textContent;
    b.disabled = true; b.textContent = 'Szukam…';
    navigator.geolocation.getCurrentPosition(function (pos) {
      S.stops.unshift({
        id: 's' + (seq++), nazwa: 'Moja lokalizacja', opis: 'punkt startowy',
        lat: pos.coords.latitude, lng: pos.coords.longitude,
        zapytanie: null, krotko: 'Start', prio: false
      });
      S.wynik = null; rysujTrase(); render();
      b.disabled = false; b.textContent = tekst;
      map.setView([pos.coords.latitude, pos.coords.longitude], 10);
      pokazStrone('pgRoute');
    }, function () {
      alert('Nie udało się ustalić lokalizacji. Na stronie bez HTTPS geolokalizacja jest zablokowana.');
      b.disabled = false; b.textContent = tekst;
    }, { enableHighAccuracy: true, timeout: 10000 });
  };

  $('#btnSave').onclick = function () {
    if (!S.stops.length) return alert('Najpierw dodaj przystanki.');
    var nazwa = ($('#saveName').value || '').trim() || ('Trasa ' + new Date().toLocaleDateString('pl-PL'));
    var arr = wczytajZapisane();
    // zapisujemy tylko wejście: nazwy, współrzędne, priorytety, tryb
    arr.unshift({
      nazwa: nazwa, tryb: S.mode, ts: Date.now(),
      stops: S.stops.map(function (s) {
        return { kod: s.kod, nazwa: s.nazwa, opis: s.opis, lat: s.lat, lng: s.lng,
                 zapytanie: s.zapytanie, krotko: s.krotko, prio: !!s.prio,
                 strona: s.strona, stronaEtykieta: s.stronaEtykieta };
      })
    });
    zapiszWszystkie(arr.slice(0, 50));
    $('#saveName').value = '';
    renderZapisane();
    $('#storeHint').textContent = 'Zapisano „' + nazwa + '”.';
  };

  $('#btnList').onclick = function () {
    var linie = ($('#listIn').value || '').split('\n')
      .map(function (l) { return l.trim(); })
      .filter(function (l) { return l.length > 2; });
    if (!linie.length) return alert('Wpisz choć jeden adres.');
    pokazWeryfikacje(linie);
  };

  $('#btnOCR').onclick = function () { $('#photo').click(); };

  $('#photo').onchange = function (e) {
    var plik = e.target.files && e.target.files[0];
    if (!plik) return;
    var b = $('#btnOCR'); b.disabled = true; b.textContent = 'Wczytuję bibliotekę…';

    initTess().then(function (w) {
      b.textContent = 'Czytam tekst…';
      return w.recognize(plik);
    }).then(function (out) {
      var linie = out.data.text.split('\n')
        .map(function (l) { return l.trim(); })
        .filter(function (l) { return l.length > 3; });
      if (!linie.length) alert('Nic nie udało się odczytać. Spróbuj wyraźniejszego zdjęcia.');
      else pokazWeryfikacje(linie);
    }).catch(function (err) {
      alert('Rozpoznawanie tekstu nie zadziałało: ' + err.message);
    }).then(function () {
      b.disabled = false; b.textContent = 'Odczytaj adresy z obrazu';
      e.target.value = '';
    });
  };

  $('#btnAddVerified').onclick = function () {
    var ile = 0;
    doWeryfikacji.filter(function (r) { return r.stan === 'ok'; }).forEach(function (r) {
      dodajStop({ nazwa: r.nazwa, opis: r.wpis, lat: r.lat, lng: r.lng,
                  zapytanie: r.wpis, krotko: r.nazwa.split(',')[0] });
      ile++;
    });
    if (!ile) return alert('Nie ma czego dodać — żaden adres nie został odnaleziony.');
    $('#verifyCard').style.display = 'none';
    doWeryfikacji = [];
    pokazStrone('pgRoute');
    dopasujWidok();
  };

  $('#handle').onclick = function () {
    $('#panel').classList.toggle('min');
    setTimeout(function () { map.invalidateSize(); }, 220);
  };

  window.addEventListener('resize', function () { map.invalidateSize(); });

  wlaczPrzeciaganie($('#stops'));
}

/* ====================== start ====================== */

function start() {
  wczytajUstawienia();
  initDane();
  initMapa();
  rysujWyborPodkladu();
  rysujLegende();
  podlacz();
  ustawTryb(S.mode, true);
  aktualizujTwarzeBtn();
  odswiezTwarze();

  $('#storeHint').textContent = store.trwaly
    ? 'Trasy zostają w tej przeglądarce.'
    : 'Uwaga: przeglądarka blokuje trwały zapis, trasy znikną po odświeżeniu.';

  renderZapisane();
  render();

  // Gminy dociągamy w tle zaraz po starcie: wyszukiwarka ma je mieć,
  // zanim ktokolwiek zdąży wpisać drugą literę.
  wczytajGminy().then(function () {
    if ($('#q').value) szukaj($('#q').value);
    zbudujWojewodztwa();   // gdyby data/wojewodztwa.js nie wszedł, WOJ_DB jest też w gminy.js
    odswiezWarstwy();
  }).catch(function (e) {
    console.warn(e);
    pokazPodpowiedz('Nie udało się wczytać gmin — zostają powiaty.', 5000);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();

})();
