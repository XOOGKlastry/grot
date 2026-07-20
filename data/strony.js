/* Adresy stron urzedow gmin i starostw, klucz = kod TERYT.
   Plik wypelnia tools/fetch_strony.py danymi z OpenStreetMap:
       python3 tools/fetch_strony.py
   Mozna tez dopisywac recznie:
       "2417102": { "www": "https://radziechowy-wieprz.pl", "bip": "https://bip..." }
   Kazda jednostka bez wpisu dostaje w aplikacji przycisk 'Znajdz strone'
   z gotowym zapytaniem, wiec brak danych niczego nie psuje. */
window.STRONY = {};
