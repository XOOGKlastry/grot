#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pobiera adresy stron urzedow gmin i starostw z OpenStreetMap i zapisuje
data/strony.js, ktore aplikacja wczytuje przy starcie.

Granice administracyjne w OSM sa w Polsce opisane kodem TERYT
(tag teryt:terc) oraz - czesto - adresem strony i BIP. To wystarczy,
zeby dopiac odnosnik do kazdej jednostki bez recznej pracy.

Uzycie:
  python3 tools/fetch_strony.py
  python3 tools/fetch_strony.py --serwer https://overpass.kumi.systems/api/interpreter

Skrypt nie jest czescia zwyklego budowania - wymaga internetu i
odpytuje publiczny serwer Overpass, wiec uruchamiaj go rzadko.
Gdy data/strony.js nie istnieje, aplikacja dziala dalej: zamiast
odnosnika wprost pokazuje przycisk 'Znajdz strone' z gotowym
zapytaniem do wyszukiwarki.
"""

import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')

SERWERY = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
]

# admin_level 6 = powiat, 7 = gmina
ZAPYTANIE = """
[out:json][timeout:600];
area["ISO3166-1"="PL"][admin_level=2]->.pl;
(
  relation["boundary"="administrative"]["admin_level"="6"](area.pl);
  relation["boundary"="administrative"]["admin_level"="7"](area.pl);
);
out tags;
"""

# kolejnosc ma znaczenie: wlasna strona urzedu przed BIP
KLUCZE_WWW = ['website', 'contact:website', 'url', 'website:official']
KLUCZE_BIP = ['website:bip', 'contact:website:bip', 'bip', 'url:bip']


def pobierz(serwery):
    ostatni = None
    for url in serwery:
        try:
            print('Pytam %s ...' % url)
            dane = urllib.parse.urlencode({'data': ZAPYTANIE}).encode()
            req = urllib.request.Request(url, data=dane, headers={
                'User-Agent': 'mapa-sprzedazy/2.1 (build script)'
            })
            with urllib.request.urlopen(req, timeout=620) as r:
                return json.loads(r.read().decode('utf-8'))
        except Exception as e:      # noqa: BLE001 - chcemy sprobowac kolejny serwer
            print('  nie wyszlo: %s' % e)
            ostatni = e
            time.sleep(3)
    sys.exit('Zaden serwer Overpass nie odpowiedzial. Ostatni blad: %s' % ostatni)


def normalizuj_url(u):
    u = (u or '').strip()
    if not u:
        return None
    if not re.match(r'^https?://', u, re.I):
        u = 'https://' + u.lstrip('/')
    if len(u) > 200 or ' ' in u:
        return None
    return u


def pierwszy(tags, klucze):
    for k in klucze:
        u = normalizuj_url(tags.get(k))
        if u:
            return u
    return None


def main():
    serwery = SERWERY
    if '--serwer' in sys.argv:
        serwery = [sys.argv[sys.argv.index('--serwer') + 1]]

    odp = pobierz(serwery)
    elementy = odp.get('elements', [])
    print('Obiektow z OSM: %d' % len(elementy))

    wynik = {}
    bez_teryt = 0
    for el in elementy:
        t = el.get('tags', {})
        terc = (t.get('teryt:terc') or t.get('teryt:TERC') or '').strip()
        if not terc.isdigit():
            bez_teryt += 1
            continue

        wpis = {}
        www = pierwszy(t, KLUCZE_WWW)
        bip = pierwszy(t, KLUCZE_BIP)
        # czasem w polu website siedzi wprost adres BIP
        if www and not bip and 'bip' in www.lower():
            bip, www = www, None
        if www:
            wpis['www'] = www
        if bip:
            wpis['bip'] = bip
        if wpis:
            wynik[terc] = wpis

    powiaty = sum(1 for k in wynik if len(k) == 4)
    gminy = sum(1 for k in wynik if len(k) == 7)

    path = os.path.join(DATA, 'strony.js')
    with io.open(path, 'w', encoding='utf-8') as f:
        f.write('/* Adresy stron urzedow z OpenStreetMap.\n')
        f.write('   Wygenerowane przez tools/fetch_strony.py. Mozna dopisywac recznie:\n')
        f.write('   "KOD_TERYT": { "www": "https://...", "bip": "https://..." }\n')
        f.write('   Brakujace pozycje aplikacja zastepuje przyciskiem wyszukiwania. */\n')
        f.write('window.STRONY=')
        json.dump(wynik, f, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
        f.write(';\n')

    kb = os.path.getsize(path) / 1024.0
    print('\ndata/strony.js: %d wpisow (%d powiatow, %d gmin), %.0f kB'
          % (len(wynik), powiaty, gminy, kb))
    print('Bez kodu TERYT w OSM: %d obiektow (pominiete)' % bez_teryt)
    print('Pokrycie gmin: %d z 2477 (%.0f%%)' % (gminy, 100.0 * gminy / 2477))
    if gminy < 1200:
        print('\nUwaga: pokrycie ponizej polowy. Reszta dostanie przycisk wyszukiwania,')
        print('co nadal dziala - mozna tez dopisac brakujace adresy recznie w pliku.')


if __name__ == '__main__':
    main()
