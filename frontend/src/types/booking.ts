export type BookingDto = {
  id: string;
  propertyId: string;
  propertyName: string;
  start: string;
  end: string;
  description: string;
  source: string;
  sourceName?: string;
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
  createdAt: string;
  updatedAt: string;
};

export type BookingListParams = {
  from: string;
  to: string;
  sortBy?: 'start' | 'end';
  filterMode?: 'overlap' | 'sortBy';
  groupId?: string;
  propertyIds?: string;
  includeCancelled?: boolean;
  page?: number;
  limit?: number;
};

export type BookingPatchDto = {
  guests?: number | null;
  notes?: string;
};
