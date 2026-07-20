# Liternictwo drogowe

Tarczki z numerami dróg na mapie (`A4`, `S7`, `DK94`) próbują użyć kroju
**Drogowskaz** — cyfrowej wersji polskiego liternictwa znaków drogowych.
Repozytorium go nie zawiera, bo Drogowskaz rozpowszechniany jest na licencji
**freeware wyłącznie do użytku niekomercyjnego**, a to nie pasuje do narzędzia
sprzedażowego ani do publicznego repozytorium.

Bez tego pliku wchodzi zapasowy krój **Overpass** (Open Font License, ładowany
z Google Fonts) — powstał na bazie liternictwa drogowskazowego, więc tarczki i
tak wyglądają jak z drogi.

## Jeśli chcesz prawdziwy Drogowskaz

1. Sprawdź, czy Twoje użycie mieści się w warunkach licencji autora
   (Emil Wojtacki, 2006).
2. Wgraj plik do tego katalogu jako `drogowskaz.woff2` albo `drogowskaz.ttf`.
3. Nic więcej — `@font-face` w `index.html` już na niego czeka i przejmie
   pierwszeństwo nad Overpassem.

Konwersja TTF na WOFF2 zmniejszy plik mniej więcej o połowę:

```bash
pip install fonttools brotli
python3 -c "from fontTools.ttLib import TTFont; f=TTFont('drogowskaz.ttf'); f.flavor='woff2'; f.save('drogowskaz.woff2')"
```
