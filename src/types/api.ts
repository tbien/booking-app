// Shared API response types for v1 REST endpoints

export interface ApiResponse<T = unknown> {
  data: T;
  meta?: PaginationMeta;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

// ── Booking DTOs ─────────────────────────────────────────────────────────────

export interface BookingDto {
  id: string;
  propertyId: string;
  propertyName: string;
  start: Date;
  end: Date;
  description: string;
  source: string;
  guests: number | null;
  notes: string;
  isUrgentChangeover: boolean;
  isNew: boolean;
  isStartingToday: boolean;
  cancellationStatus: string | null;
  isManual: boolean;
  manualType: string | null;
  mergedFromIds: string[];
  splitFromId: string | null;
  blockReason: string | null;
  hasConflict: boolean;
  groupId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BookingListParams {
  from: string;
  to: string;
  sortBy?: 'start' | 'end';
  filterMode?: 'overlap' | 'sortBy';
  groupId?: string;
  propertyIds?: string;
  includeCancelled?: boolean;
  page?: number;
  limit?: number;
}

export interface BookingPatchDto {
  guests?: number;
  notes?: string;
}

// ── Property DTOs ────────────────────────────────────────────────────────────

export interface PropertyDto {
  id: string;
  name: string;
  displayName: string;
  groupId: string | null;
  groupName: string | null;
  cleaningCost: number;
  exportToken: string;
  exportUrl: string;
  sourcesCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PropertyCreateDto {
  name?: string;
  displayName: string;
  groupId?: string | null;
  cleaningCost?: number;
}

export interface PropertyUpdateDto {
  displayName: string;
  groupId?: string | null;
  cleaningCost?: number;
}

export interface SourceDto {
  id: string;
  icalUrl: string;
  source: string;
  name: string;
}

export interface SourceCreateDto {
  icalUrl: string;
  source: string;
}

// ── Group DTOs ───────────────────────────────────────────────────────────────

export interface GroupDto {
  id: string;
  name: string;
  propertyCount: number;
}

export interface GroupCreateDto {
  name: string;
}

// ── Block DTOs ───────────────────────────────────────────────────────────────

export interface BlockCreateDto {
  propertyId: string;
  start: string;
  end: string;
  reason?: string;
}

export interface BlockUpdateDto {
  start: string;
  end: string;
  reason?: string;
}

// ── Merge DTOs ───────────────────────────────────────────────────────────────

export interface MergeDto {
  ids: [string, string];
}

export interface SplitDto {
  id: string;
  splitDate: string;
}

export interface ResolveConflictDto {
  manualId: string;
  decision: 'keep' | 'remove';
}

// ── Sync DTOs ────────────────────────────────────────────────────────────────

export interface SyncRequestDto {
  from?: string;
  to?: string;
  groupId?: string;
  propertyNames?: string;
  force?: boolean;
}

export interface SyncResultDto {
  message: string;
  stats: {
    propertiesSynced: number;
    bookingsUpdated: number;
    bookingsCancelled: number;
  };
  conflicts?: unknown[];
  syncId: string;
  duration: number;
}

// ── Settings DTOs ────────────────────────────────────────────────────────────

export interface SettingsDto {
  defaultGroupId: string | null;
  defaultGroupName?: string | null;
}

// ── Summary DTOs ─────────────────────────────────────────────────────────────

export interface SummaryDto {
  total: number;
  propertyDetails: Array<{ name: string; cost: number }>;
  bookingCount: number;
}
