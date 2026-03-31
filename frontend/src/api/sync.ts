import { api } from './client';
import type { SyncRequestDto, SyncResultDto, SettingsDto, SummaryDto } from '../types/api';

export const syncApi = {
  sync: (dto: SyncRequestDto) => api.post<SyncResultDto>('/sync', dto).then((r) => r.data),
};

export const settingsApi = {
  get: () => api.get<SettingsDto>('/settings').then((r) => r.data),
  update: (defaultGroupId: string | null) =>
    api.put<SettingsDto>('/settings', { defaultGroupId }).then((r) => r.data),
};

export const summaryApi = {
  currentMonth: () => api.get<SummaryDto>('/summary/current-month').then((r) => r.data),
  nextMonth: () => api.get<SummaryDto>('/summary/next-month').then((r) => r.data),
  range: (from: string, to: string) =>
    api.get<SummaryDto>(`/summary?from=${from}&to=${to}`).then((r) => r.data),
};
