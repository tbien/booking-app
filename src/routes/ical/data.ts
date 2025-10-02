import express from 'express';
import { ICalExportService, ICalProperty } from '../../services/ICalExportService';
import { Booking } from '../../models/Booking';
import { PropertyConfig } from '../../models/PropertyConfig';
import { mapBookingsToRows, DEFAULT_PROPERTY_NAME } from './shared';

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
    const properties = await PropertyConfig.find().populate('groupId').lean();
    const daysAhead = parseInt((req.query.daysAhead as string) || '35', 10);
    const sortBy = (req.query.sortBy as 'start' | 'end') || 'end';
    const fromStr = (req.query.from as string) || '';
    const toStr = (req.query.to as string) || '';
    const groupId = (req.query.groupId as string) || '';
    const propertyNames = (req.query.propertyNames as string) || '';
    const includeCancelled = req.query.includeCancelled === 'true';

    // Parse dates using timezone-aware parsing
    let from: Date | null = null;
    let to: Date | null = null;

    if (fromStr) {
      try {
        from = parseLocalDate(fromStr, false); // Start of day
      } catch (e) {
        return res
          .status(400)
          .json({ success: false, error: 'Invalid from date format. Use YYYY-MM-DD' });
      }
    }

    if (toStr) {
      try {
        to = parseLocalDate(toStr, true); // End of day
      } catch (e) {
        return res
          .status(400)
          .json({ success: false, error: 'Invalid to date format. Use YYYY-MM-DD' });
      }
    }
    const all = req.query.all === 'true';
    const page = parseInt((req.query.page as string) || '1', 10);
    const limit = parseInt((req.query.limit as string) || (all ? '1000' : '30'), 10);

    let query: any = {};
    if (!includeCancelled) {
      query.cancellationStatus = { $ne: 'cancelled' };
    }

    if (!all) {
      if (from || to) {
        // Custom date range provided - filter based on sortBy setting
        if (sortBy === 'start') {
          // Filter by check-in date (start)
          const startFilter: any = {};
          if (from) startFilter.$gte = from;
          if (to) startFilter.$lte = to;
          query.start = startFilter;
        } else {
          // Filter by check-out date (end) - default behavior
          const endFilter: any = {};
          if (from) endFilter.$gte = from;
          if (to) endFilter.$lte = to;
          query.end = endFilter;
        }
      } else {
        // Default behavior: filter bookings by checkout date between today and cutoff (daysAhead)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() + daysAhead);
        cutoff.setHours(23, 59, 59, 999);
        query.end = { $gte: today, $lte: cutoff };
      }
    }

    const items = await Booking.find(query)
      .sort({ end: 1, start: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    const totalCount = await Booking.countDocuments(query);

    const propertyToGroupMap = buildPropertyToGroupMap(properties);

    const rows = mapBookingsToRows(items, propertyToGroupMap);

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
