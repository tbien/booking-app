import { api } from './client';
import type {
  PropertyDto,
  PropertyCreateDto,
  PropertyUpdateDto,
  SourceDto,
  SourceCreateDto,
} from '../types/api';

export const propertiesApi = {
  list: () => api.get<PropertyDto[]>('/properties').then((r) => r.data),

  getById: (id: string) => api.get<PropertyDto>(`/properties/${id}`).then((r) => r.data),

  create: (dto: PropertyCreateDto) =>
    api
      .post<{ id: string; name: string; exportToken: string }>('/properties', dto)
      .then((r) => r.data),

  update: (id: string, dto: PropertyUpdateDto) => api.put(`/properties/${id}`, dto),

  delete: (id: string) => api.delete(`/properties/${id}`),

  regenerateToken: (id: string) =>
    api
      .post<{ exportToken: string; exportUrl: string }>(`/properties/${id}/regenerate-token`)
      .then((r) => r.data),

  // Sources
  listSources: (propertyId: string) =>
    api.get<SourceDto[]>(`/properties/${propertyId}/sources`).then((r) => r.data),

  addSource: (propertyId: string, dto: SourceCreateDto) =>
    api.post<{ id: string }>(`/properties/${propertyId}/sources`, dto).then((r) => r.data),

  updateSource: (propertyId: string, sourceId: string, dto: SourceCreateDto) =>
    api.put(`/properties/${propertyId}/sources/${sourceId}`, dto),

  deleteSource: (propertyId: string, sourceId: string) =>
    api.delete(`/properties/${propertyId}/sources/${sourceId}`),
};
