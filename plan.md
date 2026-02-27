# Plan: Multi-tenancy — niezależne konta per wynajmujący

## TL;DR

Każdy wynajmujący rejestruje się samodzielnie (email + hasło) i zarządza swoimi
nieruchomościami oraz rezerwacjami w pełnej izolacji od innych. Tenant tworzy
nazwane "widoki" (np. "Sprzątaczka", "Księgowa") z wybranym zestawem nieruchomości
i konfiguracją widocznych pól — link view-only otwiera dokładnie ten widok bez
logowania. Istniejące dane migrowane są do jednego tenanta tworzonego z obecnych
danych AdminCredentials.

---

## Nowe modele

### `src/models/Tenant.ts`

Pola:

- `email: string` — unikalny, wymagany
- `passwordHash: string` — bcrypt
- `name: string` — wyświetlana nazwa (np. "Jan Kowalski")
- `createdAt / updatedAt` — timestamps

### `src/models/TenantView.ts`

Reprezentuje konfigurowalny widok share'owany linkiem.

Pola:

- `tenantId: ObjectId ref Tenant` — wymagany
- `name: string` — np. "Sprzątaczka", "Księgowa"
- `viewToken: string` — UUID v4, unikalny, indeksowany — klucz dostępu w URL
- `propertyNames: string[]` — lista nieruchomości do pokazania; pusta tablica = wszystkie
- `showGuests: boolean` — default `true`
- `showNotes: boolean` — default `true`
- `showPrices: boolean` — default `true`
- `createdAt / updatedAt` — timestamps

### `src/models/AppSettings.ts` — zmiana

Zamienić singleton `key: 'global'` na per-tenant:

- Usunąć pole `key`
- Dodać `tenantId: ObjectId ref Tenant` — unikalny
- Pole `defaultGroupId` zostaje

Przy `GET /ical/settings` — jeśli zwracany `defaultGroupId` nie należy do `req.tenantId`
(możliwe po błędnej migracji), zwrócić `null` zamiast cudzego ObjectId.

### `src/models/PasswordResetToken.ts` — nowy

Pola:

- `tenantId: ObjectId ref Tenant` — wymagany, indeksowany
- `token: string` — UUID v4, unikalny, indeksowany
- `expiresAt: Date` — wymagany; TTL index → MongoDB automatycznie usuwa wygasłe dokumenty

TTL index: `{ expiresAt: 1 }, { expireAfterSeconds: 0 }` — MongoDB usuwa dokument
gdy `expiresAt` minie (bez potrzeby ręcznego czyszczenia).
Token jednorazowy — usuwany natychmiast po użyciu.

---

## Zmiany w istniejących modelach

### `src/models/Booking.ts`

Dodać pole:

- `tenantId: ObjectId ref Tenant` — wymagany, indeksowany

**Zmienić unique index** `{ uid, source }` → `{ tenantId, uid, source }`.
Bez tej zmiany sync jest niemożliwy — MongoDB odrzuci rezerwację jeśli dwóch tenantów
ma ten sam `uid` z tego samego źródła iCal.

### `src/models/PropertyConfig.ts`

Dodać pole:

- `tenantId: ObjectId ref Tenant` — wymagany, indeksowany

Zaktualizować istniejący unikalny indeks `name + source + url` →
`tenantId + name + source + url`.

### `src/models/Group.ts`

Dodać pole:

- `tenantId: ObjectId ref Tenant` — wymagany, indeksowany

Zaktualizować unikalny indeks `name` → `tenantId + name`.

---

## Auth — zmiany

### `src/routes/auth.ts`

- `POST /auth/register` — publiczny, przyjmuje `{ email, name, password }`,
  tworzy dokument `Tenant`, zwraca sesję (od razu zalogowany po rejestracji).
  Walidacja: email unikalny, hasło min. 8 znaków.
- `POST /auth/login` — przyjmuje `{ email, password }`, szuka w `Tenant`.
  Sesja: `{ tenantId: string, role: 'admin' }`. Usunąć zależność od
  `AdminCredentials` z głównego flow.
- `POST /auth/logout` — bez zmian.
- `GET /auth/me` — zwraca `{ tenantId, role: 'admin', name }` lub `null` jeśli brak sesji.
  Rola `'admin'` zachowana dla kompatybilności z frontendem (`config.html` sprawdza `role !== 'admin'`).
