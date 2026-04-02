import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { bookingsApi } from '../api/bookings';
import type { BookingDto, BookingListParams, PaginationMeta } from '../types/api';

export const useBookingsStore = defineStore('bookings', () => {
  const rows = ref<BookingDto[]>([]);
  const meta = ref<PaginationMeta>({ page: 1, limit: 50, total: 0, hasMore: false });
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Filter state
  const filterParams = ref<BookingListParams>({
    from: '',
    to: '',
    sortBy: 'end',
    filterMode: 'sortBy',
    groupId: '',
    propertyIds: '',
    includeCancelled: false,
    page: 1,
    limit: 50,
  });

  const currentMonthOffset = ref(0);

  const displayedMonthLabel = computed(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + currentMonthOffset.value);
    return d.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
  });

  function setMonthDates(offset: number) {
    currentMonthOffset.value = offset;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
    filterParams.value.from = fmt(start);
    filterParams.value.to = fmt(end);
    filterParams.value.page = 1;
  }

  function fmt(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  async function fetchBookings(append = false) {
    loading.value = true;
    error.value = null;
    try {
      const result = await bookingsApi.list(filterParams.value);
      if (append) {
        rows.value = [...rows.value, ...result.rows];
      } else {
        rows.value = result.rows;
      }
      meta.value = result.meta;
    } catch (e: any) {
      error.value = e.message || 'Błąd pobierania danych';
    } finally {
      loading.value = false;
    }
  }

  async function loadMore() {
    if (!meta.value.hasMore || loading.value) return;
    filterParams.value.page = (filterParams.value.page || 1) + 1;
    await fetchBookings(true);
  }

  async function patchBooking(id: string, data: { guests?: number | null; notes?: string }) {
    await bookingsApi.patch(id, data);
    const idx = rows.value.findIndex((r) => r.id === id);
    if (idx !== -1) {
      if (data.guests !== undefined) rows.value[idx].guests = data.guests;
      if (data.notes !== undefined) rows.value[idx].notes = data.notes;
    }
  }

  // Init with current + next month
  function initDates() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    filterParams.value.from = fmt(start);
    filterParams.value.to = fmt(end);
  }

  return {
    rows,
    meta,
    loading,
    error,
    filterParams,
    currentMonthOffset,
    displayedMonthLabel,
    setMonthDates,
    fetchBookings,
    loadMore,
    patchBooking,
    initDates,
  };
});
