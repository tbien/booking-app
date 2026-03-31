<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useBookingsStore } from '../stores/bookings';
import { useConfigStore } from '../stores/config';
import { useAuthStore } from '../stores/auth';
import { bookingsApi } from '../api/bookings';
import { syncApi } from '../api/sync';
import { useDebouncedSave, useInfiniteScroll } from '../composables/utils';
import type { BookingDto, ResolveConflictDto } from '../types/api';

const auth = useAuthStore();
const store = useBookingsStore();
const config = useConfigStore();

const isAdmin = computed(() => auth.isAdmin);

// ── Sync ──────────────────────────────────────────────────
const syncing = ref(false);
const backgroundSyncing = ref(false);
const syncProgress = ref({ show: false, percentage: 0, message: '' });

function updateProgress(pct: number, msg: string) {
  syncProgress.value = { show: true, percentage: pct, message: msg };
}

async function handleSync(showProgress = true, fromDate?: string, toDate?: string, force = false) {
  if (!isAdmin.value || syncing.value) return;
  syncing.value = true;
  try {
    if (showProgress) updateProgress(30, 'Synchronizacja rezerwacji...');
    const result = await syncApi.sync({
      from: fromDate || store.filterParams.from,
      to: toDate || store.filterParams.to,
      groupId: selectedGroup.value || undefined,
      force: showProgress || force || undefined,
    });
    if (showProgress) {
      updateProgress(70, 'Odświeżanie danych...');
      await store.fetchBookings();
      updateProgress(100, 'Synchronizacja zakończona!');
      setTimeout(() => (syncProgress.value.show = false), 2000);
      setTimeout(() => {
        syncModal.value = {
          show: true,
          title: 'Synchronizacja zakończona!',
          message: result.message,
          stats: result.stats,
        };
      }, 2100);
    }
    if (result.conflicts?.length) {
      conflictModal.value = { show: true, conflicts: result.conflicts as any[], resolved: {} };
    }
  } catch (e: any) {
    if (showProgress) {
      updateProgress(0, 'Błąd synchronizacji');
      setTimeout(() => (syncProgress.value.show = false), 2000);
    }
  } finally {
    syncing.value = false;
  }
}

async function syncNow() {
  const now = new Date();
  const oneYear = new Date(now);
  oneYear.setFullYear(now.getFullYear() + 1);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const syncTo = store.filterParams.to > fmt(oneYear) ? store.filterParams.to : fmt(oneYear);
  await handleSync(true, undefined, syncTo);
}

// ── Groups / Filter ───────────────────────────────────────
const selectedGroup = ref('');
const selectedApartments = ref<string[]>([]);
const showApartmentDropdown = ref(false);
const showCancelled = ref(false);
const changingMonth = ref(false);

const apartmentNames = computed(() => {
  const names = store.rows.map((r) => r.propertyName);
  return [...new Set(names)].sort();
});

const filteredRows = computed(() => {
  let filtered = store.rows;
  if (selectedGroup.value) {
    filtered = filtered.filter((r) => r.groupId === selectedGroup.value);
  }
  if (selectedApartments.value.length) {
    filtered = filtered.filter((r) => selectedApartments.value.includes(r.propertyName));
  }
  const key = store.filterParams.sortBy === 'start' ? 'start' : 'end';
  return [...filtered].sort((a, b) => new Date(a[key]).getTime() - new Date(b[key]).getTime());
});

const newBookingsCount = computed(() => filteredRows.value.filter((r) => r.isNew).length);

const currentSummary = computed(() => {
  const count = filteredRows.value.length;
  const props = new Set(filteredRows.value.map((r) => r.propertyName));
  let s = `${count} rezerwacji`;
  if (props.size) s += `, ${props.size} nieruchomości`;
  if (isAdmin.value) {
    const costMap = new Map(config.properties.map((p) => [p.displayName, p.cleaningCost]));
    let total = 0;
    filteredRows.value.forEach((r) => (total += costMap.get(r.propertyName) || 0));
    if (total) s += `, ${total} PLN`;
  }
  return s;
});

// Month navigation
async function navigateMonth(delta: number) {
  changingMonth.value = true;
  try {
    store.setMonthDates(store.currentMonthOffset + delta);
    await store.fetchBookings();
    if (isAdmin.value) {
      backgroundSyncing.value = true;
      await handleSync(false, store.filterParams.from, store.filterParams.to, true);
      await store.fetchBookings();
      backgroundSyncing.value = false;
    }
  } finally {
    changingMonth.value = false;
  }
}

async function setCurrentMonth() {
  changingMonth.value = true;
  try {
    store.setMonthDates(0);
    await store.fetchBookings();
    if (isAdmin.value) {
      backgroundSyncing.value = true;
      await handleSync(false, store.filterParams.from, store.filterParams.to, true);
      await store.fetchBookings();
      backgroundSyncing.value = false;
    }
  } finally {
    changingMonth.value = false;
  }
}

function toggleApartment(name: string) {
  const i = selectedApartments.value.indexOf(name);
  if (i > -1) selectedApartments.value.splice(i, 1);
  else selectedApartments.value.push(name);
}

// ── Inline editing (guests / notes) ──────────────────────
const { saving, save } = useDebouncedSave();

function updateGuests(row: BookingDto) {
  save(() => store.patchBooking(row.id, { guests: row.guests }));
}
function updateNotes(row: BookingDto) {
  save(() => store.patchBooking(row.id, { notes: row.notes }));
}

