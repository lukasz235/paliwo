# Paliwo (aplikacja webowa na Androida i iPhone'a)

Aplikacja działa w przeglądarce i instaluje się na ekranie głównym telefonu. Dane czyta i zapisuje
bezpośrednio w arkuszu Google „fuel” (karty Corsa, BMW, Odyssey), więc nie potrzebujesz żadnego serwera.
Zdjęcie paragonu jest rozpoznawane na telefonie (Tesseract.js), nic nie jest wysyłane do żadnej usługi OCR.

Co potrafi: pulpit z wykresem spalania, dodawanie tankowań przyciskiem „+” (ze zdjęcia paragonu lub ręcznie),
8 popularnych stacji i własna („Inna…”), paliwa Pb95/Pb98/ON/ON premium/LPG, zniżki (zł/l lub kwota łączna,
na całość albo na część litrów), kwota liczona automatycznie, lokalizacja tankowania (pinezka i mapa w historii),
historia z edycją i usuwaniem, spalanie od pełnego do pełnego baku, porównanie stacji (z filtrem paliwa).
Inne osoby widzą te same dane, jeśli udostępnisz im arkusz.

## Uruchomienie krok po kroku

### 1. Google Cloud: Client ID (jednorazowo, ok. 10 minut)
1. Wejdź na https://console.cloud.google.com i utwórz projekt, np. „Paliwo”.
2. **APIs & Services → Library**, wyszukaj „Google Sheets API” i kliknij **Enable**.
3. **Google Auth Platform** (dawniej „OAuth consent screen”): typ użytkowników **External**, nazwa „Paliwo”,
   Twój e-mail jako kontakt. Status publikacji zostaw jako **Testing**.
4. W sekcji **Audience / Test users** dodaj swój adres Gmail i adresy osób, które mają korzystać z aplikacji
   (do 100 osób).
5. **Clients → Create client → Web application**. W polu **Authorized JavaScript origins** wpisz adres,
   pod którym będzie aplikacja, np. `https://twojlogin.github.io` (sam adres: bez ścieżki i bez ukośnika na końcu).
6. Skopiuj **Client ID** (kończy się na `.apps.googleusercontent.com`).

### 2. Wpisz Client ID
Otwórz `config.js` i zamień `WKLEJ_TUTAJ_CLIENT_ID.apps.googleusercontent.com` na swój Client ID.
`SPREADSHEET_ID` jest już ustawiony na Twój arkusz „fuel”.

### 3. Wrzuć pliki do internetu (GitHub Pages, za darmo)
1. Załóż konto na https://github.com i utwórz **publiczne** repozytorium, np. `paliwo`.
2. Wgraj wszystkie pliki z tego folderu (przycisk „Add file → Upload files”).
3. **Settings → Pages**: źródło „Deploy from a branch”, gałąź `main`, folder `/ (root)`.
4. Po minucie aplikacja będzie pod adresem `https://twojlogin.github.io/paliwo/`.
   Origin z kroku 1.5 to `https://twojlogin.github.io`.

Publiczne repozytorium ujawnia tylko ID arkusza. Bez zalogowania kontem z dostępem nikt nie odczyta danych.
Zamiast GitHub Pages możesz użyć dowolnego hostingu plików statycznych z HTTPS (Cloudflare Pages, Netlify).

### 4. Zainstaluj na telefonie
- **Android (Chrome):** otwórz adres aplikacji, menu ⋮ → „Zainstaluj aplikację”.
- **iPhone (Safari):** otwórz adres w Safari, przycisk Udostępnij → „Do ekranu początkowego”.

Przy pierwszym logowaniu Google pokaże ostrzeżenie „Ta aplikacja nie została zweryfikowana”. To normalne dla
aplikacji w trybie Testing: kliknij „Zaawansowane” → „Przejdź do Paliwo”.

### 5. Udostępnij arkusz innym użytkownikom
W Google Sheets: **Udostępnij** → dodaj osoby jako **Edytujący**. Muszą też być na liście Test users (krok 1.4).

## Kolumny w arkuszu
A–H: data, przebieg, litry, cena, kwota (po zniżce), stacja, paliwo, do pełna. I–P: formuły (nie ruszać).
Q: uwagi. **R–U (nowe):** zniżka łącznie (zł), litry ze zniżką, szerokość i długość geograficzna.
Dopisane nagłówki R1:U1 są już w arkuszu na wszystkich trzech kartach.

## Dobrze wiedzieć
- **Lokalizacja:** telefon zapyta o zgodę. Zapisywana jest pozycja telefonu w chwili tankowania (nie dane ze zdjęcia).
  Możesz ją usunąć przyciskiem „Usuń” w formularzu. Pozycja trafia do Twojego arkusza i widzą ją osoby z dostępem do niego.
- **Zniżki:** cena za litr w arkuszu to cena z dystrybutora, a kwota jest już po zniżce. Statystyki stacji liczą z kwoty po zniżce.
- **Uprawnienie:** aplikacja prosi o dostęp do arkuszy Google konta (zakres `spreadsheets`), ale odczytuje i zapisuje
  tylko arkusz z `config.js`.
- **Sesja:** logowanie jest ważne ok. godziny. Po wygaśnięciu aplikacja poprosi o ponowne zalogowanie jednym przyciskiem.
- **Internet:** dodawanie i odczyt danych wymaga połączenia. Pierwsze rozpoznanie paragonu pobiera moduł OCR
  (kilka MB), potem jest szybciej.
- **Zdjęcie paragonu:** najlepiej z bliska, prosto, przy dobrym świetle. Pod polem zdjęcia jest rozwijany tekst
  odczytany z paragonu, przydatny, gdy coś się nie rozpozna. Zawsze sprawdź liczby przed zapisem.
- **Limit wierszy:** formuły w arkuszu są przygotowane do wiersza 400 (zmienisz w `config.js` po rozszerzeniu formuł).
- **Zmiana nazw kart:** nazwy w `CARS` w `config.js` muszą być identyczne z zakładkami w arkuszu.
- **Aktualizacja aplikacji:** po zmianie plików zwiększ `VERSION` w `sw.js`, żeby telefony pobrały nową wersję.

## Testy logiki
`node test.js` sprawdza liczenie spalania, porównanie stacji i parser paragonu.
