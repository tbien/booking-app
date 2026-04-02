<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import FullCalendar from '@fullcalendar/vue3';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import type {
  CalendarOptions,
  EventInput,
  DatesSetArg,
  EventClickArg,
  DateSelectArg,
} from '@fullcalendar/core';
import { useAuthStore } from '../stores/auth';
import { useConfigStore } from '../stores/config';
import { propertiesApi } from '../api/properties';
import { bookingsApi } from '../api/bookings';
import { blocksApi } from '../api/blocks';
import { syncApi } from '../api/sync';
import type { PropertyDto, BookingDto } from '../types/api';
import { buildHolidaySet } from '../utils/holidays';

const auth = useAuthStore();
const configStore = useConfigStore();
const isAdmin = computed(() => auth.isAdmin);

// ── State ─────────────────────────────────────────────────
const properties = ref<PropertyDto[]>([]);
const selectedPropertyId = ref<string | null>(null);
const calendarRef = ref<InstanceType<typeof FullCalendar> | null>(null);
const toast = ref({ show: false, message: '', type: 'success' as 'success' | 'error' });

function showToast(msg: string, type: 'success' | 'error' = 'success') {
  toast.value = { show: true, message: msg, type };
  setTimeout(() => (toast.value.show = false), 3500);
}

// ── Modals ────────────────────────────────────────────────
const createModal = ref({ show: false, start: '', end: '', reason: '' });
const editModal = ref({ show: false, id: '', start: '', end: '', reason: '', hasConflict: false });
const viewModal = ref({ show: false, data: null as BookingDto | null });
const conflictsModal = ref({ show: false, title: '', html: '' });
const confirmModal = ref({
  show: false,
  title: '',
  body: '',
  resolve: null as ((v: boolean) => void) | null,
});

function showConfirm(title: string, body: string): Promise<boolean> {
  return new Promise((resolve) => {
    confirmModal.value = { show: true, title, body, resolve };
  });
}
function confirmOk() {
  confirmModal.value.resolve?.(true);
  confirmModal.value.show = false;
}
function confirmCancel() {
  confirmModal.value.resolve?.(false);
  confirmModal.value.show = false;
}

// ── Source helpers ────────────────────────────────────────
function srcLabel(raw: string): string {
  if (!raw || raw === 'manual') return 'Rezerwacja';
  const s = raw.toLowerCase();
  if (s.includes('booking.com')) return 'Booking.com';
  if (s.includes('airbnb.')) return 'Airbnb';
  if (s.includes('expedia.')) return 'Expedia';
  if (s.includes('vrbo.')) return 'VRBO';
  if (s.includes('tripadvisor.')) return 'TripAdvisor';
  try {
    return new URL(raw).hostname.replace('www.', '').split('.')[0];
  } catch {}
  return raw;
}