// ── Merge mode ────────────────────────────────────────────
const editMode = ref(false);
const selectedForMerge = ref<string[]>([]);
const editError = ref('');
const editLoading = ref(false);

function toggleEditMode() {
  editMode.value = !editMode.value;
  selectedForMerge.value = [];
  editError.value = '';
}

function toggleSelectForMerge(row: BookingDto) {
  const i = selectedForMerge.value.indexOf(row.id);
  if (i > -1) selectedForMerge.value.splice(i, 1);
  else selectedForMerge.value.push(row.id);
}

const toLocal = (d: string) => new Date(d).toLocaleDateString('sv-SE');

const canMerge = computed(() => {
  if (selectedForMerge.value.length < 2) return false;
  const rows = selectedForMerge.value
    .map((id) => store.rows.find((r) => r.id === id))
    .filter(Boolean) as BookingDto[];
  if (rows.length < 2) return false;
  if (rows.some((r) => r.propertyName !== rows[0].propertyName)) return false;
  // Sort by start date and check each pair is adjacent
  const sorted = [...rows].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  for (let i = 0; i < sorted.length - 1; i++) {
    if (toLocal(sorted[i].end) !== toLocal(sorted[i + 1].start)) return false;
  }
  return true;
});

async function mergeSelected() {
  editError.value = '';
  editLoading.value = true;
  try {
    await bookingsApi.merge({ ids: selectedForMerge.value });
    selectedForMerge.value = [];
    await store.fetchBookings();
  } catch (e: any) {
    editError.value = e.message;
  } finally {
    editLoading.value = false;
  }
}

// ── Edit drawer ───────────────────────────────────────────
const editDrawer = ref<{ open: boolean; row: BookingDto | null }>({ open: false, row: null });
const drawerTab = ref<'info' | 'split' | 'undo'>('info');
const drawerSplitDate = ref('');
const drawerError = ref('');
const drawerLoading = ref(false);

function openDrawer(row: BookingDto) {
  editDrawer.value = { open: true, row: { ...row } };
  drawerTab.value = 'info';
  drawerError.value = '';
  drawerSplitDate.value = '';
}
function closeDrawer() {
  editDrawer.value = { open: false, row: null };
}

const drawerSplitMin = computed(() => {
  if (!editDrawer.value.row) return '';
  const d = new Date(editDrawer.value.row.start);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
});
const drawerSplitMax = computed(() => {
  if (!editDrawer.value.row) return '';
  const d = new Date(editDrawer.value.row.end);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
});

async function drawerConfirmSplit() {
  if (!editDrawer.value.row || !drawerSplitDate.value) return;
  drawerLoading.value = true;
  drawerError.value = '';
  try {
    await bookingsApi.split({ id: editDrawer.value.row.id, splitDate: drawerSplitDate.value });
    closeDrawer();
    await store.fetchBookings();
  } catch (e: any) {
    drawerError.value = e.message;
  } finally {
    drawerLoading.value = false;
  }
}

async function drawerUndoManual() {
  const row = editDrawer.value.row;
  if (!row) return;
  drawerLoading.value = true;
  drawerError.value = '';
  try {
    if (row.manualType === 'merged') await bookingsApi.undoMerge(row.id);
    else await bookingsApi.undoSplit(row.id);
    closeDrawer();
    await store.fetchBookings();
  } catch (e: any) {
    drawerError.value = e.message;
  } finally {
    drawerLoading.value = false;
  }
}

// ── Sync result modal ─────────────────────────────────────
const syncModal = ref<{ show: boolean; title: string; message: string; stats: any }>({
  show: false,
  title: '',
  message: '',
  stats: null,
});

// ── Delete cancelled ──────────────────────────────────────
const deleting = ref(false);
const deleteConfirm = ref(false);

const cancelledCount = computed(
  () => filteredRows.value.filter((r) => r.cancellationStatus === 'cancelled').length,
);

async function deleteCancelledBookings() {
  if (!deleteConfirm.value) {
    deleteConfirm.value = true;
    return;
  }
  deleting.value = true;
  try {
    const ids = filteredRows.value
      .filter((r) => r.cancellationStatus === 'cancelled')
      .map((r) => r.id);
    await bookingsApi.deleteCancelled(ids);
    deleteConfirm.value = false;
    showCancelled.value = false;
    await store.fetchBookings();
  } catch (e: any) {
    editError.value = e.message;
  } finally {
    deleting.value = false;
  }
}

async function deleteSingleCancelled(id: string) {
  try {
    await bookingsApi.deleteCancelled([id]);
    await store.fetchBookings();
  } catch (e: any) {
    editError.value = e.message;
  }
}

// ── Conflict modal ────────────────────────────────────────
const conflictModal = ref<{ show: boolean; conflicts: any[]; resolved: Record<string, string> }>({
  show: false,
  conflicts: [],
  resolved: {},
});

async function resolveAllConflicts() {
  editLoading.value = true;
  try {
    for (const c of conflictModal.value.conflicts) {
      const decision = conflictModal.value.resolved[c.manualBooking.id] || 'keep';
      await bookingsApi.resolveConflict({
        manualId: c.manualBooking.id,
        decision,
      } as ResolveConflictDto);
    }
    conflictModal.value.show = false;
    await store.fetchBookings();
  } catch (e: any) {
    editError.value = e.message;
  } finally {
    editLoading.value = false;
  }
}

// ── Infinite scroll ───────────────────────────────────────
const { sentinel } = useInfiniteScroll(() => {
  if (store.meta.hasMore && !store.loading) store.loadMore();
});

