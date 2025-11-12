# Memory Optimization Report

**Data**: 12 listopada 2025  
**Status**: Krytyczne problemy naprawione, dodatkowe rekomendacje poniżej

## Naprawione problemy (Critical)

### ✅ 1. Frontend: Cleanup timerów przy unmount

- **Problem**: `saveTimer` (updateGuests/updateNotes) nie był czyszczony przy opuszczeniu strony
- **Fix**: Dodano `clearTimeout(saveTimer)` w `onBeforeUnmount`
- **Impact**: Eliminuje memory leak przy szybkim opuszczaniu/powrocie do strony

### ✅ 2. Backend: Axios timeout

- **Problem**: `axios.get(url)` w `ICalExportService` bez timeout → wiszące requesty zajmują pamięć
- **Fix**: Dodano `timeout: 30000` (30s) i `maxRedirects: 5`
- **Impact**: Requests nie wiszą w nieskończoność; timeout errors są catchowane

### ✅ 3. Backend: Usunięto nieużywaną instancję

- **Problem**: `const icalService = new ICalExportService()` w `app.ts` nigdy nie używana
- **Fix**: Usunięto martwy kod
- **Impact**: Eliminuje zbędną instancję w pamięci

## Dodatkowe rekomendacje (Medium priority)

### 🔶 4. Frontend: setTimeout w handleSync nie są czyszczone

**Lokalizacja**: `public/ui/index.html` linie ~594, 601, 608

```javascript
// Problem:
setTimeout(() => {
  syncProgress.value.show = false;
}, 2000);
setTimeout(() => {
  showModal('Synchronizacja zakończona!', ...);
}, 2000);
```

**Rekomendacja**:

```javascript
// W setup():
const syncTimers = ref([]);

// W handleSync:
const timer1 = setTimeout(() => {
  syncProgress.value.show = false;
}, 2000);
syncTimers.value.push(timer1);

// W onBeforeUnmount:
syncTimers.value.forEach((t) => clearTimeout(t));
```

### 🔶 5. Frontend: Duplikacja rows/allRows

**Lokalizacja**: `public/ui/index.html` ~457, 526

**Problem**: `rows` i `allRows` zawierają te same dane (backward compatibility)

**Rekomendacja**:

- Jeśli `rows` nie jest używany nigdzie indziej, usuń i używaj tylko `allRows`
- Lub zrób `rows` computed property: `const rows = computed(() => allRows.value)`

### 🔶 6. Backend: Sync przy dużych bookings

**Lokalizacja**: `src/routes/ical/sync.ts`

**Problem**: Przy tysiącach bookings, Maps/Sets (`existingMap`, `byProp`) zajmują dużo pamięci w trakcie sync

**Rekomendacja**:

- Rozważ streaming/batch processing dla bardzo dużych sync (>1000 bookings)
- Monitoruj heap usage przy sync:
  ```bash
  node --expose-gc --max-old-space-size=4096 dist/app.js
  ```
- Dodaj endpoint `/metrics` z `process.memoryUsage()` dla monitoringu

## Monitoring (zalecane)

### Dodać endpoint `/metrics`

```typescript
// src/app.ts
app.get('/metrics', (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    rss: `${(mem.rss / 1024 / 1024).toFixed(2)} MB`,
    heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`,
    heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB`,
    external: `${(mem.external / 1024 / 1024).toFixed(2)} MB`,
    uptime: `${process.uptime().toFixed(2)}s`,
  });
});
```

### Dodać logowanie memory usage przy sync

```typescript
// src/routes/ical/sync.ts (na początku i końcu)
const memBefore = process.memoryUsage().heapUsed;
// ... sync logic ...
const memAfter = process.memoryUsage().heapUsed;
logger.info(`[${syncId}] Memory delta: ${((memAfter - memBefore) / 1024 / 1024).toFixed(2)} MB`);
```

## Best practices długoterminowo

1. **Virtualizacja frontend** — dla list >100 wpisów użyj virtual scroll (np. `vue-virtual-scroller`)
2. **Pagination zawsze** — nie używaj `all=true` dla zapytań, które mogą zwrócić >1000 wpisów
3. **Cache iCal responses** — jeśli te same URL są fetchowane wielokrotnie, rozważ Redis cache z TTL
4. **Indexy DB** — upewnij się, że `start` i `end` mają indexy w Mongoose schema:
   ```typescript
   BookingSchema.index({ start: 1, end: 1 });
   ```
5. **Connection pooling** — Mongoose domyślnie pooluje, ale sprawdź config:
   ```typescript
   mongoose.connect(uri, {
     maxPoolSize: 10,
     serverSelectionTimeoutMS: 5000,
   });
   ```
6. **Rate limiting** — jeśli masz dużo requestów, dodaj rate limit do `/ical/sync` i `/ical/data`

## Testy memory leaks (manualne)

```bash
# 1. Uruchom serwer z memory profiling
node --inspect --max-old-space-size=512 dist/app.js

# 2. Otwórz Chrome DevTools -> Memory
# 3. Wykonaj scenario:
#    - Otwórz UI, kliknij 10x "Następny", "Poprzedni"
#    - Uruchom 5x sync manualny
#    - Odśwież stronę 10x
# 4. Zrób heap snapshot przed i po
# 5. Porównaj: czy są obiekty, które nie zostały GC'd?

# Alternatywnie: użyj clinic.js
npm install -g clinic
clinic doctor -- node dist/app.js
# ... perform operations ...
# Ctrl+C → wygeneruje raport z analizą memory
```

## Conclusion

Krytyczne problemy naprawione. Aplikacja powinna zużywać znacznie mniej pamięci przy:

- Szybkim przełączaniu stron (cleanup timers)
- Długich/wiszących iCal requests (axios timeout)
- Bezczynności (usunięta martwa instancja)

Jeśli nadal widzisz wzrost pamięci:

1. Sprawdź `/metrics` endpoint (po dodaniu)
2. Uruchom memory profiler (clinic/Chrome DevTools)
3. Rozważ dodatkowe rekomendacje (#4-6)
