#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Buduje data/powiaty.js z plikow zrodlowych w src/.

Wejscie:
  src/sprzedawcy.csv    Kod,Nazwa,Wojewodztwo,Sprzedawca,Status
  src/powiaty.geojson   granice powiatow (MultiPolygon, WGS84)
  data/siedziby.json    siedziby powiatow (generowane raz, patrz --odswiez-siedziby)

Wyjscie:
  data/powiaty.js       window.POWIATY_DB
  data/raport.txt       raport kontroli jakosci

Uzycie:
  python3 tools/build_data.py
  python3 tools/build_data.py --odswiez-siedziby   # pobiera PRNG z GitHuba i przelicza siedziby
"""

import csv
import io
import json
import os
import re
import sys
import unicodedata
from collections import defaultdict

try:
    from shapely.geometry import shape, Point, mapping
    from shapely.ops import unary_union
except ImportError:
    sys.exit("Brak shapely. Zainstaluj: pip install -r tools/requirements.txt")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')
DATA = os.path.join(ROOT, 'data')

# Tolerancja upraszczania geometrii w stopniach. 0.0012 ~ 130 m.
# Przy zoomie krajowym roznica jest niewidoczna, plik chudnie o ~35%.
TOLERANCJA = 0.0012

# Zrodlo wspolrzednych miejscowosci: PRNG (Panstwowy Rejestr Nazw Geograficznych)
PRNG_URL = 'https://raw.githubusercontent.com/jjbartek/polskie-miejscowosci/main/data.json'

# Granice gmin i wojewodztw (public domain, GUGiK przez gis-support)
GMINY_URL = 'https://raw.githubusercontent.com/jusuff/PolandGeoJson/main/data/poland.municipalities.json'
WOJ_URL = 'https://raw.githubusercontent.com/jusuff/PolandGeoJson/main/data/poland.voivodeships.json'

# Nazwa urzedu wg ostatniej cyfry kodu TERYT gminy
TYP_GMINY = {'1': 'Urząd Miasta', '2': 'Urząd Gminy', '3': 'Urząd Miasta i Gminy'}

# --------------------------------------------------------------------------
# Poprawki danych zrodlowych
# --------------------------------------------------------------------------

# GeoJSON ma obiekt bez kodu TERYT
BRAK_KODU = {'powiat Gdańsk': '2261'}

# Literowki w nazwach wojewodztw w GeoJSON
WOJ_FIX = {'mazowiecki': 'mazowieckie'}

# Powiaty, dla ktorych automatyczne dopasowanie siedziby zawodzi.
# Kazdy sprawdzony recznie. Kod TERYT -> nazwa miasta bedacego siedziba.
WYJATKI_SIEDZIB = {
    '0206': 'Jelenia Góra',        # karkonoski, siedziba poza powiatem
    '0609': 'Lublin',              # lubelski, siedziba poza powiatem
    '0804': 'Nowa Sól',            # nowosolski
    '1210': 'Nowy Sącz',           # nowosądecki, siedziba poza powiatem
    '1217': 'Zakopane',            # tatrzański
    '1432': 'Ożarów Mazowiecki',   # warszawski zachodni
    '1801': 'Ustrzyki Dolne',      # bieszczadzki
    '2204': 'Pruszcz Gdański',     # gdański
    '2814': 'Olsztyn',             # olsztyński, siedziba poza powiatem
    '3025': 'Środa Wielkopolska',  # średzki (wielkopolskie)
}


def norm(s):
    """Do porownan: bez ogonkow, malymi literami. 'l' NIE rozklada sie w NFD."""
    s = (s or '').replace('ł', 'l').replace('Ł', 'L')
    s = unicodedata.normalize('NFD', s)
    return ''.join(c for c in s if unicodedata.category(c) != 'Mn').lower().strip()


# --------------------------------------------------------------------------
# 1. CSV
# --------------------------------------------------------------------------

def wczytaj_csv():
    path = os.path.join(SRC, 'sprzedawcy.csv')
    rows = []
    with io.open(path, encoding='utf-8-sig', newline='') as f:
        for r in csv.DictReader(f):
            kod = (r.get('Kod') or '').strip()
            if not kod.isdigit():
                continue          # powtorzony wiersz naglowka w srodku pliku
            rows.append({
                'kod': kod.zfill(4),
                'nazwa': (r.get('Nazwa') or '').strip(),
                'woj': (r.get('Wojewodztwo') or '').strip(),
                'sprzedawca': (r.get('Sprzedawca') or 'nikt').strip() or 'nikt',
                'status': (r.get('Status') or '').strip(),
            })
    print('CSV: %d powiatow' % len(rows))
    return rows


# --------------------------------------------------------------------------
# 2. GeoJSON: scalenie duplikatow, uzupelnienie kodow, uproszczenie
# --------------------------------------------------------------------------

def wczytaj_geojson():
    path = os.path.join(SRC, 'powiaty.geojson')
    gj = json.load(io.open(path, encoding='utf-8'))

    scalone = defaultdict(lambda: {'nazwa': None, 'woj': None, 'geoms': []})
    bez_kodu = pustych = 0

    for f in gj['features']:
        p = f['properties']
        kod = p.get('KOD')
        nazwa = (p.get('Nazwa') or '').strip()
        woj = (p.get('Województwo') or '').strip()
        woj = WOJ_FIX.get(woj, woj)

        if not kod:
            kod = BRAK_KODU.get(nazwa)
            bez_kodu += 1
            if not kod:
                print('  UWAGA: obiekt bez kodu i bez poprawki: %s' % nazwa)
                continue

        g = f.get('geometry') or {}
        if not g.get('coordinates'):
            pustych += 1
            continue

        kod = str(kod).zfill(4)
        rec = scalone[kod]
        rec['nazwa'] = rec['nazwa'] or nazwa
        rec['woj'] = rec['woj'] or woj
        rec['geoms'].append(shape(g))

    print('GeoJSON: %d obiektow -> %d powiatow (uzupelniono kodow: %d, pominieto pustych: %d)'
          % (len(gj['features']), len(scalone), bez_kodu, pustych))

    out = {}
    odrzucone = 0
    for kod, rec in scalone.items():
        g, n = polacz_czesci(rec['geoms'])
        odrzucone += n
        g = g.buffer(0)                                  # naprawa samoprzecinajacych sie pierscieni
        gs = g.simplify(TOLERANCJA, preserve_topology=True)
        if gs.is_empty or not gs.is_valid:
            gs = g
        out[kod] = {'nazwa': rec['nazwa'], 'woj': rec['woj'], 'geom': gs}
    if odrzucone:
        print('  odrzucono %d nadmiarowych wielokatow (miasta wklejone w dziury powiatow)' % odrzucone)
    return out


def polacz_czesci(geoms):
    """Laczy obiekty o tym samym kodzie TERYT.

    Plik zrodlowy zapisuje powiaty otaczajace miasto na prawach powiatu jako
    dwa obiekty z tym samym kodem: wlasciwy powiat (juz z dziura) oraz sam
    wielokat miasta. Zwykly unary_union zalepilby dziure i powiat nachodzilby
    na sasiednie miasto. Dlatego nadmiarowe wielokaty, ktore mieszcza sie w
    obrysie zewnetrznym najwiekszej czesci, sa odrzucane."""
    if len(geoms) == 1:
        return geoms[0], 0

    czesci = sorted(geoms, key=lambda g: -g.area)
    baza = czesci[0]
    obrys = zalep_dziury(baza)

    zachowane, odrzucone = [baza], 0
    for g in czesci[1:]:
        if obrys.contains(g.buffer(-1e-9)) or g.intersection(obrys).area > 0.5 * g.area:
            odrzucone += 1
        else:
            zachowane.append(g)
    return (unary_union(zachowane) if len(zachowane) > 1 else zachowane[0]), odrzucone


def zalep_dziury(g):
    from shapely.geometry import Polygon, MultiPolygon
    polys = g.geoms if g.geom_type == 'MultiPolygon' else [g]
    return unary_union([Polygon(p.exterior) for p in polys])


def punkt_etykiety(geom):
    """Punkt pod podpis: zawsze wewnatrz wielokata.

    Centroid powiatu w ksztalcie podkowy wypada w dziurze, wiec uzywamy go
    tylko wtedy, gdy naprawde lezy w srodku."""
    g = geom
    if g.geom_type == 'MultiPolygon':
        g = max(g.geoms, key=lambda x: x.area)
    c = g.centroid
    if g.contains(c):
        return round(c.y, 5), round(c.x, 5)
    p = g.representative_point()
    return round(p.y, 5), round(p.x, 5)


# --------------------------------------------------------------------------
# 3. Siedziby powiatow
# --------------------------------------------------------------------------

def rdzen(przym):
    """Ucina koncowke przymiotnika: 'zywiecki' -> 'zywiec'."""
    for suf in ('owski', 'ewski', 'inski', 'ynski', 'anski', 'enski',
                'icki', 'ecki', 'acki', 'ucki', 'ski', 'cki', 'zki', 'ki'):
        if przym.endswith(suf):
            return przym[:-len(suf)]
    return przym


def wspolny_prefiks(a, b):
    n = 0
    for x, y in zip(a, b):
        if x != y:
            break
        n += 1
    return n


def przelicz_siedziby(rows):
    """Dopasowuje siedzibe do kazdego powiatu na podstawie PRNG.

    Zasada: siedziba to miasto, ktorego nazwa najlepiej pasuje do rdzenia
    przymiotnika w nazwie powiatu. Najpierw szukamy w obrebie powiatu,
    a gdy nie ma trafienia - w calym wojewodztwie (to lapie przypadki, w
    ktorych siedziba lezy w miescie na prawach powiatu, np. powiat poznanski
    -> Poznan)."""
    import urllib.request

    print('Pobieram PRNG (~8 MB)...')
    with urllib.request.urlopen(PRNG_URL) as r:
        prng = json.loads(r.read().decode('utf-8'))
    miasta = [x for x in prng if x['Type'] == 'city']
    print('  miast w rejestrze: %d' % len(miasta))

    wg_powiatu = defaultdict(list)
    wg_woj = defaultdict(list)
    for m in miasta:
        wg_powiatu[(norm(m['District']), norm(m['Province']))].append(m)
        wg_woj[norm(m['Province'])].append(m)

    def najlepsze(kandydaci, rd):
        if not kandydaci:
            return 0, None
        return max(((wspolny_prefiks(norm(m['Name']), rd), m) for m in kandydaci),
                   key=lambda t: t[0])

    wynik = {}
    for r in rows:
        nazwa, woj = r['nazwa'], norm(r['woj'])
        reszta = nazwa[7:] if nazwa.startswith('powiat ') else nazwa
        reszta = re.sub(r'\s*\([^)]*\)\s*$', '', reszta).strip()

        # miasto na prawach powiatu: 'powiat Torun'
        grodzki = reszta[:1].isupper()

        if r['kod'] in WYJATKI_SIEDZIB:
            szukana = WYJATKI_SIEDZIB[r['kod']]
            kand = [m for m in miasta if m['Name'] == szukana]
            m, pewnosc = (kand[0] if kand else None), 'wyjatek'
        elif grodzki:
            kand = [m for m in wg_woj[woj] if norm(m['Name']) == norm(reszta)] \
                or [m for m in miasta if norm(m['Name']) == norm(reszta)]
            m, pewnosc = (kand[0] if kand else None), 'grodzki'
        else:
            rd = rdzen(norm(reszta))
            sc, m = najlepsze(wg_powiatu[(norm(reszta), woj)], rd)
            pewnosc = 'powiat'
            if sc < 4:
                sc2, m2 = najlepsze(wg_woj[woj], rd)
                if sc2 > sc:
                    m, pewnosc = m2, 'wojewodztwo'

        if not m:
            print('  BLAD: brak siedziby dla %s (%s)' % (nazwa, r['kod']))
            continue

        wynik[r['kod']] = {
            'miasto': m['Name'],
            'lat': round(m['Latitude'], 5),
            'lng': round(m['Longitude'], 5),
            'urzad': ('Urząd Miasta' if grodzki else 'Starostwo Powiatowe'),
            'zrodlo': pewnosc,
        }

    path = os.path.join(DATA, 'siedziby.json')
    with io.open(path, 'w', encoding='utf-8') as f:
        json.dump(wynik, f, ensure_ascii=False, indent=1, sort_keys=True)
    print('  zapisano %s (%d pozycji)' % (path, len(wynik)))
    return wynik


def wczytaj_siedziby():
    path = os.path.join(DATA, 'siedziby.json')
    if not os.path.exists(path):
        sys.exit('Brak data/siedziby.json. Uruchom: python3 tools/build_data.py --odswiez-siedziby')
    return json.load(io.open(path, encoding='utf-8'))


# --------------------------------------------------------------------------
# 4. Kontrola jakosci
# --------------------------------------------------------------------------

def kontrola(rows, geo, siedziby):
    linie = []
    poza = zadaleko = brak_geo = 0

    for r in rows:
        kod = r['kod']
        s = siedziby.get(kod)
        g = geo.get(kod)
        if not g:
            linie.append('BRAK_GEOMETRII  %s  %s' % (kod, r['nazwa']))
            brak_geo += 1
            continue
        if not s:
            linie.append('BRAK_SIEDZIBY   %s  %s' % (kod, r['nazwa']))
            continue

        pt = Point(s['lng'], s['lat'])
        if not g['geom'].contains(pt):
            d_km = g['geom'].distance(pt) * 111.0
            poza += 1
            tag = 'ZA_DALEKO' if d_km > 35 else 'POZA_GRANICA'
            if d_km > 35:
                zadaleko += 1
            linie.append('%-14s %s  %-34s -> %-24s %5.1f km' %
                         (tag, kod, r['nazwa'], s['miasto'], d_km))

    naglowek = [
        'RAPORT KONTROLI DANYCH',
        '',
        'Powiatow w CSV:            %d' % len(rows),
        'Powiatow z geometria:      %d' % sum(1 for r in rows if r['kod'] in geo),
        'Powiatow z siedziba:       %d' % sum(1 for r in rows if r['kod'] in siedziby),
        'Siedziba poza granica:     %d  (oczekiwane ~44: siedziba w miescie na prawach powiatu)' % poza,
        'Siedziba dalej niz 35 km:  %d  (oczekiwane 0)' % zadaleko,
        'Brak geometrii:            %d  (oczekiwane 0)' % brak_geo,
        '',
        '-' * 78,
        '',
    ]
    tekst = '\n'.join(naglowek + sorted(linie)) + '\n'
    with io.open(os.path.join(DATA, 'raport.txt'), 'w', encoding='utf-8') as f:
        f.write(tekst)
    print('\n'.join(naglowek[:9]))
    return zadaleko == 0 and brak_geo == 0


# --------------------------------------------------------------------------
# 5. Zapis data/powiaty.js
# --------------------------------------------------------------------------

def zaokragl(obj, nd=4):
    if isinstance(obj, float):
        return round(obj, nd)
    if isinstance(obj, (list, tuple)):
        return [zaokragl(x, nd) for x in obj]
    return obj


def zapisz(rows, geo, siedziby):
    features, centers = [], []

    for r in sorted(rows, key=lambda x: x['kod']):
        kod = r['kod']
        g = geo.get(kod)
        s = siedziby.get(kod)
        if not g or not s:
            continue

        lat, lng = punkt_etykiety(g['geom'])
        gm = mapping(g['geom'])
        coords = gm['coordinates'] if gm['type'] == 'MultiPolygon' else [gm['coordinates']]

        features.append({
            'type': 'Feature',
            'properties': {'k': kod, 's': r['sprzedawca']},
            'geometry': {'type': 'MultiPolygon', 'coordinates': zaokragl(coords, 4)},
        })
        # [kod, nazwa, wojewodztwo, sprzedawca, labelLat, labelLng,
        #  urzadLat, urzadLng, miasto, typUrzedu]
        centers.append([kod, r['nazwa'], r['woj'], r['sprzedawca'],
                        lat, lng, s['lat'], s['lng'], s['miasto'], s['urzad']])

    db = {
        'wersja': 2,
        'geo': {'type': 'FeatureCollection', 'features': features},
        'centers': centers,
    }

    path = os.path.join(DATA, 'powiaty.js')
    with io.open(path, 'w', encoding='utf-8') as f:
        f.write('/* Wygenerowane przez tools/build_data.py. Nie edytuj recznie. */\n')
        f.write('window.POWIATY_DB=')
        json.dump(db, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')

    kb = os.path.getsize(path) / 1024.0
    wierzch = sum(len(ring) for ft in features
                  for poly in ft['geometry']['coordinates'] for ring in poly)
    print('\ndata/powiaty.js: %d powiatow, %d wierzcholkow, %.0f kB' %
          (len(centers), wierzch, kb))


def main():
    if '--odswiez-siedziby' in sys.argv:
        siedziby = przelicz_siedziby(wczytaj_csv())
    else:
        siedziby = wczytaj_siedziby()

    rows = wczytaj_csv()
    geo = wczytaj_geojson()
    ok = kontrola(rows, geo, siedziby)
    zapisz(rows, geo, siedziby)

    if '--bez-gmin' not in sys.argv:
        zbuduj_gminy(rows)

    print('\nRaport szczegolowy: data/raport.txt')
    if not ok:
        print('UWAGA: raport zawiera bledy krytyczne - przejrzyj go przed publikacja.')


# --------------------------------------------------------------------------
# 6. Gminy i wojewodztwa (data/gminy.js, ladowane leniwie)
# --------------------------------------------------------------------------

def pobierz(url, nazwa_pliku):
    """Pobiera plik do src/ i zapamietuje, zeby kolejne budowania byly offline."""
    import urllib.request
    path = os.path.join(SRC, nazwa_pliku)
    if os.path.exists(path):
        return json.load(io.open(path, encoding='utf-8'))
    print('  pobieram %s ...' % nazwa_pliku)
    with urllib.request.urlopen(url) as r:
        dane = json.loads(r.read().decode('utf-8'))
    with io.open(path, 'w', encoding='utf-8') as f:
        json.dump(dane, f, ensure_ascii=False, separators=(',', ':'))
    return dane


def warianty_nazwy(nazwa):
    """Nazwa gminy bywa inna niz nazwa wsi, w ktorej stoi urzad."""
    out = [nazwa]
    baza = re.sub(r'\s*\([^)]*\)', '', nazwa).strip()
    if baza != nazwa:
        out.append(baza)
    if '-' in baza:                       # 'Radziechowy-Wieprz' -> siedziba w Wieprzu
        out += [x.strip() for x in baza.split('-') if x.strip()]
    return out


def siedziba_gminy(nazwa, powiat_nazwa, woj, indeksy):
    """Szuka miejscowosci bedacej siedziba gminy, coraz szerzej.

    Kolejnosc ma znaczenie: najpierw wlasny powiat, potem wojewodztwo (to lapie
    gminy wiejskie z urzedem w sasiednim miescie na prawach powiatu, np. gmina
    wiejska Suwalki), na koncu dopasowanie po poczatku nazwy (gmina Piatnica ->
    wies Piatnica Poduchowna)."""
    wg_powiatu, wg_woj, wszystkie = indeksy
    dist = norm(re.sub(r'\s*\([^)]*\)\s*$', '', powiat_nazwa.replace('powiat ', '')))
    wrs = warianty_nazwy(nazwa)

    for pula, etykieta in ((wg_powiatu.get((dist, norm(woj)), []), 'powiat'),
                           (wg_woj.get(norm(woj), []), 'wojewodztwo'),
                           (wszystkie, 'kraj')):
        for w in wrs:
            for m in pula:
                if norm(m['Name']) == norm(w):
                    return m, etykieta

    # ostatnia proba: miejscowosc zaczynajaca sie od nazwy gminy
    for m in wg_powiatu.get((dist, norm(woj)), []):
        if norm(m['Name']).startswith(norm(wrs[-1]) + ' '):
            return m, 'prefiks'
    return None, None


def zbuduj_gminy(rows):
    print('\nGminy i wojewodztwa')
    prng = pobierz(PRNG_URL, 'prng.json')
    src_gminy = pobierz(GMINY_URL, 'gminy.geojson')
    src_woj = pobierz(WOJ_URL, 'wojewodztwa.geojson')

    wg_powiatu, wg_woj = defaultdict(list), defaultdict(list)
    for m in prng:
        wg_powiatu[(norm(m['District']), norm(m['Province']))].append(m)
        wg_woj[norm(m['Province'])].append(m)
    indeksy = (wg_powiatu, wg_woj, prng)

    powiaty = {}
    for r in rows:
        powiaty[r['kod']] = r

    features, centers = [], []
    licznik = {'powiat': 0, 'wojewodztwo': 0, 'kraj': 0, 'prefiks': 0, 'geometria': 0}
    sieroty = 0

    for f in src_gminy['features']:
        terc = f['properties']['terc']
        nazwa = f['properties']['name']
        pw = powiaty.get(terc[:4])
        if not pw:
            sieroty += 1
            continue

        g = shape(f['geometry']).buffer(0).simplify(0.0008, preserve_topology=True)
        lat, lng = punkt_etykiety(g)

        m, skad = siedziba_gminy(nazwa, pw['nazwa'], pw['woj'], indeksy)
        if m:
            uLat, uLng, miejscowosc = round(m['Latitude'], 5), round(m['Longitude'], 5), m['Name']
        else:
            # brak miejscowosci w rejestrze — bierzemy punkt z geometrii.
            # Nawigacja i tak trafi w budynek, bo do Google idzie nazwa urzedu.
            uLat, uLng, miejscowosc = lat, lng, nazwa
            skad = 'geometria'
        licznik[skad] += 1

        urzad = TYP_GMINY.get(terc[-1], 'Urząd Gminy')
        gm = mapping(g)
        coords = gm['coordinates'] if gm['type'] == 'MultiPolygon' else [gm['coordinates']]

        features.append({
            'type': 'Feature',
            'properties': {'k': terc, 's': pw['sprzedawca']},
            'geometry': {'type': 'MultiPolygon', 'coordinates': zaokragl(coords, 4)},
        })
        # terc, nazwa, wojewodztwo, sprzedawca, labelLat, labelLng,
        # urzadLat, urzadLng, miejscowosc, typUrzedu, nazwa powiatu
        centers.append([terc, nazwa, pw['woj'], pw['sprzedawca'], lat, lng,
                        uLat, uLng, miejscowosc, urzad, pw['nazwa']])

    woj_feats = []
    for f in src_woj['features']:
        g = shape(f['geometry']).buffer(0).simplify(0.004, preserve_topology=True)
        gm = mapping(g)
        coords = gm['coordinates'] if gm['type'] == 'MultiPolygon' else [gm['coordinates']]
        woj_feats.append({
            'type': 'Feature',
            'properties': {'n': f['properties']['name'].lower()},
            'geometry': {'type': 'MultiPolygon', 'coordinates': zaokragl(coords, 3)},
        })

    path = os.path.join(DATA, 'gminy.js')
    with io.open(path, 'w', encoding='utf-8') as fh:
        fh.write('/* Wygenerowane przez tools/build_data.py. Nie edytuj recznie. */\n')
        fh.write('window.GMINY_DB=')
        json.dump({'wersja': 1,
                   'geo': {'type': 'FeatureCollection', 'features': features},
                   'centers': centers}, fh, ensure_ascii=False, separators=(',', ':'))
        fh.write(';\nwindow.WOJ_DB=')
        json.dump({'type': 'FeatureCollection', 'features': woj_feats},
                  fh, ensure_ascii=False, separators=(',', ':'))
        fh.write(';\n')

    kb = os.path.getsize(path) / 1024.0
    print('  gmin: %d (pominieto bez powiatu: %d), wojewodztw: %d' % (len(centers), sieroty, len(woj_feats)))
    print('  siedziby: %s' % ', '.join('%s %d' % (k, v) for k, v in licznik.items() if v))
    print('  data/gminy.js: %.0f kB (ladowane dopiero przy przelaczeniu na widok gmin)' % kb)

    with io.open(os.path.join(DATA, 'raport.txt'), 'a', encoding='utf-8') as fh:
        fh.write('\n\nGMINY\n')
        fh.write('Gmin:                      %d\n' % len(centers))
        for k, v in licznik.items():
            if v:
                fh.write('Siedziba z dopasowania %-12s %d\n' % (k + ':', v))
        fh.write('Uwaga: pozycje "geometria" maja punkt z granicy gminy zamiast\n')
        fh.write('wspolrzednych miejscowosci. Nawigacja dziala, bo do Google idzie nazwa urzedu.\n')


if __name__ == '__main__':
    main()