// ── Date formatting helper ────────────────────────────────
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// ── Watchers ──────────────────────────────────────────────
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
watch([() => store.filterParams.from, () => store.filterParams.to, showCancelled], () => {
  if (changingMonth.value) return;
  store.filterParams.includeCancelled = showCancelled.value;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    store.filterParams.page = 1;
    store.fetchBookings();
  }, 300);
});

// ── Init ──────────────────────────────────────────────────
onMounted(async () => {
  store.initDates();
  await Promise.all([store.fetchBookings(), config.fetchAll()]);
  // Apply default group from settings
  if (config.settings.defaultGroupId) {
    selectedGroup.value = config.settings.defaultGroupId;
  }
  // Background auto-sync
  if (isAdmin.value) {
    await handleSync(false);
  }
});
</script>

<template>
  <div>
    <!-- Sync progress bar -->
    <div v-if="syncProgress.show" class="sync-progress-bar">
      <div class="progress-container">
        <p class="progress-message">{{ syncProgress.message }}</p>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: syncProgress.percentage + '%' }"></div>
        </div>
        <span class="progress-pct">{{ syncProgress.percentage }}%</span>
      </div>
    </div>

    <h1>Rezerwacje</h1>

    <!-- Group toolbar -->
    <div class="toolbar">
      <button :class="['group-btn', !selectedGroup ? 'active' : '']" @click="selectedGroup = ''">
        Wszystkie
      </button>
      <button
        v-for="g in config.groups"
        :key="g.id"
        :class="['group-btn', selectedGroup === g.id ? 'active' : '']"
        @click="selectedGroup = g.id"
      >
        {{ g.name }} <span class="group-count">({{ g.propertyCount }} obj.)</span>
      </button>
    </div>

    <p class="summary-line">
      Podsumowanie: {{ currentSummary }}
      <span v-if="newBookingsCount" class="new-badge">{{ newBookingsCount }} nowych</span>
      <small v-if="backgroundSyncing" class="bg-sync-label">synchronizacja w tle...</small>
    </p>

    <!-- Main toolbar -->
    <div class="main-toolbar">
      <div class="toolbar-section">
        <div class="filter-group">
          <label>Sortuj po:</label>
          <select v-model="store.filterParams.sortBy" class="filter-select">
            <option value="start">przyjeździe</option>
            <option value="end">wyjeździe</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Od:</label>
          <input type="date" v-model="store.filterParams.from" class="filter-input" />
        </div>
        <div class="filter-group">
          <label>Do:</label>
          <input type="date" v-model="store.filterParams.to" class="filter-input" />
        </div>
      </div>

      <div class="toolbar-section">
        <div class="button-group">
          <button class="action-button" :disabled="changingMonth" @click="navigateMonth(-1)">
            {{ changingMonth ? '⏳' : '◀ Poprzedni' }}
          </button>
          <button class="action-button primary" :disabled="changingMonth" @click="setCurrentMonth">
            {{ changingMonth ? 'Ładuję...' : 'Aktualny' }}
          </button>
          <button class="action-button" :disabled="changingMonth" @click="navigateMonth(1)">
            {{ changingMonth ? '⏳' : 'Następny ▶' }}
          </button>
        </div>
        <div class="month-label">{{ store.displayedMonthLabel }}</div>
      </div>

      <div class="toolbar-section">
        <div class="button-group">
          <button
            :class="['action-button', showCancelled ? 'active' : '']"
            @click="
              showCancelled = !showCancelled;
              deleteConfirm = false;
            "
          >
            {{ showCancelled ? 'Ukryj anulowane' : 'Pokaż anulowane' }}
          </button>
          <button
            v-if="isAdmin && showCancelled && cancelledCount > 0"
            :disabled="deleting"
            :class="['action-button', 'delete-btn', deleteConfirm ? 'confirm' : '']"
            @click="deleteCancelledBookings"
          >
            {{
              deleting
                ? 'Usuwam...'
                : deleteConfirm
                  ? `Na pewno usunąć ${cancelledCount}?`
                  : `🗑 Usuń anulowane (${cancelledCount})`
            }}
          </button>
          <button
            :class="['action-button', store.filterParams.filterMode === 'overlap' ? 'active' : '']"
            @click="
              store.filterParams.filterMode =
                store.filterParams.filterMode === 'overlap' ? 'sortBy' : 'overlap'
            "
          >
            {{ store.filterParams.filterMode === 'overlap' ? '📅 Wszystkie' : '📅 Według daty' }}
          </button>
          <button v-if="isAdmin" :disabled="syncing" class="action-button sync" @click="syncNow">
            {{ syncing ? 'Synchronizuję...' : 'Synchronizuj iCal' }}
          </button>
          <button
            v-if="isAdmin"
            :class="['action-button merge-toggle-btn', editMode ? 'active' : '']"
            @click="toggleEditMode"
          >
            {{ editMode ? '✕ Zakończ scalanie' : '🔗 Scal rezerwacje' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Merge mode banner -->
    <div v-if="editMode" class="edit-action-bar">
      <span class="edit-mode-label">🔗 Tryb scalania</span>
      <span v-if="selectedForMerge.length === 0" class="edit-hint"
        >Zaznacz 2+ sąsiadujące rezerwacje tej samej nieruchomości</span
      >
      <span v-else-if="selectedForMerge.length === 1" class="edit-hint"
        >Zaznacz jeszcze co najmniej jedną ({{ selectedForMerge.length }} zaznaczona)</span
      >
      <span v-else-if="selectedForMerge.length >= 2 && !canMerge" class="edit-hint edit-hint-warn"
        >⚠️ Rezerwacje muszą być sąsiadujące i tej samej nieruchomości</span
      >
      <button
        v-if="canMerge"
        :disabled="editLoading"
        class="action-button merge-btn"
        @click="mergeSelected"
      >
        {{ editLoading ? 'Scalam...' : '🔗 Scal zaznaczone' }}
      </button>
      <span v-if="editError" class="edit-error">❌ {{ editError }}</span>
    </div>

    <!-- Property filter dropdown -->
    <div class="apartment-dropdown-container">
      <div
        class="apartment-select-trigger"
        tabindex="0"
        @click="showApartmentDropdown = !showApartmentDropdown"
        @blur="showApartmentDropdown = false"
      >
        <span v-if="!selectedApartments.length" class="placeholder">Filtruj nieruchomości</span>
        <span v-else>
          <span v-for="apt in selectedApartments" :key="apt" class="chip">
            {{ apt }}
            <button @click.stop="selectedApartments = selectedApartments.filter((a) => a !== apt)">
              ×
            </button>
          </span>
        </span>
        <span class="arrow">▼</span>
      </div>
      <div v-if="showApartmentDropdown" class="apartment-dropdown" @mousedown.prevent>
        <label
          v-for="name in apartmentNames"
          :key="name"
          class="apartment-option"
          @click.prevent="toggleApartment(name)"
        >
          <input type="checkbox" :checked="selectedApartments.includes(name)" @click.prevent />
          {{ name }}
        </label>
      </div>
    </div>

    <!-- Bookings table -->
    <div class="card">
      <div v-if="store.loading && !store.rows.length">Ładowanie...</div>
      <div v-else-if="store.error">Błąd: {{ store.error }}</div>
      <div v-else>
        <div style="overflow-x: auto">
          <table>
            <thead>
              <tr>
                <th v-if="editMode"></th>
                <th>Nieruchomość</th>
                <th>Check-in</th>
                <th>Check-out</th>
                <th>Status wyjazdu</th>
                <th>Liczba gości</th>
                <th>Notatki</th>
                <th class="muted">Opis</th>
                <th v-if="isAdmin" class="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in filteredRows"
                :key="r.id"
                :class="{
                  'new-booking': r.isNew,
                  'cancelled-booking': r.cancellationStatus === 'cancelled',
                  'manual-booking': r.isManual,
                  'selected-for-merge': selectedForMerge.includes(r.id),
                }"
              >
                <td v-if="editMode" class="merge-checkbox-cell">
                  <input
                    v-if="
                      r.cancellationStatus !== 'cancelled' &&
                      (!r.isManual || r.manualType === 'block')
                    "
                    type="checkbox"
                    :checked="selectedForMerge.includes(r.id)"
                    class="merge-checkbox"
                    @change="toggleSelectForMerge(r)"
                  />
                </td>
                <td>
                  {{ r.propertyName }}
                  <span v-if="r.isNew" class="new-badge">NOWE</span>
                  <span v-if="r.isStartingToday" class="arrival-today-badge">PRZYJAZD</span>
                  <span v-if="r.cancellationStatus === 'cancelled'" class="cancelled-badge"
                    >🚫 ANULOWANA</span
                  >
                  <span
                    v-if="r.isManual && r.manualType === 'merged'"
                    class="manual-badge merged-badge"
                    >🔀 SCALONE</span
                  >
                  <span
                    v-if="r.isManual && r.manualType === 'split'"
                    class="manual-badge split-badge"
                    >✂ PODZIELONE</span
                  >
                </td>
                <td>{{ fmtDate(r.start) }}</td>
                <td>{{ fmtDate(r.end) }}</td>
                <td>
                  <span :class="['badge', r.isUrgentChangeover ? 'badge-pilne' : 'badge-normalne']">
                    {{ r.isUrgentChangeover ? 'PILNE' : 'NORMALNE' }}
                  </span>
                </td>
                <td>
                  <input
                    v-if="isAdmin"
                    class="input input-small"
                    type="number"
                    min="0"
                    max="20"
                    v-model.number="r.guests"
                    @input="updateGuests(r)"
                  />
                  <span v-else>{{ r.guests ?? '' }}</span>
                </td>
                <td>
                  <input
                    v-if="isAdmin"
                    class="input input-medium"
                    type="text"
                    v-model="r.notes"
                    @input="updateNotes(r)"
                  />
                  <span v-else>{{ r.notes }}</span>
                </td>
                <td class="muted opis-cell">{{ r.description }}</td>
                <td v-if="isAdmin" class="col-actions">
                  <button class="row-edit-btn" title="Edytuj rezerwację" @click="openDrawer(r)">
                    ✏️
                  </button>
                  <button
                    v-if="r.cancellationStatus === 'cancelled'"
                    class="row-delete-btn"
                    title="Usuń anulowaną rezerwację"
                    @click="deleteSingleCancelled(r.id)"
                  >
                    🗑
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="footer">
          Wskazówka: Status wyjazdu = "PILNE" oznacza przyjazd tego samego dnia.
          <span v-if="saving" class="saving-indicator">Zapisuję...</span>
        </div>
        <div ref="sentinel" class="sentinel-element"></div>
        <div v-if="store.meta.hasMore" style="text-align: center; margin-top: 12px">
          <button class="load-more-btn" :disabled="store.loading" @click="store.loadMore()">
            {{ store.loading ? 'Ładuję...' : 'Załaduj więcej' }} ({{ store.rows.length }} /
            {{ store.meta.total }})
          </button>
        </div>
      </div>
    </div>

    <!-- Edit Drawer -->
    <Transition name="drawer">
      <div v-if="editDrawer.open" class="drawer-overlay" @click.self="closeDrawer">
        <div class="drawer-panel">
          <div class="drawer-header">
            <div class="drawer-title">
              <span class="drawer-property">{{ editDrawer.row?.propertyName }}</span>
              <span class="drawer-dates">{{
                editDrawer.row
                  ? fmtDate(editDrawer.row.start) + ' – ' + fmtDate(editDrawer.row.end)
                  : ''
              }}</span>
            </div>
            <button class="drawer-close" @click="closeDrawer">✕</button>
          </div>

          <div class="drawer-tabs">
            <button
              :class="['drawer-tab', drawerTab === 'info' ? 'active' : '']"
              @click="drawerTab = 'info'"
            >
              📋 Szczegóły
            </button>
            <button
              v-if="
                editDrawer.row &&
                editDrawer.row.cancellationStatus !== 'cancelled' &&
                (!editDrawer.row.isManual || editDrawer.row.manualType === 'block')
              "
              :class="['drawer-tab', drawerTab === 'split' ? 'active' : '']"
              @click="drawerTab = 'split'"
            >
              ✂ Podziel
            </button>
            <button
              v-if="
                editDrawer.row?.isManual &&
                (editDrawer.row.manualType === 'merged' || editDrawer.row.manualType === 'split')
              "
              :class="['drawer-tab', drawerTab === 'undo' ? 'active' : '']"
              @click="drawerTab = 'undo'"
            >
              ↩ Cofnij
            </button>
          </div>

          <div class="drawer-body">
            <!-- Info tab -->
            <div v-if="drawerTab === 'info'" class="drawer-section">
              <div class="drawer-field">
                <label class="drawer-label">Status wyjazdu</label>
                <span
                  :class="[
                    'badge',
                    editDrawer.row?.isUrgentChangeover ? 'badge-pilne' : 'badge-normalne',
                  ]"
                >
                  {{ editDrawer.row?.isUrgentChangeover ? 'PILNE' : 'NORMALNE' }}
                </span>
              </div>
              <div class="drawer-field">
                <label class="drawer-label">Liczba gości</label>
                <input
                  class="input drawer-input"
                  type="number"
                  min="0"
                  max="20"
                  v-model.number="editDrawer.row!.guests"
                  @input="updateGuests(editDrawer.row!)"
                />
              </div>
              <div class="drawer-field">
                <label class="drawer-label">Notatki</label>
                <input
                  class="input drawer-input"
                  type="text"
                  v-model="editDrawer.row!.notes"
                  placeholder="Dodaj notatkę…"
                  @input="updateNotes(editDrawer.row!)"
                />
              </div>
              <div v-if="editDrawer.row?.description" class="drawer-field">
                <label class="drawer-label">Opis (z platformy)</label>
                <p class="drawer-desc">{{ editDrawer.row.description }}</p>
              </div>
              <div class="drawer-field">
                <label class="drawer-label">Źródło</label>
                <span class="drawer-value muted">{{ editDrawer.row?.source || 'manual' }}</span>
              </div>
            </div>

            <!-- Split tab -->
            <div v-if="drawerTab === 'split'" class="drawer-section">
              <p class="drawer-hint">Podziel rezerwację na dwie osobne. Wybierz datę podziału.</p>
              <div class="drawer-field">
                <label class="drawer-label">Data podziału</label>
                <input
                  type="date"
                  v-model="drawerSplitDate"
                  :min="drawerSplitMin"
                  :max="drawerSplitMax"
                  class="input drawer-input"
                />
              </div>
              <div v-if="drawerSplitDate" class="split-preview">
                <div class="split-preview-item">
                  <span class="split-preview-label">Część 1</span
                  ><span
                    >{{ editDrawer.row ? fmtDate(editDrawer.row.start) : '' }} →
                    {{ drawerSplitDate }}</span
                  >
                </div>
                <div class="split-preview-item">
                  <span class="split-preview-label">Część 2</span
                  ><span
                    >{{ drawerSplitDate }} →
                    {{ editDrawer.row ? fmtDate(editDrawer.row.end) : '' }}</span
                  >
                </div>
              </div>
              <span v-if="drawerError" class="edit-error">❌ {{ drawerError }}</span>
              <div class="drawer-actions">
                <button
                  :disabled="drawerLoading || !drawerSplitDate"
                  class="action-button primary drawer-action-btn"
                  @click="drawerConfirmSplit"
                >
                  {{ drawerLoading ? 'Dzielę...' : '✂ Podziel' }}
                </button>
              </div>
            </div>

            <!-- Undo tab -->
            <div v-if="drawerTab === 'undo'" class="drawer-section">
              <p class="drawer-hint">
                Ta rezerwacja została
                <strong>{{
                  editDrawer.row?.manualType === 'merged' ? 'scalona' : 'podzielona'
                }}</strong>
                ręcznie. Możesz cofnąć tę operację.
              </p>
              <span v-if="drawerError" class="edit-error">❌ {{ drawerError }}</span>
              <div class="drawer-actions">
                <button
                  :disabled="drawerLoading"
                  class="action-button drawer-action-btn undo-action-btn"
                  @click="drawerUndoManual"
                >
                  {{ drawerLoading ? 'Cofam...' : '↩ Cofnij operację' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Sync result modal -->
    <Teleport to="body">
      <div v-if="syncModal.show" class="modal-overlay active" @click="syncModal.show = false">
        <div class="modal-content" @click.stop>
          <div class="modal-header">
            <h3 class="modal-title">{{ syncModal.title }}</h3>
            <button class="modal-close" @click="syncModal.show = false">&times;</button>
          </div>
          <div class="modal-body">
            <p>{{ syncModal.message }}</p>
            <div v-if="syncModal.stats" class="modal-stats">
              <div class="modal-stat">
                <span class="modal-stat-label">Zsynchronizowane nieruchomości:</span
                ><span class="modal-stat-value">{{ syncModal.stats.propertiesSynced }}</span>
              </div>
              <div class="modal-stat">
                <span class="modal-stat-label">Zaktualizowane rezerwacje:</span
                ><span class="modal-stat-value">{{ syncModal.stats.bookingsUpdated }}</span>
              </div>
              <div class="modal-stat">
                <span class="modal-stat-label">Anulowane rezerwacje:</span
                ><span class="modal-stat-value">{{ syncModal.stats.bookingsCancelled }}</span>
              </div>
            </div>
          </div>
          <div class="modal-actions">
            <button class="modal-btn modal-btn-primary" @click="syncModal.show = false">OK</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Conflict modal -->
    <Teleport to="body">
      <div v-if="conflictModal.show" class="modal-overlay active">
        <div class="modal-content modal-content-wide" @click.stop>
          <div class="modal-header">
            <h3 class="modal-title">⚠️ Konflikty synchronizacji</h3>
          </div>
          <div class="modal-body">
            <p style="margin-bottom: 12px">
              Synchronizacja wykryła konflikty z ręcznie edytowanymi rezerwacjami:
            </p>
            <div
              v-for="c in conflictModal.conflicts"
              :key="c.manualBooking.id"
              class="conflict-item"
            >
              <div class="conflict-info">
                <span class="conflict-property">{{ c.manualBooking.propertyName }}</span>
                <span class="conflict-dates"
                  >{{ fmtDate(c.manualBooking.start) }} – {{ fmtDate(c.manualBooking.end) }}</span
                >
                <span
                  :class="[
                    'manual-badge',
                    c.manualBooking.manualType === 'merged' ? 'merged-badge' : 'split-badge',
                  ]"
                >
                  {{ c.manualBooking.manualType === 'merged' ? '🔀 SCALONE' : '✂ PODZIELONE' }}
                </span>
              </div>
              <div class="conflict-actions">
                <button
                  :class="[
                    'action-button',
                    !conflictModal.resolved[c.manualBooking.id] ||
                    conflictModal.resolved[c.manualBooking.id] === 'keep'
                      ? 'primary'
                      : '',
                  ]"
                  @click="conflictModal.resolved[c.manualBooking.id] = 'keep'"
                >
                  ✅ Zachowaj moją
                </button>
                <button
                  :class="[
                    'action-button',
                    conflictModal.resolved[c.manualBooking.id] === 'remove' ? 'active' : '',
                  ]"
                  @click="conflictModal.resolved[c.manualBooking.id] = 'remove'"
                >
                  🗑 Usuń, weź z iCal
                </button>
              </div>
            </div>
          </div>
          <div class="modal-actions">
            <button
              class="modal-btn modal-btn-primary"
              :disabled="editLoading"
              @click="resolveAllConflicts"
            >
              {{ editLoading ? 'Zapisuję...' : 'Zatwierdź decyzje' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.summary-line {
  display: flex;
  align-items: center;
  gap: 10px;
}
.bg-sync-label {
  color: #ffd700;
  margin-left: 8px;
  font-style: italic;
}

/* Toolbar */
.toolbar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.group-btn {
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid var(--border-hover);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.88rem;
  transition: all 0.15s;
}
.group-btn:hover {
  background: var(--bg-hover);
}
.group-btn.active {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.group-count {
  font-size: 0.78rem;
  opacity: 0.75;
}

/* Main toolbar */
.main-toolbar {
  display: flex;
  gap: 24px;
  align-items: center;
  margin-bottom: 16px;
  padding: 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  flex-wrap: wrap;
}
.toolbar-section {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.filter-group {
  display: flex;
  align-items: center;
  gap: 6px;
}
.filter-group label {
  font-size: 14px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.filter-input,
.filter-select {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-hover);
  color: var(--text-primary);
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 14px;
}
.button-group {
  display: flex;
  gap: 8px;
  align-items: center;
}
.month-label {
  margin-top: 6px;
  text-align: center;
  color: #ddd;
  font-size: 0.95rem;
}

/* Action buttons */
.action-button {
  background: #1f2752;
  border: 1px solid var(--border-hover);
  color: var(--text-primary);
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
  white-space: nowrap;
}
.action-button:hover {
  background: var(--border-hover);
}
.action-button.primary {
  background: var(--accent-purple);
  border-color: #6b2d9b;
  font-weight: 600;
}
.action-button.active {
  background: var(--accent-green);
  border-color: #16a34a;
  color: #fff;
}
.action-button.sync {
  background: #2563eb;
  border-color: #1d4ed8;
  font-weight: 600;
}
.action-button.sync:hover {
  background: #1d4ed8;
}
.action-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Merge */
.merge-toggle-btn {
  border-color: rgba(99, 102, 241, 0.4) !important;
  color: #a5b4fc !important;
}
.merge-toggle-btn.active {
  background: rgba(99, 102, 241, 0.2) !important;
}
.edit-action-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px 14px;
  background: rgba(234, 179, 8, 0.08);
  border: 1px solid rgba(234, 179, 8, 0.3);
  border-radius: 8px;
  margin-bottom: 10px;
}
.edit-mode-label {
  font-weight: 600;
  color: #fcd34d;
  font-size: 0.9rem;
}
.edit-hint {
  color: #94a3b8;
  font-size: 0.85rem;
}
.edit-hint-warn {
  color: #f87171;
}
.edit-error {
  color: #f87171;
  font-size: 0.85rem;
}
.merge-btn {
  background: rgba(99, 102, 241, 0.2) !important;
  border-color: rgba(99, 102, 241, 0.5) !important;
  color: #a5b4fc !important;
}
.merge-checkbox-cell {
  width: 32px;
  text-align: center;
}
.merge-checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: #6366f1;
}
.selected-for-merge {
  background: rgba(99, 102, 241, 0.12) !important;
  outline: 1px solid rgba(99, 102, 241, 0.4);
}

/* Apartment dropdown */
.apartment-dropdown-container {
  margin-bottom: 12px;
  position: relative;
  z-index: 20;
}
.apartment-select-trigger {
  display: inline-block;
  min-width: 220px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-hover);
  color: var(--text-primary);
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}
.apartment-select-trigger .placeholder {
  color: #888;
}
.apartment-select-trigger .arrow {
  float: right;
  opacity: 0.7;
}
.apartment-dropdown {
  position: absolute;
  left: 0;
  top: 110%;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-hover);
  border-radius: 8px;
  min-width: 220px;
  max-height: 150px;
  overflow: auto;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  padding: 4px 0;
}
.apartment-dropdown label {
  display: block;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 14px;
}
.apartment-dropdown label:hover {
  background: var(--bg-secondary);
}
.apartment-dropdown input[type='checkbox'] {
  margin-right: 8px;
  pointer-events: none;
}

