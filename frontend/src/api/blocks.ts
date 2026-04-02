import { api } from './client';
import type { BlockCreateDto, BlockUpdateDto } from '../types/api';

export const blocksApi = {
  create: (dto: BlockCreateDto) => api.post<{ id: string }>('/blocks', dto).then((r) => r.data),

  update: (id: string, dto: BlockUpdateDto) => api.put(`/blocks/${id}`, dto),

  delete: (id: string) => api.delete(`/blocks/${id}`),

  resolveConflict: (id: string) => api.post(`/blocks/${id}/resolve-conflict`),
};
