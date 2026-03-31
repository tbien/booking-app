import type { ApiResponse, ApiError } from '../types/api';

const BASE = '/api/v1';

class ApiClientError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(status: number, body: ApiError) {
    super(body.error.message);
    this.name = 'ApiClientError';
    this.code = body.error.code;
    this.status = status;
    this.details = body.error.details;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE}${path}`, opts);

  if (res.status === 204) return { data: undefined as T };

  const json = await res.json();

  if (!res.ok) {
    if (json.error) throw new ApiClientError(res.status, json);
    throw new ApiClientError(res.status, {
      error: { code: 'UNKNOWN', message: res.statusText },
    });
  }

  return json as ApiResponse<T>;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T = void>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

export { ApiClientError };
