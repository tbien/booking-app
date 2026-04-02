export type ApiResponse<T = unknown> = {
  data: T;
  meta?: PaginationMeta;
};

export type ApiError = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};
