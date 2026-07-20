# Mapa sprzedaży — powiaty i trasy

Mapa terytoriów sprzedaży dla Polski w dwóch skalach — 380 powiatów albo 2477 gmin — z układaniem trasy dnia i przekazaniem jej do nawigacji w Google Maps. Jedna strona statyczna, bez backendu, bez kluczy API.

**Demo:** `https://TWOJA-NAZWA.github.io/mapa-sprzedazy/`

---

## Co ta aplikacja robi inaczej

**Punktem każdej jednostki jest siedziba jej władz, nie środek geometryczny.** Środek ciężkości powiatu wypada zwykle w polu — a jeśli powiat otacza miasto, potrafi wypaść zupełnie poza jego granicą. Silnik tras przyciąga wtedy punkt do najbliższej drogi, którą na wsi bywa droga polna z prędkością profilową 10 km/h. Stąd biorą się czasy przejazdu oderwane od rzeczywistości. Tutaj każdy powiat prowadzi do konkretnego starostwa albo urzędu miasta, w mieście, przy ulicy.

Powiat prowadzi do starostwa, gmina do urzędu gminy, miasta i miasta na prawach powiatu do urzędu miasta.

Konsekwencja, która wygląda na błąd, a jest poprawna: dla 44 powiatów siedziba leży **poza** ich granicą. Powiat poznański prowadzi do Poznania, krakowski do Krakowa, białostocki do Białegostoku. Tam naprawdę stoją te budynki.

**Nawigację prowadzi Google Maps.** Szacunek OSRM służy do ustalenia kolejności przystanków — do tego wystarczą względne koszty między punktami. Bezwzględny czas przyjazdu jest domeną Google, które liczy ETA z historycznych śladów GPS. Stąd duży przycisk na dole panelu jako główna akcja aplikacji.

---

## Jak to jest poukładane

Aplikacja ma trzy zakładki i stały dok na dole:

| Zakładka | Co robi |
|---|---|
| **Dodaj** | wyszukiwarka gmin i powiatów w jednym polu, pod nią wklejanie listy adresów, pod nią odczyt z obrazu |
| **Trasa** | wybór zakończenia trasy i lista przystanków do przestawiania |
| **Zapisane** | zapis i wczytywanie tras |

**Dok** — wynik i przycisk nawigacji — jest zawsze widoczny, niezależnie od zakładki i od tego, jak daleko przewinięto listę. Na telefonie zostaje na ekranie także po zwinięciu panelu.

### Wyszukiwarka

Jedno pole obsługuje 2477 gmin i 380 powiatów. Gminy wychodzą wyżej, bo to one są jednostką pracy — powiat służy głównie za widok z lotu ptaka. Każdy wynik ma znacznik rodzaju i podpis: gmina pokazuje swój powiat, powiat pokazuje województwo i siedzibę.

Szukanie ignoruje polskie znaki (`zywiecki`, `lodzki`, `srem`) i przyjmuje kod TERYT.

### Warstwa mapy dobiera się sama

Poniżej przybliżenia 8 mapa pokazuje powiaty, wyżej przechodzi na gminy — i rysuje tylko te, które mieszczą się w kadrze. 2477 obszarów naraz dławi telefon, a przy oddaleniu i tak nic z nich nie widać. Nie ma przełącznika, bo nie ma czego przełączać.

Dane gmin (1,9 MB) dociągają się w tle zaraz po starcie, więc wyszukiwarka ma je, zanim ktokolwiek zdąży wpisać drugą literę.

### Zakończenie trasy

Trzy tryby, każdy z własną ikoną i krótką animacją przy wyborze:

| Tryb | Ikona | Co znaczy |
|---|---|---|
| **Pętla** | strzałka w kółko | wracasz tam, skąd wyjechałeś |
| **Start → meta** | flaga szachownicowa | ostatni przystanek na liście jest metą |
| **Otwarta** | strzałka wybiegająca poza kadr | kończysz tam, gdzie wypada najszybciej |

### Edycja przystanku

Ołówek przy przystanku otwiera pole z adresem. Poprawiasz, klikasz „Szukaj adresu" i punkt przeskakuje w nowe miejsce razem z celem nawigacji. Działa dla każdego przystanku — także tych z wyszukiwarki, bo urząd czasem się przeprowadza, a OCR czasem zmyśla.

## Mapa bazowa

Przycisk z ikoną warstw otwiera wybór podkładu. Każda pozycja ma podgląd —
prawdziwy kafelek z tej samej okolicy, więc widać dokładnie to, co dostaniesz.