function platformClass(src: string): string {
  if (!src || src === 'manual') return 'event-booking-other';
  const s = src.toLowerCase();
  if (s.includes('booking.com')) return 'event-booking-bookingcom';
  if (s.includes('airbnb.')) return 'event-booking-airbnb';
  if (s.includes('expedia.')) return 'event-booking-expedia';
  if (s.includes('vrbo.')) return 'event-booking-vrbo';
  if (s.includes('tripadvisor.')) return 'event-booking-tripadvisor';
  return 'event-booking-other';
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// ── Load properties ───────────────────────────────────────
async function loadProperties() {
  properties.value = await propertiesApi.list();
  if (properties.value.length && !selectedPropertyId.value) {
    selectedPropertyId.value = properties.value[0].id;
  }
}

// ── Calendar options ──────────────────────────────────────
const calendarOptions = computed<CalendarOptions>(() => ({
  plugins: [dayGridPlugin, interactionPlugin],
  initialView: 'dayGridMonth',
  locale: 'pl',
  firstDay: 1,
  height: 'auto',
  selectable: isAdmin.value,
  selectMirror: true,
  unselectAuto: true,
  headerToolbar: {
    left: 'prev,next today',
    center: 'title',
    right: 'dayGridMonth',
  },
  buttonText: { today: 'Dziś' },
  datesSet: handleDatesSet,
  events: fetchEvents,
  eventDidMount: handleEventDidMount,
  select: handleSelect,
  eventClick: handleEventClick,
}));

// ── Calendar event handlers ───────────────────────────────
function handleDatesSet(info: DatesSetArg) {
  localStorage.setItem('calendar_date', info.view.currentStart.toISOString().slice(0, 10));
  if (!isAdmin.value || !selectedPropertyId.value) return;
  // Background sync on navigation
  syncApi
    .sync({
      from: info.startStr.slice(0, 10),
      to: info.endStr.slice(0, 10),
      force: true,
    })
    .then(() => {
      calendarRef.value?.getApi().refetchEvents();
    })
    .catch(() => {});
}

async function fetchEvents(
  info: { startStr: string; endStr: string },
  successCallback: (events: EventInput[]) => void,
  failureCallback: (error: Error) => void,
) {
  if (!selectedPropertyId.value) {
    successCallback([]);
    return;
  }
  try {
    const from = info.startStr.slice(0, 10);
    const to = info.endStr.slice(0, 10);
    const result = await bookingsApi.list({
      from,
      to,
      propertyIds: selectedPropertyId.value,
      limit: 1000,
      filterMode: 'overlap',
    });
    const rows = result.rows;

    const events: EventInput[] = rows.map((r) => {
      const isBlock = r.isManual && r.manualType === 'block';
      let className: string;
      if (isBlock && r.hasConflict) className = 'event-block-conflict';
      else if (isBlock) className = 'event-block';
      else className = platformClass(r.source);

      // FullCalendar treats allDay end as exclusive → +1 day
      const displayEnd = new Date(r.end);
      displayEnd.setUTCDate(displayEnd.getUTCDate() + 1);

      return {
        id: r.id,
        title: isBlock
          ? r.blockReason
            ? `🔒 ${r.blockReason}`
            : '🔒 Blokada'
          : `✈ ${srcLabel(r.source)}`,
        start: r.start,
        end: displayEnd.toISOString().slice(0, 10),
        allDay: true,
        classNames: [className],
        extendedProps: { ...r, isBlock },
      };
    });

    // Show conflicts warning
    const conflicts = events.filter((e) => (e.extendedProps as any).hasConflict);
    if (conflicts.length) showConflictsWarning(conflicts);

    // Holiday background events
    if (configStore.settings.showHolidays) {
      const startYear = new Date(from).getFullYear();
      const endYear = new Date(to).getFullYear();
      const years = Array.from(
        { length: endYear - startYear + 1 },
        (_, i) => startYear + i,
      );
      const hMap = buildHolidaySet(years);
      for (const [date, name] of hMap) {
        if (date >= from && date <= to) {
          events.push({
            id: `holiday-${date}`,
            title: name,
            start: date,
            end: date,
            allDay: true,
            display: 'background',
            classNames: ['event-holiday-bg'],
            extendedProps: { isHoliday: true },
          });
        }
      }
    }

    successCallback(events);
  } catch (e: any) {
    failureCallback(e);
  }
}

function handleEventDidMount(info: { el: HTMLElement }) {
  const harness = info.el.parentElement;
  if (!harness?.classList.contains('fc-daygrid-event-harness')) return;
  const cell = document.querySelector('.fc-daygrid-day') as HTMLElement;
  if (!cell) return;
  const half = Math.round(cell.offsetWidth / 2);
  if (info.el.classList.contains('fc-event-start')) harness.style.paddingLeft = half + 'px';
  if (info.el.classList.contains('fc-event-end')) harness.style.paddingRight = half + 'px';
}

function handleSelect(info: DateSelectArg) {
  if (!isAdmin.value) return;
  createModal.value = {
    show: true,
    start: info.startStr.slice(0, 10),
    end: info.endStr.slice(0, 10),
    reason: '',
  };
}

function handleEventClick(info: EventClickArg) {
  const props = info.event.extendedProps as BookingDto & { isBlock: boolean };
  if (props.isBlock && isAdmin.value) {
    editModal.value = {
      show: true,
      id: info.event.id,
      start: new Date(props.start).toISOString().slice(0, 10),
      end: new Date(props.end).toISOString().slice(0, 10),
      reason: props.blockReason || '',
      hasConflict: props.hasConflict,
    };
  } else {
    viewModal.value = { show: true, data: props };
  }
}

function showConflictsWarning(conflicts: EventInput[]) {
  const lines = conflicts
    .map((c) => {
      const p = c.extendedProps as any;
      const s = fmtDate(p.start);
      const e = fmtDate(p.end);
      return `<div style="padding:6px 0;border-bottom:1px solid #2d3748;color:#f6ad55;">⚠️ Blokada ${s} – ${e}${p.blockReason ? ` <span style="color:#94a3b8">(${p.blockReason})</span>` : ''}</div>`;
    })
    .join('');
  conflictsModal.value = {
    show: true,
    title: '⚠️ Wykryto konflikty blokad',
    html: lines,
  };
}

// ── iCal conflict modal helper ────────────────────────────
function showICalConflictModal(conflicts: any[], mode: string) {
  const title = mode === 'edit' ? '🚫 Nie można zapisać blokady' : '🚫 Nie można dodać blokady';
  const lines = conflicts
    .map((c: any) => {
      let platform = 'Zewnętrzna platforma';
      const src = (c.source || '').toLowerCase();
      if (src.includes('booking.com')) platform = 'Booking.com';
      else if (src.includes('airbnb.')) platform = 'Airbnb';
      return `<div style="padding:4px 0;">✈ <strong>${platform}</strong>: ${fmtDate(c.start)} – ${fmtDate(c.end)}</div>`;
    })
    .join('');
  conflictsModal.value = {
    show: true,
    title,
    html: `<div style="margin-bottom:10px;color:#f87171;">Ten termin jest już zajęty:</div>${lines}`,
  };
}

// ── Block CRUD ────────────────────────────────────────────
async function createBlock() {
  if (!selectedPropertyId.value || !createModal.value.start || !createModal.value.end) {
    showToast('Podaj daty blokady', 'error');
    return;
  }
  try {
    await blocksApi.create({
      propertyId: selectedPropertyId.value,
      start: createModal.value.start + 'T00:00:00.000Z',
      end: createModal.value.end + 'T00:00:00.000Z',
      reason: createModal.value.reason || undefined,
    });
    createModal.value.show = false;
    calendarRef.value?.getApi().refetchEvents();
    showToast('Blokada dodana ✓');
  } catch (e: any) {
    if (e.code === 'BLOCK_CONFLICT' && e.details?.length) {
      showICalConflictModal(e.details, 'create');
    } else {
      showToast(e.message || 'Błąd tworzenia blokady', 'error');
    }
  }
}

async function saveBlock() {
  if (!editModal.value.id) return;
  try {
    await blocksApi.update(editModal.value.id, {
      start: editModal.value.start + 'T00:00:00.000Z',
      end: editModal.value.end + 'T00:00:00.000Z',
      reason: editModal.value.reason || undefined,
    });
    editModal.value.show = false;
    calendarRef.value?.getApi().refetchEvents();
    showToast('Blokada zaktualizowana ✓');
  } catch (e: any) {
    if (e.code === 'BLOCK_CONFLICT' && e.details?.length) {
      showICalConflictModal(e.details, 'edit');
    } else {
      showToast(e.message || 'Błąd aktualizacji', 'error');
    }
  }
}

async function deleteBlock() {
  if (!editModal.value.id) return;
  if (!(await showConfirm('🗑 Usuń blokadę', 'Na pewno usunąć tę blokadę?'))) return;
  try {
    await blocksApi.delete(editModal.value.id);
    editModal.value.show = false;
    calendarRef.value?.getApi().refetchEvents();
    showToast('Blokada usunięta');
  } catch (e: any) {
    showToast(e.message || 'Błąd usuwania', 'error');
  }
}

// ── Feed URL ──────────────────────────────────────────────
const selectedProperty = computed(() =>
  properties.value.find((p) => p.id === selectedPropertyId.value),
);

function copyFeedUrl() {
  if (!selectedProperty.value?.exportUrl) return;
  navigator.clipboard
    .writeText(selectedProperty.value.exportUrl)
    .then(() => showToast('Link skopiowany ✓'));
}

async function regenerateToken() {
  if (!selectedPropertyId.value) return;
  if (!(await showConfirm('🔄 Regeneruj token', 'Stary link przestanie działać. Kontynuować?')))
    return;
  try {
    await propertiesApi.regenerateToken(selectedPropertyId.value);
    // Reload properties to get updated URL
    await loadProperties();
    showToast('Token wygenerowany ✓');
  } catch (e: any) {
    showToast(e.message || 'Błąd regeneracji', 'error');
  }
}

// ── Property selection ────────────────────────────────────
function selectProperty(id: string) {
  selectedPropertyId.value = id;
  nextTick(() => calendarRef.value?.getApi().refetchEvents());
}

// ── Init ──────────────────────────────────────────────────
onMounted(async () => {
  await Promise.all([loadProperties(), configStore.fetchSettings()]);
  nextTick(() => calendarRef.value?.getApi().refetchEvents());
});
</script>

<template>
  <div>
    <!-- Property selector -->
    <div class="prop-tabs-header">Nieruchomość</div>
    <div class="prop-tabs">
      <button
        v-for="p in properties"
        :key="p.id"
        :class="['prop-tab', selectedPropertyId === p.id ? 'active' : '']"
        @click="selectProperty(p.id)"
      >
        <span class="prop-tab-name">{{ p.displayName }}</span>
        <span class="prop-tab-meta">
          <span v-if="p.groupName" class="prop-tab-group">📁 {{ p.groupName }}</span>
          <span v-if="p.sourcesCount" class="prop-tab-sources">{{ p.sourcesCount }} źródeł</span>
        </span>
      </button>
    </div>

    <!-- Calendar -->
    <div class="calendar-container">
      <FullCalendar ref="calendarRef" :options="calendarOptions" />
    </div>

    <!-- Legend -->
    <div class="calendar-legend">
      <span class="legend-item"><span class="legend-dot bookingcom"></span>Booking.com</span>
      <span class="legend-item"><span class="legend-dot airbnb"></span>Airbnb</span>
      <span class="legend-item"><span class="legend-dot expedia"></span>Expedia</span>
      <span class="legend-item"><span class="legend-dot vrbo"></span>VRBO</span>
      <span class="legend-item"><span class="legend-dot tripadvisor"></span>TripAdvisor</span>
      <span class="legend-item"><span class="legend-dot other"></span>Inne</span>
      <span class="legend-item"><span class="legend-dot block"></span>Blokada</span>
      <span v-if="configStore.settings.showHolidays" class="legend-item"><span class="legend-dot holiday"></span>Święto</span>
    </div>

    <!-- iCal Feed section (admin only) -->
    <div v-if="isAdmin && selectedProperty" class="feed-section">
      <h3>🔗 Feed iCal (eksport do Booking.com / Airbnb)</h3>
      <div class="feed-url-row">
        <div class="feed-url">{{ selectedProperty.exportUrl || '—' }}</div>
        <button class="btn btn-primary" @click="copyFeedUrl">Kopiuj link</button>
        <button class="btn btn-warning" @click="regenerateToken">Regeneruj link</button>
      </div>
      <div class="feed-hint">
        Wklej ten adres w Booking.com → Zewnętrzny kalendarz → Importuj<br />
        lub w Airbnb → Kalendarz → Eksportuj i Importuj → Import kalendarza
      </div>
    </div>

    <!-- Create block modal -->
    <div
      v-if="createModal.show"
      class="modal-overlay active"
      @click.self="createModal.show = false"
    >
      <div class="modal">
        <h3>🔒 Nowa blokada</h3>
        <label>Data rozpoczęcia</label>
        <input type="date" v-model="createModal.start" />
        <label>Data zakończenia</label>
        <input type="date" v-model="createModal.end" />
        <label>Powód (opcjonalnie)</label>
        <input type="text" v-model="createModal.reason" placeholder="np. Remont, prywatne..." />
        <div class="modal-actions">
          <button class="btn btn-cancel" @click="createModal.show = false">Anuluj</button>
          <button class="btn btn-danger" @click="createBlock">Zablokuj</button>
        </div>
      </div>
    </div>

    <!-- Edit block modal -->
    <div v-if="editModal.show" class="modal-overlay active" @click.self="editModal.show = false">
      <div class="modal">
        <h3>✏️ Edytuj blokadę</h3>
        <div v-if="editModal.hasConflict" class="conflict-warning">
          ⚠️ Ta blokada nakłada się z rezerwacją z zewnętrznej platformy!
        </div>
        <label>Data rozpoczęcia</label>
        <input type="date" v-model="editModal.start" />
        <label>Data zakończenia</label>
        <input type="date" v-model="editModal.end" />
        <label>Powód (opcjonalnie)</label>
        <input type="text" v-model="editModal.reason" placeholder="np. Remont, prywatne..." />
        <div class="modal-actions">
          <button class="btn btn-cancel" @click="editModal.show = false">Anuluj</button>
          <button class="btn btn-danger" @click="deleteBlock">Usuń blokadę</button>
          <button class="btn btn-primary" @click="saveBlock">Zapisz</button>
        </div>
      </div>
    </div>

    <!-- View booking modal (read-only) -->
    <div v-if="viewModal.show" class="modal-overlay active" @click.self="viewModal.show = false">
      <div class="modal">
        <h3>📋 Rezerwacja</h3>
        <div v-if="viewModal.data" class="view-details">
          <div><b>Nieruchomość:</b> {{ viewModal.data.propertyName }}</div>
          <div><b>Przyjazd:</b> {{ fmtDate(viewModal.data.start) }}</div>
          <div><b>Wyjazd:</b> {{ fmtDate(viewModal.data.end) }}</div>
          <div><b>Platforma:</b> {{ srcLabel(viewModal.data.source) }}</div>
          <div><b>Goście:</b> {{ viewModal.data.guests ?? '—' }}</div>
          <div v-if="viewModal.data.notes"><b>Notatki:</b> {{ viewModal.data.notes }}</div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-cancel" @click="viewModal.show = false">Zamknij</button>
        </div>
      </div>
    </div>

    <!-- Conflicts modal -->
    <div
      v-if="conflictsModal.show"
      class="modal-overlay active"
      @click.self="conflictsModal.show = false"
    >
      <div class="modal">
        <h3>{{ conflictsModal.title }}</h3>
        <div v-html="conflictsModal.html" style="font-size: 0.85rem; line-height: 1.8"></div>
        <div class="modal-actions">
          <button class="btn btn-cancel" @click="conflictsModal.show = false">Rozumiem</button>
        </div>
      </div>
    </div>

    <!-- Confirm modal -->
    <div v-if="confirmModal.show" class="modal-overlay active">
      <div class="modal" style="max-width: 380px">
        <h3>{{ confirmModal.title }}</h3>
        <p style="font-size: 0.875rem; color: #94a3b8; line-height: 1.6; margin: 0 0 18px">
          {{ confirmModal.body }}
        </p>
        <div class="modal-actions">
          <button class="btn btn-cancel" @click="confirmCancel">Anuluj</button>
          <button class="btn btn-danger" @click="confirmOk">Potwierdź</button>
        </div>
      </div>
    </div>

    <!-- Toast -->
    <Teleport to="body">
      <div :class="['toast', toast.show ? 'active' : '', toast.type]">{{ toast.message }}</div>
    </Teleport>
  </div>
</template>

<style scoped>
/* Property tabs */
.prop-tabs-header {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.07em;
  color: #4a5568;
  text-transform: uppercase;
  margin-bottom: 8px;
}
.prop-tabs {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
.prop-tab {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  background: #1e2533;
  border: 1px solid #2d3748;
  border-radius: 10px;
  padding: 10px 16px;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s;
  min-width: 130px;
  color: #e2e8f0;
  font-family: inherit;
  font-size: inherit;
}
.prop-tab:hover {
  background: #252e42;
  border-color: #4a5568;
}
.prop-tab.active {
  background: rgba(66, 153, 225, 0.08);
  border-color: #4299e1;
  box-shadow: 0 0 0 1px rgba(66, 153, 225, 0.18);
}
.prop-tab-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: #e2e8f0;
}
.prop-tab.active .prop-tab-name {
  color: #63b3ed;
}
.prop-tab-meta {
  display: flex;
  gap: 6px;
  align-items: center;
}
.prop-tab-group {
  font-size: 0.72rem;
  color: #718096;
}
.prop-tab-sources {
  font-size: 0.72rem;
  color: #4a5568;
}

/* Calendar container */
.calendar-container {
  background: #1a1f2e;
  border: 1px solid #2d3748;
  border-radius: 10px;
  padding: 16px;
}

/* FullCalendar dark theme overrides */
:deep(.fc) {
  color: #e2e8f0;
}
:deep(.fc .fc-toolbar-title) {
  font-size: 1.1rem;
  color: #e2e8f0;
}
:deep(.fc .fc-button) {
  background: #2d3748;
  border-color: #4a5568;
  color: #e2e8f0;
  font-size: 0.82rem;
}
:deep(.fc .fc-button:hover) {
  background: #3d4a5f;
}
:deep(.fc .fc-button-primary:not(:disabled).fc-button-active),
:deep(.fc .fc-button-primary:not(:disabled):active) {
  background: #4299e1;
  border-color: #4299e1;
}
:deep(.fc .fc-col-header-cell) {
  background: #1a1f2e;
}
:deep(.fc .fc-col-header-cell-cushion) {
  color: #94a3b8;
  font-size: 0.8rem;
  padding: 6px;
}
:deep(.fc .fc-daygrid-day) {
  background: #0f1117;
}
:deep(.fc .fc-daygrid-day:hover) {
  background: #1a1f2e;
}
:deep(.fc .fc-daygrid-day-number) {
  color: #94a3b8;
  font-size: 0.82rem;
  padding: 4px 6px;
}
:deep(.fc .fc-day-today) {
  background: rgba(66, 153, 225, 0.08) !important;
}
:deep(.fc .fc-day-today .fc-daygrid-day-number) {
  color: #4299e1;
  font-weight: 600;
}
:deep(.fc .fc-scrollgrid) {
  border-color: #2d3748;
}
:deep(.fc .fc-scrollgrid td),
:deep(.fc .fc-scrollgrid th) {
  border-color: #2d3748;
}
:deep(.fc .fc-daygrid-event) {
  border-radius: 4px;
  font-size: 0.75rem;
  padding: 1px 4px;
  cursor: pointer;
  border: none;
}
:deep(.fc .fc-highlight) {
  background: rgba(66, 153, 225, 0.2);
}
:deep(.fc .fc-daygrid-more-link) {
  color: #4299e1;
  font-size: 0.75rem;
}

/* Half-day visual */
:deep(.fc-daygrid-event-harness) {
  box-sizing: border-box !important;
}
:deep(.fc-daygrid-event-harness .fc-daygrid-event) {
  min-width: 4px;
}

/* Event colors */
:deep(.event-booking-bookingcom) {
  background: #1a4a8a !important;
  border-left: 3px solid #4299e1 !important;
}
:deep(.event-booking-airbnb) {
  background: #7c2323 !important;
  border-left: 3px solid #f56565 !important;
}
:deep(.event-booking-expedia) {
  background: #5c4a00 !important;
  border-left: 3px solid #ecc94b !important;
}
:deep(.event-booking-vrbo) {
  background: #1a5c3a !important;
  border-left: 3px solid #48bb78 !important;
}
:deep(.event-booking-tripadvisor) {
  background: #1a4a4a !important;
  border-left: 3px solid #38b2ac !important;
}
:deep(.event-booking-other) {
  background: #2d3748 !important;
  border-left: 3px solid #a0aec0 !important;
}
:deep(.event-block) {
  background: #742a2a !important;
  border-left: 3px solid #fc8181 !important;
}
:deep(.event-block-conflict) {
  background: #744210 !important;
  border-left: 3px solid #f6ad55 !important;
}
:deep(.event-holiday-bg) {
  background: rgba(245, 158, 11, 0.12) !important;
  border: none !important;
}
:deep(.fc-bg-event.event-holiday-bg .fc-event-title) {
  font-size: 0.65rem;
  color: #fbbf24;
  padding: 1px 4px;
  font-weight: 600;
  opacity: 0.85;
}

/* Legend */
.calendar-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
  margin-top: 12px;
  padding: 10px 14px;
  background: #1a1f2e;
  border: 1px solid #2d3748;
  border-radius: 8px;
  font-size: 0.78rem;
  color: #94a3b8;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.legend-dot {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  flex-shrink: 0;
}
.legend-dot.bookingcom {
  background: #4299e1;
}
.legend-dot.airbnb {
  background: #f56565;
}
.legend-dot.expedia {
  background: #ecc94b;
}
.legend-dot.vrbo {
  background: #48bb78;
}
.legend-dot.tripadvisor {
  background: #38b2ac;
}
.legend-dot.other {
  background: #a0aec0;
}
.legend-dot.block {
  background: #fc8181;
}
.legend-dot.holiday {
  background: rgba(245, 158, 11, 0.6);
  border: 1px solid #f59e0b;
}

