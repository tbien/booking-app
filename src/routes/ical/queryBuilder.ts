export const buildQueryParams = (opts: {
  from: Date | null;
  to: Date | null;
  sortBy: 'start' | 'end';
  includeCancelled: boolean;
  daysAhead: number;
  all: boolean;
}) => {
  const { from, to, sortBy, includeCancelled, daysAhead, all } = opts;
  const query: any = {};
  if (!includeCancelled) {
    query.cancellationStatus = { $ne: 'cancelled' };
  }

  let computedLimit = 30;

  if (from && to) {
    // Overlap condition: booking.start <= to AND booking.end >= from
    query.$and = [{ start: { $lte: to } }, { end: { $gte: from } }];
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