| Podkład | Źródło | Do czego |
|---|---|---|
| **Mapa** | CARTO Voyager | codzienna praca, dopasowana kolorystycznie |
| **Satelita** | Geoportal GUGiK | co naprawdę stoi pod adresem |
| **OSM** | OpenStreetMap | numery dróg i szczegóły uliczne |
| **Topograficzna** | OpenTopoMap | ukształtowanie terenu, przydatne w górach |

Ciepły filtr kolorystyczny działa tylko na własnej mapie — na obcych podkładach
wyłącza się sam. Na zdjęciach lotniczych granice robią się białe i cieńsze,
a wypełnienie schodzi do 26%, żeby nie zasłaniało terenu.

Geoportal bywa przeciążony. Po ośmiu nieudanych kafelkach aplikacja przechodzi
na zdjęcia Esri World Imagery i mówi o tym w podpowiedzi nad mapą — zamiast
pokazywać pustą szachownicę.

## Strona urzędu i BIP

Popup każdej jednostki oraz każdy przystanek na liście mają odnośnik do strony
urzędu. Kolejność: własna strona urzędu → BIP → wyszukiwarka z gotowym
zapytaniem (`Urząd Gminy Kobierzyce BIP`).

Adresy trzymane są w `data/strony.js`, kluczem jest kod TERYT:

```js
window.STRONY = {
  "2417":    { "www": "https://powiat.zywiec.pl" },
  "2417102": { "www": "https://radziechowy-wieprz.pl", "bip": "https://bip.radziechowy-wieprz.pl" }
};
```

Plik startowo jest pusty — wtedy wszystkie jednostki dostają przycisk
„Znajdź stronę", co nadal działa, tylko wymaga jednego kliknięcia więcej.
Żeby wypełnić go automatycznie z OpenStreetMap (granice gmin i powiatów mają
tam tagi `teryt:terc` i `website`):

```bash
python3 tools/fetch_strony.py
```

Skrypt wypisze pokrycie. Brakujące pozycje można dopisać ręcznie — to zwykły
plik JavaScript. Celowo nie zgadujemy adresów po nazwie gminy: martwy odnośnik
jest gorszy od jednego kliknięcia więcej.

## Liternictwo drogowe

Tarczki `A4`, `S7`, `DK94` używają kroju **Drogowskaz**, jeśli wgrasz go do
katalogu `assets/`. Repozytorium go nie zawiera, bo licencja pozwala tylko na
użytek niekomercyjny — szczegóły i instrukcja w `assets/README.md`. Domyślnie
wchodzi **Overpass** (Open Font License), krój wywiedziony z liternictwa
drogowskazowego, ładowany z Google Fonts w wersji okrojonej do trzynastu znaków
(`ADKS` i cyfry), czyli około 3 kB.

## Publikacja na GitHub Pages

Najkrócej — skrypt robi wszystko poza jednym kliknięciem w ustawieniach:

```bash
bash tools/publikuj.sh TWOJA-NAZWA mapa-sprzedazy
```

Ręcznie, gdyby coś poszło nie tak:

```bash
git init
git add .
git commit -m "Mapa sprzedaży z trasowaniem"
git branch -M main
git remote add origin https://github.com/TWOJA-NAZWA/mapa-sprzedazy.git
git push -u origin main
```

Następnie w repozytorium: **Settings → Pages → Source: Deploy from a branch → `main` → `/ (root)` → Save**.

Po kilku minutach strona działa pod `https://twoja-nazwa.github.io/mapa-sprzedazy/`.

Plik `.nojekyll` jest w repozytorium celowo — bez niego Jekyll potrafi pominąć część plików.

### HTTPS jest wymagany

