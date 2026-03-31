import { api } from './client';
import type { GroupDto } from '../types/api';

export const groupsApi = {
  list: () => api.get<GroupDto[]>('/groups').then((r) => r.data),

  create: (name: string) => api.post<{ id: string }>('/groups', { name }).then((r) => r.data),

  update: (id: string, name: string) => api.put(`/groups/${id}`, { name }),

  delete: (id: string) => api.delete(`/groups/${id}`),
};