/* Feed section */
.feed-section {
  margin-top: 24px;
  background: #1a1f2e;
  border: 1px solid #2d3748;
  border-radius: 10px;
  padding: 16px 20px;
}
.feed-section h3 {
  margin: 0 0 12px;
  font-size: 1rem;
  color: #e2e8f0;
}
.feed-url-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.feed-url {
  flex: 1;
  min-width: 200px;
  background: #0f1117;
  border: 1px solid #2d3748;
  border-radius: 6px;
  padding: 6px 10px;
  color: #94a3b8;
  font-size: 0.82rem;
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.feed-hint {
  margin-top: 8px;
  font-size: 0.78rem;
  color: #718096;
}

/* Buttons */
.btn {
  border-radius: 6px;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 0.85rem;
  border: 1px solid transparent;
  transition: opacity 0.15s;
}
.btn:hover {
  opacity: 0.85;
}
.btn-primary {
  background: #2b6cb0;
  color: #e2e8f0;
  border-color: #4299e1;
}
.btn-danger {
  background: rgba(229, 62, 62, 0.15);
  color: #fc8181;
  border-color: rgba(229, 62, 62, 0.4);
}
.btn-warning {
  background: rgba(237, 137, 54, 0.2);
  color: #f6ad55;
  border-color: rgba(237, 137, 54, 0.4);
}
.btn-cancel {
  background: transparent;
  color: #718096;
  border-color: #4a5568;
}

/* Modals */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal {
  background: #1e2533;
  border: 1px solid #2d3748;
  border-radius: 12px;
  padding: 24px;
  width: 100%;
  max-width: 420px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
.modal h3 {
  margin: 0 0 16px;
  font-size: 1rem;
  color: #e2e8f0;
}
.modal label {
  display: block;
  font-size: 0.82rem;
  color: #94a3b8;
  margin-bottom: 4px;
}
.modal input[type='date'],
.modal input[type='text'] {
  width: 100%;
  background: #0f1117;
  border: 1px solid #2d3748;
  border-radius: 6px;
  padding: 8px 10px;
  color: #e2e8f0;
  font-size: 0.9rem;
  margin-bottom: 12px;
  box-sizing: border-box;
}
.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 4px;
}
.conflict-warning {
  background: rgba(237, 137, 54, 0.1);
  border: 1px solid rgba(237, 137, 54, 0.4);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 0.82rem;
  color: #f6ad55;
  margin-bottom: 12px;
}
.view-details {
  font-size: 0.9rem;
  line-height: 1.7;
  color: #94a3b8;
}

/* Toast */
.toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  background: #1a1f2e;
  border: 1px solid #2d3748;
  border-radius: 8px;
  padding: 12px 18px;
  font-size: 0.85rem;
  color: #e2e8f0;
  z-index: 2000;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  opacity: 0;
  transform: translateY(10px);
  transition: all 0.3s;
  pointer-events: none;
  max-width: 320px;
}
.toast.active {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}
.toast.success {
  border-left: 3px solid #68d391;
}
.toast.error {
  border-left: 3px solid #fc8181;
}

@media (max-width: 430px) {
  .prop-tab {
    min-width: 0;
    flex: 1 1 calc(50% - 5px);
    padding: 8px 10px;
  }

  .prop-tab-name {
    font-size: 0.82rem;
  }

  .calendar-legend {
    gap: 8px 14px;
    padding: 8px 10px;
    font-size: 0.72rem;
  }

  .feed-section {
    padding: 12px 14px;
  }

  .feed-url {
    min-width: 0;
    width: 100%;
    font-size: 0.75rem;
  }

  .feed-url-row .btn {
    flex: 1;
    text-align: center;
  }

  .feed-hint {
    font-size: 0.72rem;
  }

  .toast {
    bottom: 16px;
    right: 12px;
    left: 12px;
    max-width: none;
  }
}
</style>