/* Chips */
.chip {
  display: inline-flex;
  align-items: center;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 4px 8px;
  margin: 2px 4px;
  font-size: 12px;
  color: var(--text-primary);
}
.chip button {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  margin-left: 4px;
  font-size: 14px;
  padding: 0;
}
.chip button:hover {
  color: var(--accent-pink);
}

/* Table */
.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 16px;
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  min-width: 800px;
}
th,
td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
  font-size: 14px;
}
th {
  text-align: left;
  color: var(--text-secondary);
  font-weight: 600;
}
tr:hover {
  background: var(--bg-hover);
}
.muted {
  color: var(--text-muted);
}
.opis-cell {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Badges */
.badge {
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}
.badge-pilne {
  background: #2a1831;
  color: var(--accent-pink);
  border: 1px solid #4a2457;
}
.badge-normalne {
  background: #142b37;
  color: var(--accent-blue);
  border: 1px solid #2a5f74;
}
.new-booking {
  background: linear-gradient(90deg, #1a3a1a 0%, var(--bg-secondary) 100%);
  border-left: 4px solid #22c55e;
}
.new-badge {
  background: #22c55e;
  color: #fff;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  margin-left: 8px;
}
.arrival-today-badge {
  background: #f59e0b;
  color: #fff;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  margin-left: 8px;
}
.cancelled-booking {
  background: linear-gradient(90deg, #2a1a1a 0%, var(--bg-secondary) 100%);
  border-left: 4px solid #dc2626;
}
.cancelled-badge {
  background: #dc2626;
  color: #fff;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  margin-left: 8px;
}
.manual-booking {
  border-left: 3px solid #a78bfa;
}
.manual-badge {
  display: inline-block;
  font-size: 0.65rem;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  margin-left: 4px;
}
.merged-badge {
  background: rgba(99, 102, 241, 0.2);
  border: 1px solid rgba(99, 102, 241, 0.5);
  color: #a5b4fc;
}
.split-badge {
  background: rgba(234, 179, 8, 0.15);
  border: 1px solid rgba(234, 179, 8, 0.4);
  color: #fcd34d;
}

/* Inputs */
.input {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  padding: 6px 8px;
  border-radius: 8px;
}
.input-small {
  width: 60px;
}
.input-medium {
  width: 120px;
}

/* Footer */
.footer {
  margin-top: 12px;
  color: #7b86b6;
  font-size: 13px;
}
.saving-indicator {
  margin-left: 8px;
}
.sentinel-element {
  height: 1px;
  visibility: hidden;
  margin-top: 20px;
}
.load-more-btn {
  background: #273066;
  border: 1px solid #4a2457;
  color: #e4e8ff;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
}

/* Row edit button */
.col-actions {
  width: 60px;
  text-align: center;
  padding: 0 4px !important;
}
.row-edit-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.95rem;
  opacity: 0.35;
  padding: 2px 4px;
  border-radius: 4px;
}
tr:hover .row-edit-btn {
  opacity: 1;
}
.row-delete-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.95rem;
  opacity: 0.35;
  padding: 2px 4px;
  border-radius: 4px;
}
.row-delete-btn:hover {
  opacity: 1;
  background: rgba(220, 53, 69, 0.15);
}
.delete-btn {
  background: #dc3545 !important;
  color: #fff !important;
}
.delete-btn:hover {
  background: #c82333 !important;
}
.delete-btn.confirm {
  background: #ff6b6b !important;
  animation: pulse-delete 0.6s ease-in-out infinite alternate;
}
@keyframes pulse-delete {
  from {
    opacity: 0.85;
  }
  to {
    opacity: 1;
  }
}

/* Drawer */
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 500;
  display: flex;
  justify-content: flex-end;
}
.drawer-panel {
  width: 380px;
  max-width: 95vw;
  height: 100%;
  background: #1a1f2e;
  border-left: 1px solid #2d3748;
  display: flex;
  flex-direction: column;
}
.drawer-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 18px 20px 14px;
  border-bottom: 1px solid #2d3748;
}
.drawer-title {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.drawer-property {
  font-weight: 700;
  font-size: 1.05rem;
  color: #e2e8f0;
}
.drawer-dates {
  font-size: 0.83rem;
  color: #94a3b8;
}
.drawer-close {
  background: none;
  border: none;
  color: #64748b;
  font-size: 1.1rem;
  cursor: pointer;
  padding: 2px 6px;
}
.drawer-close:hover {
  color: #e2e8f0;
}
.drawer-tabs {
  display: flex;
  border-bottom: 1px solid #2d3748;
}
.drawer-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: #64748b;
  font-size: 0.82rem;
  padding: 10px 16px;
  cursor: pointer;
}
.drawer-tab:hover {
  color: #cbd5e1;
}
.drawer-tab.active {
  color: #63b3ed;
  border-bottom-color: #63b3ed;
  font-weight: 600;
}
.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}
.drawer-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.drawer-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.drawer-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.drawer-input {
  width: 100% !important;
  box-sizing: border-box;
}
.drawer-value {
  font-size: 0.9rem;
}
.drawer-desc {
  font-size: 0.88rem;
  color: #94a3b8;
  margin: 0;
  line-height: 1.5;
}
.drawer-hint {
  font-size: 0.87rem;
  color: #94a3b8;
  line-height: 1.5;
  margin: 0;
}
.drawer-actions {
  padding-top: 4px;
}
.drawer-action-btn {
  width: 100%;
  padding: 9px 16px !important;
  font-size: 0.9rem !important;
}
.undo-action-btn {
  background: rgba(251, 191, 36, 0.1) !important;
  border-color: rgba(251, 191, 36, 0.35) !important;
  color: #fbbf24 !important;
}
.split-preview {
  background: rgba(234, 179, 8, 0.06);
  border: 1px solid rgba(234, 179, 8, 0.2);
  border-radius: 8px;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.split-preview-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.85rem;
}
.split-preview-label {
  font-weight: 600;
  color: #fcd34d;
  min-width: 50px;
}

