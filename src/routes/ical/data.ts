import express from 'express';
import { ICalExportService, ICalProperty } from '../../services/ICalExportService';
import { Booking } from '../../models/Booking';
import { PropertyConfig } from '../../models/PropertyConfig';
import { mapBookingsToRows, DEFAULT_PROPERTY_NAME } from './shared';
import { buildQueryParams, QueryBuilderOptions } from './queryBuilder';

const router = express.Router();
const icalService = new ICalExportService();

// Helper function to create a date at start of day in local timezone
const getLocalStartOfDay = (year: number, month: number, day: number): Date => {
  return new Date(year, month, day, 0, 0, 0, 0);
};

// Helper function to create a date at end of day in local timezone
const getLocalEndOfDay = (year: number, month: number, day: number): Date => {
  return new Date(year, month, day, 23, 59, 59, 999);
};

// Helper function to parse YYYY-MM-DD string to local timezone date
const parseLocalDate = (dateStr: string, isEndDate = false): Date => {
  const [year, month, day] = dateStr.split('-').map(Number);
  // Create date in local timezone (month is 0-indexed)
  if (isEndDate) {
    // For end dates, set to end of day in local timezone
    return new Date(year, month - 1, day, 23, 59, 59, 999);
  } else {
    // For start dates, set to start of day in local timezone
    return new Date(year, month - 1, day, 0, 0, 0, 0);
  }
};

const buildPropertyToGroupMap = (properties: any[]): Map<string, string> => {
  const groupStats = new Map<string, Map<string, number>>();
  for (const p of properties) {
    if (p.groupId && p.groupId._id) {
      const name = p.name;
      if (!groupStats.has(name)) groupStats.set(name, new Map());
      const m = groupStats.get(name)!;
      const gId = String(p.groupId._id);
      m.set(gId, (m.get(gId) || 0) + 1);
    }
  }

  const propertyToGroupMap = new Map<string, string>();
  groupStats.forEach((counts, propName) => {
    // pick groupId with highest count for that logical property name
    const best = Array.from(counts.entries()).reduce<{ g: string; c: number } | null>(
      (acc, [g, c]) => {
        if (!acc || c > acc.c) return { g, c };
        return acc;
      },
      null,
    );
    if (best) propertyToGroupMap.set(propName, best.g);
  });

  return propertyToGroupMap;
};

router.get('/data', async (req, res) => {
  try {
    // Build property filter first
    let propertyQuery: any = {};
    const groupId = (req.query.groupId as string) || '';
    const propertyNames = (req.query.propertyNames as string) || '';

    if (groupId) {
      propertyQuery.groupId = groupId;
    }
    if (propertyNames) {
      const names = propertyNames
        .split(',')
        .map((n: string) => n.trim())
        .filter(Boolean);
      if (names.length > 0) {
        propertyQuery.name = { $in: names };
      }
    }

    const properties = await PropertyConfig.find(propertyQuery).populate('groupId').lean();
    const sortBy = (req.query.sortBy as 'start' | 'end') || 'end';
    const fromStr = (req.query.from as string) || '';
    const toStr = (req.query.to as string) || '';
    const includeCancelled = req.query.includeCancelled === 'true';

    // Dates are now required - if not provided, use default 35 days from today
    let from: Date;
    let to: Date;

    if (fromStr && toStr) {
      try {
        from = parseLocalDate(fromStr, false); // Start of day
        to = parseLocalDate(toStr, true); // End of day
      } catch (e) {
        return res
          .status(400)
          .json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' });
      }
    } else {
      // Default: today + 35 days
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      from = today;
      to = new Date(today);
      to.setDate(to.getDate() + 35);
      to.setHours(23, 59, 59, 999);
    }
    const all = req.query.all === 'true';
    const page = parseInt((req.query.page as string) || '1', 10);
    const limit = parseInt((req.query.limit as string) || (all ? '1000' : '30'), 10);

    // Use builder to get query and default limit when appropriate
    const filterMode = (req.query.filterMode as 'overlap' | 'sortBy') || 'sortBy';
    const queryOpts: QueryBuilderOptions = {
      from,
      to,
      sortBy,
      includeCancelled,
      daysAhead: 35, // Not used anymore but kept for compatibility with queryBuilder
      all,
      filterMode,
    };
    const { query, computedLimit } = buildQueryParams(queryOpts);

    // Add property name filter if properties were filtered by group
    if (properties.length > 0 && (groupId || propertyNames)) {
      const propertyNamesList = properties.map((p: any) => p.name);
      query.propertyName = { $in: propertyNamesList };
    }

    // If the request provided explicit limit, use it; otherwise use computedLimit
    const finalLimit = req.query.limit ? parseInt(String(req.query.limit), 10) : computedLimit;

    const items = await Booking.find(query)
      .sort({ end: 1, start: 1 })
      .skip((page - 1) * finalLimit)
      .limit(finalLimit)
      .lean();
    const totalCount = await Booking.countDocuments(query);

    // Always fetch active manual bookings to determine which originals are hidden.
    // Manual bookings store mergedFromIds / splitFromId pointing to their source originals.
    // Originals are kept active in DB but hidden in UI when covered by a manual booking.
    const manualQuery: any = {
      isManual: true,
      cancellationStatus: { $exists: false },
    };
    if (query.propertyName) manualQuery.propertyName = query.propertyName;
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

    const rows = mapBookingsToRows(visibleItems, propertyToGroupMap);

    res.json({
      success: true,
      count: rows.length,
      totalCount,
      hasMore: page * limit < totalCount,
      summary: { mode: 'db-only' },
      rows,
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message || 'Błąd' });
  }
});

export default router;
