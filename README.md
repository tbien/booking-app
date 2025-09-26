# Booking App (iCal + MongoDB)

Samodzielna aplikacja do synchronizacji rezerwacji z iCal do MongoDB i ich przeglądania w prostym UI.

## Wymagania
- Node.js >= 16
- MongoDB (lokalnie lub zdalnie)

## Konfiguracja
1. Zmienna środowiskowa `MONGODB_URI` (domyślnie `mongodb://localhost:27017/booking-app`).
2. Źródła iCal:
   - Priorytet: `ICAL_PROPERTIES` w `.env` jako JSON (tablica obiektów `{name,url}`), np.:
```
ICAL_PROPERTIES=[{"name":"Apartament 1","url":"https://www.airbnb.pl/calendar/ical/xxx.ics?s=token"},{"name":"Apartament 1","url":"https://ical.booking.com/v1/export?t=token"}]
```
   - Fallback: plik `config/ical-properties.json` w katalogu projektu.

## Instalacja i start (bez Dockera)
```
npm install
npm run dev
```
- UI: http://localhost:4000/

## Docker (zalecane do szybkiego startu)
```
docker compose up --build
```
- Aplikacja: http://localhost:4000/
- MongoDB: localhost:27017 (w kontenerze usługa `mongo`)
- Zmienne środowiskowe ustawisz w `docker-compose.yml` lub `.env` (Docker Compose automatycznie go czyta).

## Funkcje
- Synchronizacja bieżących rezerwacji z iCal do MongoDB, wyliczanie statusu „PILNE”.
- Przeglądanie historii z bazy (parametry `from`/`to`), bez synchronizacji.
- Edycja liczby gości z opóźnionym zapisem.
- Presety zakresów: aktualny miesiąc, poprzedni miesiąc.
