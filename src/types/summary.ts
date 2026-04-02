export type SummaryDto = {
  total: number;
  propertyDetails: Array<{ name: string; cost: number }>;
  bookingCount: number;
};