- `POST /auth/change-password` — szuka po `req.session.tenantId` w `Tenant`.
- `POST /auth/forgot-password` — publiczny, przyjmuje `{ email }`. Szuka `Tenant`
  po emailu. Jeśli istnieje: generuje UUID v4 token, zapisuje `PasswordResetToken`
  z `expiresAt = now + 1h`, wysyła email z linkiem
  `{APP_URL}/reset-password?token=...` przez Resend.
  **Zawsze zwraca 200** niezależnie od tego czy email istnieje (ochrona przed
  enumeracją kont).
- `POST /auth/reset-password` — publiczny, przyjmuje `{ token, newPassword }`.
  Walidacja: token istnieje i `expiresAt > now`, hasło min. 8 znaków.
  Aktualizuje `passwordHash` w `Tenant`, usuwa dokument `PasswordResetToken`.
  Jeśli token nieważny lub wygasły → 400.

### Serwis mailowy — Resend

Nowy plik `src/services/EmailService.ts`:

- Używa pakietu `resend` (`npm install resend`).
- Eksportuje funkcję `sendPasswordResetEmail(to: string, resetUrl: string): Promise<void>`.
- Konfiguracja przez env var `RESEND_API_KEY`.
- Nadawca: `MAIL_FROM` z env (default `noreply@yourdomain.com`);
  na etapie testów można użyć `onboarding@resend.dev` (działa bez własnej domeny,
  ale wysyła tylko na adres właściciela konta Resend).
- Jeśli `RESEND_API_KEY` nie jest ustawiony → rzuć błąd z czytelnym komunikatem
  (nie wysyłaj w ciszy).

Nowe env vars (dodać do `src/config/index.ts` i `render.yaml`):

- `RESEND_API_KEY` — wymagany w produkcji
- `MAIL_FROM` — opcjonalny, default `noreply@yourdomain.com`
- `APP_URL` — wymagany (bazowy URL aplikacji, np. `https://booking.example.com`),
  używany do budowania linku resetującego

### `src/middleware/auth.ts`

- `SessionData` — zmienić `userId: string` → `tenantId: string`, zmienić
  `role: 'admin'` (zachowana semantycznie — jeden owner = zawsze admin swojego tenanta).
- `requireAuth` — sprawdza `session.tenantId`.
- `requireAdmin` — **usunąć** (nie ma globalnego admina).
- Nowy middleware `resolveTenantAccess`:
  - Jeśli sesja → `req.tenantId = session.tenantId`, `req.viewOnly = false`,
    `req.viewConfig = null` (pełen dostęp).
  - Jeśli `?viewToken=` w query → szuka `TenantView` po tokenie →
    `req.tenantId`, `req.viewOnly = true`,
    `req.viewConfig = { propertyNames, showGuests, showNotes, showPrices }`.
  - Jeśli ani sesji ani tokenu → 401.
- Rozszerzyć `Request` o `tenantId: string`, `viewOnly: boolean`,
  `viewConfig: ViewConfig | null`.

---

## Zmiany w routach

### Wszystkie chronione routy

Zastąpić `requireAdmin` przez `requireAuth` (sesja tenanta) lub
`resolveTenantAccess` (sesja lub viewToken).

Dodać do każdego zapytania DB filtr `{ tenantId: req.tenantId }`.

Blokować mutacje gdy `req.viewOnly === true` → 403.

### `src/routes/ical/data.ts`

Dodatkowo: jeśli `req.viewConfig.propertyNames.length > 0` → dodać
`propertyQuery.name = { $in: req.viewConfig.propertyNames }`.

Filtrować odpowiedź: ukryć pola `guests`, `notes`, `price` gdy odpowiednie
flagi w `viewConfig` są `false`.

### `src/routes/ical/settings.ts`

- `GET /ical/settings` — szukać `AppSettings` po `{ tenantId: req.tenantId }`.
- `PUT /ical/settings` — chroniony `requireAuth`, zaktualizować upsert po
  `{ tenantId }` zamiast `{ key: 'global' }`.

### `src/routes/ical/sync.ts`

Dodać `{ tenantId: req.tenantId }` do:

- `PropertyConfig.find(propertyQuery)` — filtr nieruchomości do syncowania.
- `Booking.find({ ... })` — filtr istniejących bookingów w oknie synchronizacji.
- Wszystkich `Booking.updateOne/updateMany/deleteMany` wewnątrz logiki sync.

