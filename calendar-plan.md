# Plan: Kalendarz z blokadami, export iCal i auto-sync

## TL;DR

Dwukierunkowa synchronizacja: aplikacja importuje rezerwacje z Booking/Airbnb (już
działa), eksportuje własny feed iCal subskrybowany przez platformy, umożliwia ręczne
blokowanie dat w wizualnym kalendarzu miesięcznym. Auto-sync co godzinę przez
`node-cron` wewnątrz aplikacji.

---

## Nowe modele

### `src/models/Property.ts` — nowy (logiczna nieruchomość)

Reprezentuje nieruchomość jako byt logiczny, niezależny od źródeł iCal.

Pola:

- `name: string` — unikalny klucz wewnętrzny (musi pasować do `propertyName`
  w `Booking` i `name` w `PropertyConfig`). Unikalny per tenant.
- `displayName: string` — wyświetlana nazwa w UI (np. "Apartament Kraków — Nowa Huta").
  Może być dowolna, nie musi być unikalna.
- `tenantId: ObjectId ref Tenant` — **opcjonalny**, indeksowany. Teraz zawsze `null`.
  Pole dodane z wyprzedzeniem — przy wdrożeniu multi-tenancy wystarczy uzupełnić
  wartość i dodać filtr w zapytaniach. Wszystkie zapytania do `Property` idą
  przez wspólny helper `findProperties(tenantId?)` który łatwo rozszerzyć.
- `exportToken: string` — UUID v4, unikalny globalnie, indeksowany. Jeden token
  na logiczną nieruchomość — ten sam URL dostaje Booking i Airbnb. Buduje feed URL:
  `GET /ical/export/:exportToken`.
- `cleaningCost: number` — przeniesione z `PropertyConfig`, default `0`.
  Logicznie należy do nieruchomości, nie do źródła iCal.
- `groupId: ObjectId ref Group` — przeniesione z `PropertyConfig`. Grupowanie
  nieruchomości (np. "Kraków", "Zakopane") należy do logicznej nieruchomości,
  nie do konkretnego kanału.
- `createdAt / updatedAt` — timestamps

Unikalny indeks: `{ tenantId, name }`.

### `src/models/PropertyConfig.ts` — uproszczenie

Po utworzeniu `Property` — usunąć pola które przenoszą się na poziom logiczny:

- Usunąć `cleaningCost` (przeniesione na `Property`).
- Usunąć `groupId` (przeniesione na `Property`).
- Dodać `propertyId: ObjectId ref Property` — wymagany, indeksowany. Wiąże
  konkretny iCal source z nieruchomością.

Zostają pola specyficzne dla źródła: `name` (jako klucz techniczny), `icalUrl`,
`source`.

### `src/models/Booking.ts` — rozszerzenie

- Rozszerzyć istniejący enum `manualType` o wartość `'block'`:
  `manualType?: 'merged' | 'split' | 'block'`.
- Blokada to `isManual: true`, `manualType: 'block'`, własne UUID jako `uid`,
  `source: 'manual'`.
- Dodać pole `blockReason?: string` — opcjonalny opis (np. "Remont").
- Pole `hasConflict?: boolean` — flaga konfliktu z zewnętrzną rezerwacją (default `false`).

---

## Nowe endpointy backendowe

### `src/routes/ical/export.ts` — nowy

- `GET /ical/export/:exportToken` — **publiczny** (bez auth — Booking/Airbnb odpytuje
  bez logowania). Szuka `Property` po `exportToken`. Pobiera wszystkie aktywne
  rezerwacje i blokady dla tej nieruchomości przez `propertyName = property.name`
  (bez `cancellationStatus`). Generuje i zwraca plik `.ics`
  (`Content-Type: text/calendar`) z `VEVENT` dla każdej rezerwacji i blokady.
  - Biblioteka: `ical-generator` (`npm install ical-generator`).
  - `SUMMARY` dla blokad: `"Direct Booking"`.
  - `SUMMARY` dla rezerwacji: `"Reserved"`.
  - `STATUS`: `CONFIRMED`, `TRANSP`: `OPAQUE` dla wszystkich eventów.

### `src/routes/ical/blocks.ts` — nowy

- `POST /ical/blocks` — tworzy blokadę. Body: `{ propertyName, start, end, reason? }`.
  Walidacja:
  - `start < end`.
  - Brak nakładania z innymi aktywnymi rezerwacjami tej nieruchomości → 409 z listą
    konfliktów.
- `PUT /ical/blocks/:id` — edycja dat i powodu blokady. Ta sama walidacja nakładania
  co przy POST.
- `DELETE /ical/blocks/:id` — usuwa blokadę. Tylko `manualType: 'block'` —
  nie można usunąć tym endpointem zwykłej rezerwacji.

### `src/routes/ical/properties.ts` — przepisanie

Obecny CRUD operuje na `PropertyConfig` (per source). Po wprowadzeniu `Property`
potrzebne są dwa poziomy:

**Poziom logiczny — nieruchomość (`Property`):**

- `GET /ical/properties` — lista nieruchomości z `displayName`, `exportToken`,
  pełnym feed URL, `groupId`, `cleaningCost`, liczbą sources.
- `POST /ical/properties` — tworzy `Property` z `name`, `displayName`, `groupId?`,
  `cleaningCost?`. Generuje `exportToken` (UUID v4).
- `PUT /ical/properties/:id` — edycja `displayName`, `groupId`, `cleaningCost`.
  `name` nie jest edytowalny po utworzeniu (jest kluczem w `Booking.propertyName`).
- `DELETE /ical/properties/:id` — usuwa `Property` i wszystkie powiązane
  `PropertyConfig`. Blokuje jeśli istnieją aktywne rezerwacje (nie-cancelled).
- `POST /ical/properties/:id/regenerate-export-token` — nowy `exportToken`.

**Poziom źródeł iCal (`PropertyConfig`) — pod konkretną nieruchomością:**

- `GET /ical/properties/:id/sources` — lista źródeł iCal dla nieruchomości.
- `POST /ical/properties/:id/sources` — dodaj źródło (`icalUrl`, `source`).
- `PUT /ical/properties/:id/sources/:sourceId` — edycja `icalUrl`, `source`.
- `DELETE /ical/properties/:id/sources/:sourceId` — usuń źródło.

### `src/routes/ical/sync.ts` — rozszerzenie

- Nowy endpoint `POST /ical/sync-all` — bez parametrów, syncuje wszystkie
  nieruchomości wszystkich tenantów. Używany przez wewnętrzny scheduler.
  Chroniony nagłówkiem `X-Cron-Secret` (env var `CRON_SECRET`) zamiast sesji.

### `src/app.ts` — rozszerzenie

- Podmontować `exportRouter` (publiczny, przed middleware auth).
- Podmontować `blocksRouter` (chroniony `requireAuth`).
- Dodać route `GET /calendar` serwujący `calendar.html` (chroniony `requireAuth`).
- Zainicjalizować `SyncScheduler` po połączeniu z MongoDB.

---

## Auto-sync

### `src/services/SyncScheduler.ts` — nowy

- Używa `node-cron` (`npm install node-cron`).
- Inicjalizowany w `src/app.ts` po połączeniu z MongoDB.
- Harmonogram konfigurowalny przez env var `SYNC_CRON` (default: `'0 * * * *'` —
  co godzinę).
- Wywołuje wewnętrznie tę samą logikę co `POST /ical/sync` dla wszystkich aktywnych
  `PropertyConfig`.
- Loguje wyniki przez `winston` (już w projekcie).
- Env var `SYNC_ENABLED=true/false` — możliwość wyłączenia bez redeploy
  (przydatne przy debugowaniu).

---

## Reset danych przy wdrożeniu

Zamiast migracji — czyste wdrożenie nowego kodu na pustej bazie:

1. Przed deploymentem: zrób dump konfiguracji nieruchomości z `GET /ical/properties`
   (zapisz lokalnie nazwy, URL-e iCal, źródła, koszty sprzątania, grupy).
2. Deploy nowego kodu.
3. Wyczyść kolekcje: `bookings`, `propertyconfigs`, `groups`, `admincredentials`
   (przez mongosh lub panel MongoDB Atlas).
4. Skonfiguruj nieruchomości od nowa przez UI (`/config`) — teraz przez nową
   strukturę `Property` + sources.
5. Uruchom sync — rezerwacje z Booking/Airbnb zaciągną się ponownie.

> Dane tracone świadomie: ręczne `notes`, `guests`, merge/split. Akceptowalne.

---

## Frontend

### Biblioteka

**FullCalendar v6** — `@fullcalendar/core`, `@fullcalendar/daygrid`,
`@fullcalendar/interaction` przez CDN. Licencja MIT, zero konfiguracji budowania.

### Nowa strona `public/ui/calendar.html`

- Selektor nieruchomości u góry — lista `displayName` z `GET /ical/properties`.
- Kalendarz miesięczny FullCalendar:
  - Rezerwacje z Booking/Airbnb — kolor niebieski, read-only (klik = podgląd szczegółów).
  - Blokady manualne — kolor czerwony, klikalny (modal edycji/usunięcia).
  - Zaznaczanie zakresu dat myszą (`selectable: true`) → modal tworzenia blokady.
  - Zaznaczenie przez granicę miesięcy działa out-of-the-box w FullCalendar.
- **Modal tworzenia blokady**: daty (wypełnione z zaznaczenia), pole "Powód"
  (opcjonalne), przycisk "Zablokuj".
- **Modal edycji blokady**: daty, powód, przycisk "Zapisz", przycisk "Usuń blokadę".
- **Sekcja "Feed iCal"** (na dole strony lub w sidebarze):
  - Wyświetla URL: `{window.location.origin}/ical/export/{exportToken}`.
  - Przycisk "Kopiuj link".
  - Przycisk "Regeneruj link" → `POST /ical/properties/:id/regenerate-export-token`
    → odświeża wyświetlany URL.
  - Instrukcja: "Wklej ten adres w Booking.com → Zewnętrzny kalendarz → Importuj".