/* Drawer transition */
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.2s;
}
.drawer-enter-active .drawer-panel,
.drawer-leave-active .drawer-panel {
  transition: transform 0.22s;
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
.drawer-enter-from .drawer-panel,
.drawer-leave-to .drawer-panel {
  transform: translateX(100%);
}

/* Sync progress */
.sync-progress-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background: rgba(11, 16, 32, 0.95);
  border-bottom: 1px solid var(--border-color);
  padding: 16px 20px;
  z-index: 1000;
}
.progress-container {
  max-width: 600px;
  margin: 0 auto;
}
.progress-message {
  margin: 0 0 8px;
  font-size: 14px;
  color: var(--text-secondary);
}
.progress-bar {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  height: 24px;
  overflow: hidden;
  margin-bottom: 8px;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #4a2457, #6b2d9b, #4a2457);
  background-size: 200% 100%;
  transition: width 0.4s;
  border-radius: 8px;
}
.progress-pct {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 600;
}

/* Modals */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(11, 16, 32, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-content {
  background: #111633;
  border: 1px solid #1f2752;
  border-radius: 12px;
  padding: 24px;
  max-width: 500px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
}
.modal-content-wide {
  max-width: 680px !important;
  width: 95vw !important;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #1f2752;
}
.modal-title {
  font-size: 18px;
  font-weight: 600;
  color: #e4e8ff;
  margin: 0;
}
.modal-close {
  background: none;
  border: none;
  color: #8ea2ff;
  font-size: 20px;
  cursor: pointer;
}
.modal-body {
  color: #aab5ff;
  line-height: 1.5;
}
.modal-stats {
  background: #0d1330;
  border: 1px solid #273066;
  border-radius: 8px;
  padding: 16px;
  margin: 12px 0;
}
.modal-stat {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}
.modal-stat:last-child {
  margin-bottom: 0;
}
.modal-stat-label {
  color: #8ea2ff;
}
.modal-stat-value {
  color: #e4e8ff;
  font-weight: 600;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
}
.modal-btn {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid #273066;
  background: #0d1330;
  color: #e4e8ff;
  cursor: pointer;
}
.modal-btn-primary {
  background: #1a3d2e;
  border-color: #2d8f5c;
  color: #7fffb3;
}
.modal-btn-primary:hover {
  background: #2d8f5c;
}

/* Conflict */
.conflict-item {
  background: rgba(239, 68, 68, 0.07);
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
}
.conflict-info {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.conflict-property {
  font-weight: 600;
  color: #e2e8f0;
}
.conflict-dates {
  color: #94a3b8;
  font-size: 0.88rem;
}
.conflict-actions {
  display: flex;
  gap: 8px;
}

@media (max-width: 1024px) {
  .main-toolbar {
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
  }
  .toolbar-section {
    justify-content: center;
  }
}
</style>
