export interface QueryBuilderOptions {
  from: Date | null;
  to: Date | null;
  sortBy: 'start' | 'end';
  includeCancelled: boolean;
  daysAhead: number;
  all: boolean;
  filterMode?: 'overlap' | 'sortBy'; // new parameter for filtering strategy
}

export const buildQueryParams = (opts: QueryBuilderOptions) => {
  const { from, to, sortBy, includeCancelled, daysAhead, all, filterMode = 'sortBy' } = opts;
  const query: any = {};
  if (!includeCancelled) {
    query.cancellationStatus = { $ne: 'cancelled' };
  }

  let computedLimit = 30;

  if (from && to) {
    if (filterMode === 'overlap') {
      // Overlap condition: booking.start <= to AND booking.end >= from
      // Returns all bookings that intersect the date range in any way
      query.$and = [{ start: { $lte: to } }, { end: { $gte: from } }];
    } else {
      // Filter by sortBy field: only bookings with check-in/check-out in the range
      if (sortBy === 'start') {
        // Filter by check-in date (start) within range
        query.start = { $gte: from, $lte: to };
      } else {
        // Filter by check-out date (end) within range
        query.end = { $gte: from, $lte: to };
      }
    }
    computedLimit = 1000;
  } else {
    // Default behavior: filter bookings by checkout date between today and cutoff (daysAhead)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + daysAhead);
    cutoff.setHours(23, 59, 59, 999);
    query.end = { $gte: today, $lte: cutoff };
  }

  if (all) computedLimit = 1000;

  return { query, computedLimit };
};

export default buildQueryParams;
