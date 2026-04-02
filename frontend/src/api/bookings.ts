import { api } from './client';
import type {
  BookingDto,
  BookingListParams,
  BookingPatchDto,
  PaginationMeta,
  MergeDto,
  SplitDto,
  ResolveConflictDto,
} from '../types/api';

function toQuery(params: BookingListParams): string {
  const p = new URLSearchParams();
  if (params.from) p.set('from', params.from);
  if (params.to) p.set('to', params.to);
  if (params.sortBy) p.set('sortBy', params.sortBy);
  if (params.filterMode) p.set('filterMode', params.filterMode);
  if (params.groupId) p.set('groupId', params.groupId);
  if (params.propertyIds) p.set('propertyIds', params.propertyIds);
  if (params.includeCancelled) p.set('includeCancelled', 'true');
  if (params.page) p.set('page', String(params.page));
  if (params.limit) p.set('limit', String(params.limit));
  return p.toString();
}

export const bookingsApi = {
  list: async (params: BookingListParams) => {
    const qs = toQuery(params);
    const res = await api.get<BookingDto[]>(`/bookings?${qs}`);
    return { rows: res.data, meta: res.meta as PaginationMeta };
  },

  getById: (id: string) => api.get<BookingDto>(`/bookings/${id}`).then((r) => r.data),

  patch: (id: string, dto: BookingPatchDto) =>
    api.patch<{ success: boolean }>(`/bookings/${id}`, dto),

  merge: (dto: MergeDto) => api.post<unknown>('/merge', dto).then((r) => r.data),

  split: (dto: SplitDto) => api.post<unknown>('/split', dto).then((r) => r.data),

  undoMerge: (id: string) => api.post('/undo-merge', { id }),

  undoSplit: (id: string) => api.post('/undo-split', { id }),

  resolveConflict: (dto: ResolveConflictDto) => api.post('/resolve-conflict', dto),

  deleteCancelled: (ids?: string[]) =>
    api
      .delete<{ deletedCount: number }>('/bookings/cancelled', ids ? { ids } : undefined)
      .then((r) => r.data),
};