### `public/ui/index.html` — drobna zmiana

- Dodać link nawigacyjny "Kalendarz" prowadzący do `/calendar`.

---

## Nowe env vars

Dodać do `src/config/index.ts` i `render.yaml`:

- `SYNC_ENABLED` — `'true'` / `'false'`, default `'true'`
- `SYNC_CRON` — wyrażenie cron, default `'0 * * * *'`
- `CRON_SECRET` — token zabezpieczający `POST /ical/sync-all` przy wywołaniu
  zewnętrznym

---

## Kolejność implementacji (sugerowana)

1. Modele: nowy `Property` (z opcjonalnym `tenantId`), uproszczony `PropertyConfig`
   (dodanie `propertyId`, usunięcie `cleaningCost` i `groupId`), rozszerzenie
   `Booking` o `manualType: 'block'`, `blockReason`, `hasConflict`.
2. `properties.ts` — przepisanie CRUD na dwa poziomy (Property + sources).
   Helper `findProperties(tenantId?)` gotowy pod przyszłe multi-tenancy.
3. `export.ts` — feed iCal z `ical-generator`. Przetestować wklejając URL w Booking.
4. `blocks.ts` — CRUD blokad z walidacją konfliktów i obsługą `hasConflict`.
5. `SyncScheduler.ts` — auto-sync z `node-cron` + endpoint `POST /ical/sync-all`.
6. Frontend: `calendar.html` z FullCalendar, modal blokad, sekcja feed URL.
7. Nawigacja w `index.html`.
8. Reset danych na produkcji i rekonfiguracja nieruchomości.

---

## Otwarte kwestie do decyzji

**1. Konflikt blokada vs sync — rozwiązanie: jawne powiadomienie w UI**

Gdy sync wykryje rezerwację z Booking/Airbnb nakładającą się na istniejącą blokadę
manualną — zapisuje rezerwację (realna, nie można zignorować), ale:

- Dodać pole `hasConflict: boolean` (default `false`) do modelu `Booking` —
  ustawiane na `true` dla blokady która ma nakładającą się rezerwację z zewnątrz.
- Sync po wykryciu konfliktu: ustawia `hasConflict: true` na blokadzie, loguje
  ostrzeżenie przez `winston`.
- Frontend `calendar.html`:
  - Blokady z `hasConflict: true` wyświetlane w kolorze **żółtym/pomarańczowym**
    zamiast czerwonego, z ikoną ostrzeżenia ⚠️.
  - Po załadowaniu kalendarza: jeśli istnieją blokady z `hasConflict: true` →
    wyświetl **modal/toast z listą konfliktów**: nazwa nieruchomości, daty blokady,
    daty nakładającej się rezerwacji i jej źródło (Booking/Airbnb).
    Przykład: _"⚠️ Blokada 3–5 marca nakłada się z rezerwacją Booking.com (3–4 marca).
    Usuń blokadę lub skontaktuj się z platformą."_
  - Przycisk "Rozwiąż" w modalu → otwiera widok blokady z opcją usunięcia.
  - Po usunięciu blokady lub ręcznym potwierdzeniu ("Rozumiem") → `hasConflict`
    kasowany lub blokada usuwana.
- Dodać endpoint `POST /ical/blocks/:id/resolve-conflict` — czyści flagę
  `hasConflict: true` na blokadzie (użytkownik potwierdził że widział ostrzeżenie).

**2. Format SUMMARY w eksporcie iCal — rozwiązanie: symulacja channel managera**

Celem jest żeby Booking i Airbnb widziały blokady jako realne rezerwacje z innego
kanału (direct booking), nie jako techniczne blokady. Generowany `.ics`:

- `SUMMARY`: `"Direct Booking"` — wyświetlane w kalendarzu platformy jako nazwa
  rezerwacji. Booking.com i Airbnb pokazują to pole bezpośrednio właścicielowi.
- `DESCRIPTION`: `blockReason` jeśli podany (np. "Remont"), pusty string jeśli brak.
  Dzięki temu właściciel widzi w Booking powód blokady jeśli kliknie w event.
- `STATUS`: `CONFIRMED` — ważne, żeby platforma traktowała jako potwierdzoną zajętość.
- `TRANSP`: `OPAQUE` — oznacza że termin jest zajęty (nie transparent/free).

Dla zwykłych rezerwacji importowanych z innych platform eksportowanych z powrotem:

- `SUMMARY`: `"Reserved"` — neutralna nazwa, nie zdradza danych gościa.
- `DESCRIPTION`: pusty.

> ⚠️ Po wdrożeniu przetestować import w Booking.com i Airbnb — sprawdzić czy daty
> są prawidłowo blokowane w ich kalendarzu po stronie właściciela.