### `src/routes/ical/summary.ts`

Funkcja `calculateCleaningCosts` musi przyjąć `tenantId` jako parametr.
Dodać `{ tenantId }` do `Booking.find()` i `PropertyConfig.find()` wewnątrz tej funkcji.
Oba endpointy (`/summary/current-month`, `/summary/next-month`) przekazują `req.tenantId`.

### `src/routes/ical/fetch.ts`

Dodać `{ tenantId: req.tenantId }` do `PropertyConfig.find(propertyQuery)`.

### `src/routes/ical/guests.ts` i `src/routes/ical/notes.ts`

Zmienić `Booking.updateOne({ _id: value.id }, ...)` →
`Booking.updateOne({ _id: value.id, tenantId: req.tenantId }, ...)`.
Bez tego tenant A może edytować rezerwacje tenanta B znając ObjectId.

### `src/routes/ical/merge.ts`

Dodać `{ tenantId: req.tenantId }` do `Booking.findById` (przez `findOne`) i
wszystkich `Booking.create/updateMany/deleteMany` wewnątrz `/merge` i `/split`.

### Nowy `src/routes/ical/views.ts`

CRUD widoków — chroniony `requireAuth` (tylko właściciel tenanta):

- `GET /ical/views` — lista widoków tenanta.
- `POST /ical/views` — tworzenie widoku, generowanie `viewToken` (UUID v4).
  Walidacja: `propertyNames` muszą należeć do `req.tenantId` — sprawdzić przez
  `PropertyConfig.find({ tenantId, name: { $in: propertyNames } })` i odrzucić
  nieznane nazwy (400).
- `PUT /ical/views/:id` — edycja nazwy, listy nieruchomości, flag widoczności.
  Ta sama walidacja `propertyNames` co przy POST.
- `DELETE /ical/views/:id` — usunięcie widoku.
- `POST /ical/views/:id/regenerate-token` — nowy `viewToken` (unieważnia stary link).

Publiczny endpoint (bez auth):

- `GET /ical/views/config?viewToken=` — zwraca `{ propertyNames, showGuests, showNotes, showPrices }`
  dla podanego tokenu. Jeśli token nieznany → 404. Używany przez `index.html` do
  konfiguracji widoku przed załadowaniem danych.

### `src/app.ts`

- Zaimportować i podmontować `viewsRoutes`.
- Usunąć logikę auto-init `AdminCredentials` z połączenia z Mongo.
- Zachować `AdminCredentials` model (potrzebny do migracji), ale nie używać
  w nowym flow.

---

## Skrypt migracji `scripts/migrate-to-tenant.ts`

Kolejność kroków:

1. Połącz z Mongo (z env `MONGODB_URI`).
2. Wczytaj istniejący dokument `AdminCredentials` (`userId: 'admin'`).
   Jeśli brak → zakończ z błędem (migracja już mogła być uruchomiona).
3. Wczytaj `ADMIN_EMAIL` i `ADMIN_NAME` z env (lub użyj wartości domyślnych
   `admin@localhost` / `Admin`).
4. **Usuń stary unique index** `{ uid: 1, source: 1 }` z kolekcji `bookings`
   przez `db.collection('bookings').dropIndex('uid_1_source_1')`.
   (Jeśli indeks nie istnieje — zignoruj błąd i kontynuuj.)
5. Utwórz dokument `Tenant` z `email`, `name`, `passwordHash` z `AdminCredentials`.
6. Pobierz `_id` nowego tenanta → `tenantId`.
7. `Booking.updateMany({}, { $set: { tenantId } })`.
8. `PropertyConfig.updateMany({}, { $set: { tenantId } })`.
9. `Group.updateMany({}, { $set: { tenantId } })`.
10. Wczytaj `AppSettings` (`key: 'global'`), zaktualizuj:
    `{ $set: { tenantId }, $unset: { key: '' } }`.
11. **Utwórz nowy unique index** `{ tenantId: 1, uid: 1, source: 1 }` na `bookings`.
12. **Flush sesji**: `db.collection('sessions').deleteMany({})`.
    (Jedyny user zostanie wylogowany — musi zalogować się ponownie emailem i hasłem.)
13. Wypisz podsumowanie (liczba zaktualizowanych dokumentów).
14. Opcjonalnie: usuń `AdminCredentials` po pomyślnej migracji (z flagą `--cleanup`).

