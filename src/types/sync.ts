export type SyncRequestDto = {
  from?: string;
  to?: string;
  groupId?: string;
  propertyNames?: string;
  force?: boolean;
};

export type SyncResultDto = {
  message: string;
  stats: {
    propertiesSynced: number;
    bookingsUpdated: number;
    bookingsCancelled: number;
  };
  conflicts?: unknown[];
  syncId: string;
  duration: number;
};
