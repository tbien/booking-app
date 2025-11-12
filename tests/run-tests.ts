import { buildQueryParams } from '../src/routes/ical/queryBuilder';

const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error('TEST FAILED:', msg);
    process.exit(2);
  }
};

console.log('Running queryBuilder tests...');

// Test 1: from/to provided => overlap query and computedLimit = 1000
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
  });

  assert(!!query.$and, 'Expected $and for overlap query');
  assert(computedLimit === 1000, 'Expected computedLimit 1000 for explicit range');
})();

// Test 2: no from/to => default end filter and computedLimit 30
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

// Test 3: all=true should set computedLimit to 1000
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

console.log('All tests passed.');