Uruchomienie: `npx ts-node scripts/migrate-to-tenant.ts`

Env vars potrzebne: `MONGODB_URI`, opcjonalnie `ADMIN_EMAIL`, `ADMIN_NAME`.

> ⚠️ Skrypt jest idempotentny w kroku 4 (ignoruje brak indeksu), ale **nie** w kroku 5
> (próba utworzenia Tenant z tym samym emailem rzuci błąd duplikatu). Przy ponownym
> uruchomieniu należy najpierw usunąć dokument Tenant lub użyć upsert po emailu.

---

## Zmiany w frontendzie

### `public/ui/login.html`

- Dodać pole `email` (type=email) przed polem hasła.
- Dodać link/przycisk „Zarejestruj się" → przekierowanie do `register.html`.
- Dodać link „Zapomniałem hasła" → `/forgot-password`.
- Zaktualizować fetch `POST /auth/login` — body `{ email, password }`.

### Nowa strona `public/ui/register.html`

- Formularz: `name`, `email`, `password`, `confirmPassword`.
- Fetch `POST /auth/register` → po sukcesie redirect do `/`.

### Nowa strona `public/ui/forgot-password.html`

- Formularz: pole `email`.
- Fetch `POST /auth/forgot-password` → wyświetl komunikat
  „Jeśli konto istnieje, wysłaliśmy link resetujący" (zawsze, niezależnie od odpowiedzi).

### Nowa strona `public/ui/reset-password.html`

- Na mount: odczytaj `?token=` z URL. Jeśli brak → redirect do `/login`.
- Formularz: `newPassword`, `confirmPassword`.
- Fetch `POST /auth/reset-password` z `{ token, newPassword }`.
- Po sukcesie → redirect do `/login` z komunikatem „Hasło zostało zmienione".
- Po błędzie (wygasły/nieważny token) → wyświetl komunikat i link do `/forgot-password`.

### `public/ui/index.html`

- Na mount: sprawdź `?viewToken=` w `window.location.search`.
  - Jeśli present → **nie zapisuj w `localStorage`** — trzymaj token wyłącznie
    w pamięci (zmienna reaktywna), dołączaj do każdego fetch jako `?viewToken=...`.
    Token tylko w URL: nie trafia do localStorage, link działa na wielu zakładkach
    niezależnie.
  - Ukryj wszystkie przyciski edycji/sync/merge/split.
  - Pobierz config widoku (`GET /ical/views/config?viewToken=...`)
    → ukryj kolumny `guests`/`notes`/ceny zgodnie z `viewConfig`.
- Jeśli brak tokenu → sprawdź sesję przez `GET /auth/me`:
  - `role === 'admin'` → zalogowany, pełen dostęp.
  - Brak sesji → redirect do `/login`.
- Zaktualizować warunek `isAdmin`: `computed(() => userRole.value === 'admin')`
  (bez zmian kodu — rola `'admin'` zachowana).

### `public/ui/config.html`

- Nowa sekcja "Widoki dostępu" (share links):
  - Lista widoków tenanta z nazwą i tokenem.
  - Formularz tworzenia widoku: nazwa, checkboxy nieruchomości,
    toggle dla guests/notes/prices.
  - Przycisk "Kopiuj link" → `window.location.origin + '/?viewToken=' + token`.
  - Przycisk "Unieważnij link" → `POST /ical/views/:id/regenerate-token`.

---

## Kolejność implementacji (sugerowana)

1. Modele: `Tenant`, `TenantView`, korekty indeksów w `Booking` / `PropertyConfig` /
   `Group` / `AppSettings`.
2. Auth: `register`, `login` (rola `'admin'`), `forgot-password`, `reset-password`,
   middleware `resolveTenantAccess`, zastąpienie `requireAdmin` → `requireAuth`
   w całej aplikacji. Serwis `EmailService.ts` (Resend).
3. Skrypt migracji (drop index → updateMany → create index → flush sesji).
4. Scope zapytań we **wszystkich** routach:
   `data`, `properties`, `sync`, `summary`, `fetch`, `guests`, `notes`, `merge`,
   `groups`, `settings`.
5. Route `views.ts` z CRUD + publiczny `GET /ical/views/config`.
6. Frontend: `login` (pole email + linki rejestracja/reset), `register`,
   `forgot-password`, `reset-password`, `index` (viewToken tylko z URL,
   bez localStorage), `config` (panel widoków).