Geolokalizacja („Moja lokalizacja") i rozpoznawanie tekstu ze zdjęcia działają wyłącznie po HTTPS. GitHub Pages daje HTTPS automatycznie, więc na produkcji jest w porządku — ale otwarcie `index.html` prosto z dysku wyłączy te dwie funkcje. Reszta aplikacji działa i lokalnie.

### Inne hostingi

- **Netlify** — przeciągnij katalog na stronę, adres gotowy od razu
- **Vercel** — `vercel deploy`
- **Własny serwer** — skopiuj katalog do `/var/www/html/`

Brak backendu oznacza, że wystarczy dowolny hosting statyczny.

---

## Struktura

```
index.html            interfejs i style
app.js                logika: mapa, wyszukiwarka, solver, Google Maps, import
data/powiaty.js       380 powiatów (window.POWIATY_DB, ~400 kB)
data/gminy.js         2477 gmin i granice województw (~1,9 MB, wczytywane leniwie)
data/strony.js        adresy stron urzędów wg kodu TERYT (opcjonalne)
data/siedziby.json    siedziby powiatów, wejście do budowania danych
data/raport.txt       raport kontroli jakości z ostatniego budowania
src/                  pliki źródłowe: CSV handlowców i GeoJSON granic
assets/               miejsce na krój Drogowskaz (opcjonalny)
tools/build_data.py   budowanie data/*.js ze źródeł
tools/fetch_strony.py pobieranie adresów stron urzędów z OpenStreetMap
tools/publikuj.sh     testy + push na GitHub
tools/test.js         testy bez przeglądarki

Pliki `src/prng.json`, `src/gminy.geojson` i `src/wojewodztwa.geojson` są w `.gitignore` — skrypt budujący pobiera je sam przy pierwszym uruchomieniu.
```

### Format `data/powiaty.js`

```js
window.POWIATY_DB = {
  wersja: 2,
  geo: { type: 'FeatureCollection', features: [ /* properties: { k: TERYT, s: handlowiec } */ ] },
  centers: [
    // kod, nazwa, województwo, handlowiec,
    // labelLat, labelLng,      ← punkt podpisu, zawsze wewnątrz granicy
    // urzadLat, urzadLng,      ← siedziba władz, cel nawigacji
    // miasto, typ urzędu
    ['2417','powiat żywiecki','śląskie','Aleksander', 49.61, 19.20, 49.678, 19.188, 'Żywiec', 'Starostwo Powiatowe']
  ]
};
```

Dwa osobne punkty na powiat to sedno konstrukcji. Podpis musi leżeć w granicy, żeby mapa była czytelna. Cel nawigacji musi leżeć tam, gdzie stoi budynek — czasem poza granicą.

---

## Zmiana danych

Podmień pliki w `src/`, przelicz i sprawdź raport:

```bash
pip install -r tools/requirements.txt
python3 tools/build_data.py
cat data/raport.txt
```

Oczekiwane wyniki kontroli:

| Pozycja | Wartość |
|---|---|
| Powiatów z geometrią | 380 z 380 |
| Powiatów z siedzibą | 380 z 380 |
| Siedziba poza granicą | ~44 (miasta na prawach powiatu — w porządku) |
| Gmin | 2477 |
| Siedzib gmin z rejestru | 2465 z 2477 |
| Siedziba dalej niż 35 km | 0 |
| Brak geometrii | 0 |

Jeśli „poza granicą" wyskoczy powyżej setki, geokoder pomylił powiaty — prawie zawsze przez powtarzające się nazwy. `powiat brzeski` istnieje w opolskim i małopolskim, `powiat bielski` w śląskim i podlaskim. Dlatego kluczem głównym jest kod TERYT, a nie nazwa.

Przeliczenie siedzib od zera (pobiera rejestr PRNG z GitHuba, ok. 8 MB):

```bash
python3 tools/build_data.py --odswiez-siedziby
```

Siedziby dopasowuje się automatycznie: nazwa miasta kontra rdzeń przymiotnika w nazwie powiatu. Dziesięć przypadków, w których ta reguła zawodzi, siedzi w słowniku `WYJATKI_SIEDZIB` w `tools/build_data.py` — między innymi powiat tatrzański (Zakopane), bieszczadzki (Ustrzyki Dolne), karkonoski (Jelenia Góra) i warszawski zachodni (Ożarów Mazowiecki).

---

## Testy

```bash
npm install
npm test
```

Testy uruchamiają aplikację w jsdom z zaślepionym Leafletem i siecią. Sprawdzają między innymi: kompletność danych, wyszukiwanie bez ogonków, że start zostaje pierwszy, że priorytet trafia zaraz za start, że pętla wraca do punktu wyjścia, że odnośniki do Google zazębiają się na granicach etapów i że brak sieci nie gubi przystanków.

---

## Dlaczego szacunki bywają dłuższe niż w Google

Zaczynij od rozdzielenia objawów. Porównaj z Google osobno kilometry, osobno czas:

- **Rozjeżdżają się kilometry** — jedziemy inną drogą. Najczęściej dlatego, że publiczny serwer `router.project-osrm.org` pracuje na starym wycinku OSM i nie zna nowych dróg ekspresowych. W Polsce boli to mocniej niż gdzie indziej.
- **Kilometry się zgadzają, czas jest dłuższy** — to różnica metody. OSRM liczy z limitów prędkości i ostrożnych domyślnych profilu, Google z historycznych przejazdów. Typowo 10–20% w jedną stronę.

Aplikacja stosuje trzy poprawki, które zamykają większość różnicy:

- punkt trasowania to adres w mieście, a nie środek pola (`radiuses=800` dodatkowo pilnuje przyciągania)
- `continue_straight=false` — bez tego OSRM zabrania zawracania na przystanku i nadkłada pętelki wokół kwartału
- liczby na ekranie pochodzą z `routes[0]`, a nie z sumy macierzy `/table`

Aplikacja **nie mnoży wyniku przez żaden współczynnik korygujący** — pokazuje to, co zwrócił silnik tras, i podpisuje to wprost: „szacunek OSRM, bez ruchu drogowego". Zmyślona precyzja byłaby gorsza od uczciwej przybliżoności, a od podania realnego czasu przyjazdu jest Google, do którego prowadzi przycisk.

**Jeśli dystans odbiega od Google o ponad 8%, problem leży w trasowaniu, nie w liczeniu.** Najprostsze wyjście to własny OSRM na świeżym wycinku:

```bash
wget https://download.geofabrik.de/europe/poland-latest.osm.pbf
docker run -t -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-extract -p /opt/car.lua /data/poland-latest.osm.pbf
docker run -t -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-partition /data/poland-latest.osrm
docker run -t -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-customize /data/poland-latest.osrm
docker run -t -i -p 5000:5000 -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-routed --algorithm mld /data/poland-latest.osrm
```

Potem zmień stałą `OSRM` na początku `app.js`. Znikają przy okazji limity zapytań.

---

## Ograniczenia

- **Google przyjmuje najwyżej 10 punktów w jednym odnośniku.** Dłuższe trasy aplikacja dzieli na zazębiające się etapy — meta etapu jest startem następnego. Nie otwieramy wszystkich naraz, bo przeglądarka zablokuje wszystkie karty poza pierwszą; zamiast tego jest lista z osobnymi przyciskami i kopiowaniem odnośnika.
- **Publiczny serwer OSRM obsługuje do 100 punktów naraz.** Powyżej 95 przystanków aplikacja przechodzi na szacunek z linii prostej i mówi o tym wprost.
- **Nominatim przyjmuje jedno zapytanie na sekundę.** Import 40 adresów trwa około minuty — to nie zawieszenie.
- **OCR pobiera przy pierwszym użyciu około 15 MB słownika.** Potem działa od ręki.
- Współrzędne siedzib pochodzą z rejestru PRNG i wskazują centrum miejscowości, zwykle w promieniu kilometra od budynku urzędu. Do ustalenia kolejności to bez znaczenia. Nawigacja i tak trafia w budynek, bo do Google przekazujemy nazwę urzędu, a nie współrzędne.
- Dla 12 z 2477 gmin rejestr nie ma miejscowości o nazwie zgodnej z nazwą gminy; te dostają punkt wyliczony z granicy. Widać je w `data/raport.txt` jako „geometria".
- Numery dróg pochodzą z kroków trasy zwróconych przez OSRM. Pokazujemy odcinki dłuższe niż 4 km i pomijamy drogi wojewódzkie (numery trzycyfrowe), żeby mapa się nie zaśmieciła.
- Ortofotomapa Geoportalu w wersji WMTS jest przygotowana do skali 1:250. Przy mocnym przybliżeniu obraz miękczeje — to ograniczenie usługi, nie aplikacji.
- OpenTopoMap ma limit przybliżenia 17 i prosi o oszczędne korzystanie. Do codziennej pracy lepsza jest zwykła mapa.

---

## Źródła danych i usługi

| Co | Skąd |
|---|---|
| Granice powiatów | Geoportal (`src/powiaty.geojson`) |
| Przypisania handlowców | `src/sprzedawcy.csv` |
| Granice gmin i województw | [jusuff/PolandGeoJson](https://github.com/jusuff/PolandGeoJson) (GUGiK, public domain) |
| Siedziby powiatów i gmin | [PRNG przez jjbartek/polskie-miejscowosci](https://github.com/jjbartek/polskie-miejscowosci) |
| Mapa | [Leaflet](https://leafletjs.com/), kafelki [CARTO](https://carto.com/) na danych [OpenStreetMap](https://www.openstreetmap.org/copyright) |
| Podkłady | [Geoportal / GUGiK](https://www.geoportal.gov.pl/) (zapasowo Esri), [OpenStreetMap](https://www.openstreetmap.org/copyright), [OpenTopoMap](https://opentopomap.org/) (CC-BY-SA) |
| Strony urzędów | OpenStreetMap (tagi `teryt:terc` i `website`) |
| Trasowanie | [OSRM](https://project-osrm.org/) |
| Geokodowanie | [Nominatim](https://nominatim.org/) |
| OCR | [Tesseract.js](https://tesseract.projectnaptha.com/) |

Serwery OSRM i Nominatim są udostępniane publicznie na zasadzie dobrej woli. Przy poważniejszym użyciu postaw własne — w przeciwnym razie prędzej czy później zostaniesz odcięty, a aplikacja przejdzie na szacunek przybliżony.

---

## Licencja

MIT — patrz `LICENSE`. Dane OpenStreetMap na licencji ODbL.
