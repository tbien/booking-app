import { Hono } from 'hono';
import { Booking } from '../../../../src/models/Booking';
import { Property } from '../../../../src/models/Property';
import { mapBookingsToRows, DEFAULT_PROPERTY_NAME } from '../../../../src/routes/ical/shared';
import {
  buildQueryParams,
  type QueryBuilderOptions,
} from '../../../../src/routes/ical/queryBuilder';
import type { AppEnv } from '../../index';

const router = new Hono<AppEnv>();

const parseLocalDate = (dateStr: string, isEndDate = false): Date => {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (isEndDate) return new Date(year, month - 1, day, 23, 59, 59, 999);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
};

const buildPropertyToGroupMap = (properties: any[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const p of properties) {
    if (p.groupId) {
      const gId = p.groupId._id ? String(p.groupId._id) : String(p.groupId);
      map.set(String(p._id), gId);
    }
  }
  return map;
};

router.get('/data', async (c) => {
  try {
    let propertyQuery: any = {};
    const groupId = c.req.query('groupId') || '';
    const propertyIds = c.req.query('propertyIds') || '';

    if (groupId) propertyQuery.groupId = groupId;
    if (propertyIds) {
      const ids = propertyIds
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean);
      if (ids.length > 0) propertyQuery._id = { $in: ids };
    }

    const properties = await Property.find(propertyQuery).populate('groupId').lean();
    const sortBy = (c.req.query('sortBy') as 'start' | 'end') || 'end';
    const fromStr = c.req.query('from') || '';
    const toStr = c.req.query('to') || '';
    const includeCancelled = c.req.query('includeCancelled') === 'true';

    let from: Date;
    let to: Date;

    if (fromStr && toStr) {
      try {
        from = parseLocalDate(fromStr, false);
        to = parseLocalDate(toStr, true);
      } catch {
        return c.json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' }, 400);
      }
    } else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      from = today;
      to = new Date(today);
      to.setDate(to.getDate() + 35);
      to.setHours(23, 59, 59, 999);
    }

    const all = c.req.query('all') === 'true';
    const page = parseInt(c.req.query('page') || '1', 10);
    const limit = parseInt(c.req.query('limit') || (all ? '1000' : '30'), 10);
    const filterMode = (c.req.query('filterMode') as 'overlap' | 'sortBy') || 'sortBy';

    const queryOpts: QueryBuilderOptions = {
      from,
      to,
      sortBy,
      includeCancelled,
      daysAhead: 35,
      all,
      filterMode,
    };
    const { query, computedLimit } = buildQueryParams(queryOpts);

    if (groupId || propertyIds) {
      const propertyIdList = properties.map((p: any) => p._id);
      if (propertyIdList.length > 0) {
        query.propertyId = { $in: propertyIdList };
      } else {
        return c.json({
          success: true,
          count: 0,
          totalCount: 0,
          hasMore: false,
          summary: { mode: 'db-only' },
          rows: [],
        });
      }
    }

    const finalLimit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : computedLimit;

    const items = await Booking.find(query)
      .sort({ end: 1, start: 1 })
      .skip((page - 1) * finalLimit)
      .limit(finalLimit)
      .lean();
    const totalCount = await Booking.countDocuments(query);

    const manualQuery: any = {
      isManual: true,
      cancellationStatus: { $exists: false },
    };
    if (query.propertyId) manualQuery.propertyId = query.propertyId;
    const activeManuals = await Booking.find(manualQuery, {
      mergedFromIds: 1,
      splitFromId: 1,
    }).lean();

    const hiddenIds = new Set<string>();
    for (const m of activeManuals) {
      for (const oid of (m as any).mergedFromIds || []) hiddenIds.add(String(oid));
      if ((m as any).splitFromId) hiddenIds.add(String((m as any).splitFromId));
    }

    const visibleItems =
      hiddenIds.size > 0 ? items.filter((it) => !hiddenIds.has(String(it._id))) : items;

    const propertyToGroupMap = buildPropertyToGroupMap(properties);
    const propertyToDisplayNameMap = new Map<string, string>();
    for (const p of properties) {
      if ((p as any).displayName)
        propertyToDisplayNameMap.set(String((p as any)._id), (p as any).displayName);
    }

    if (!groupId && !propertyIds) {
      const allProps = await Property.find({}, { _id: 1, displayName: 1 }).lean();
      for (const p of allProps as any[]) {
        if (p.displayName) propertyToDisplayNameMap.set(String(p._id), p.displayName);
      }
    }

    const rows = mapBookingsToRows(visibleItems, propertyToGroupMap, propertyToDisplayNameMap);

    return c.json({
      success: true,
      count: rows.length,
      totalCount,
      hasMore: page * limit < totalCount,
      summary: { mode: 'db-only' },
      rows,
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message || 'Błąd' }, 500);
  }
});

export default router;
