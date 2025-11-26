import { buildQueryParams } from '../src/routes/ical/queryBuilder';

const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error('TEST FAILED:', msg);
    process.exit(2);
  }
};

console.log('Running queryBuilder tests...');

// Test 1: from/to with filterMode='overlap' => overlap query
(() => {
  const from = new Date('2025-12-01');
  const to = new Date('2025-12-31');
  const { query, computedLimit } = buildQueryParams({
    from,
    to,
    sortBy: 'end',
    includeCancelled: false,
    daysAhead: 35,
    all: false,
    filterMode: 'overlap',
  });

  assert(!!query.$and, 'Expected $and for overlap query');
  assert(computedLimit === 1000, 'Expected computedLimit 1000 for explicit range');
})();

// Test 2: from/to with sortBy='start' (default filterMode='sortBy') => filter by start field
(() => {
  const from = new Date('2025-11-01');
  const to = new Date('2025-11-30');
  const { query, computedLimit } = buildQueryParams({
    from,
    to,
    sortBy: 'start',
    includeCancelled: false,
    daysAhead: 35,
    all: false,
  });

  assert(!!query.start, 'Expected start field filter when sortBy=start');
  assert(query.start.$gte && query.start.$lte, 'Expected start range with $gte and $lte');
  assert(!query.$and, 'Should not use overlap query when filterMode=sortBy');
  assert(computedLimit === 1000, 'Expected computedLimit 1000');
})();

// Test 3: from/to with sortBy='end' (default filterMode='sortBy') => filter by end field
(() => {
  const from = new Date('2025-11-01');
  const to = new Date('2025-11-30');
  const { query, computedLimit } = buildQueryParams({
    from,
    to,
    sortBy: 'end',
    includeCancelled: false,
    daysAhead: 35,
    all: false,
  });

  assert(!!query.end, 'Expected end field filter when sortBy=end');
  assert(query.end.$gte && query.end.$lte, 'Expected end range with $gte and $lte');
  assert(!query.$and, 'Should not use overlap query when filterMode=sortBy');
  assert(computedLimit === 1000, 'Expected computedLimit 1000');
})();

// Test 4: no from/to => default end filter and computedLimit 30
(() => {
  const { query, computedLimit } = buildQueryParams({
    from: null,
    to: null,
    sortBy: 'end',
    includeCancelled: false,
    daysAhead: 35,
    all: false,
  });

  assert(!!query.end, 'Expected end filter when no explicit range');
  assert(computedLimit === 30, 'Expected computedLimit 30 for default');
})();

// Test 5: all=true should set computedLimit to 1000
(() => {
  const { computedLimit } = buildQueryParams({
    from: null,
    to: null,
    sortBy: 'end',
    includeCancelled: false,
    daysAhead: 35,
    all: true,
  });
  assert(computedLimit === 1000, 'Expected computedLimit 1000 when all=true');
})();

// Test 6: includeCancelled=false should add cancellationStatus filter
(() => {
  const { query } = buildQueryParams({
    from: null,
    to: null,
    sortBy: 'end',
    includeCancelled: false,
    daysAhead: 35,
    all: false,
  });
  assert(query.cancellationStatus, 'Expected cancellationStatus filter');
  assert(query.cancellationStatus.$ne === 'cancelled', 'Expected $ne cancelled');
})();

console.log('All tests passed.');
