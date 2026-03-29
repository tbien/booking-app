import { Hono } from 'hono';
import { requireAdmin } from '../../middleware/auth';
import { Booking } from '../../../../src/models/Booking';
import { Property } from '../../../../src/models/Property';
import { DEFAULT_PROPERTY_NAME } from '../../../../src/routes/ical/shared';
import type { AppEnv } from '../../index';

const router = new Hono<AppEnv>();

const getLocalStartOfDay = (y: number, m: number, d: number): Date => new Date(y, m, d, 0, 0, 0, 0);
const getLocalEndOfDay = (y: number, m: number, d: number): Date =>
  new Date(y, m, d, 23, 59, 59, 999);

const parseLocalDateRange = (fromStr: string, toStr: string) => {
  const [fy, fm, fd] = fromStr.split('-').map(Number);
  const [ty, tm, td] = toStr.split('-').map(Number);
  return {
    startDate: getLocalStartOfDay(fy, fm - 1, fd),
    endDate: getLocalEndOfDay(ty, tm - 1, td),
  };
};

const calculateCleaningCosts = async (startDate: Date, endDate: Date) => {
  const bookings = await Booking.find({ end: { $gte: startDate, $lte: endDate } }).lean();
  const props = await Property.find(
    {},
    { _id: 1, displayName: 1, name: 1, cleaningCost: 1 },
  ).lean();

  const costMap = new Map<string, number>();
  const nameMap = new Map<string, string>();
  (props as any[]).forEach((p) => {
    costMap.set(String(p._id), p.cleaningCost || 0);
    nameMap.set(String(p._id), p.displayName || p.name);
  });

  const uniquePropertyIds = new Set(
    (bookings as any[]).map((b) => (b.propertyId ? String(b.propertyId) : DEFAULT_PROPERTY_NAME)),
  );
  let total = 0;
  const propertyDetails: { name: string; cost: number }[] = [];
  uniquePropertyIds.forEach((propId) => {
    const cost = costMap.get(propId) || 0;
    total += cost;
    propertyDetails.push({ name: nameMap.get(propId) || propId, cost });
  });
  return { total, propertyDetails, bookingCount: bookings.length };
};

router.get('/summary/current-month', requireAdmin, async (c) => {
  try {
    const now = new Date();
    const start = getLocalStartOfDay(now.getFullYear(), now.getMonth(), 1);
    const end = getLocalEndOfDay(now.getFullYear(), now.getMonth() + 1, 0);
    const result = await calculateCleaningCosts(start, end);
    return c.json({ success: true, ...result });
  } catch (e: any) {
    return c.json({ success: false, error: e.message || 'Błąd' }, 500);
  }
});

router.get('/summary/next-month', requireAdmin, async (c) => {
  try {
    const now = new Date();
    const start = getLocalStartOfDay(now.getFullYear(), now.getMonth() + 1, 1);
    const end = getLocalEndOfDay(now.getFullYear(), now.getMonth() + 2, 0);
    const result = await calculateCleaningCosts(start, end);
    return c.json({ success: true, ...result });
  } catch (e: any) {
    return c.json({ success: false, error: e.message || 'Błąd' }, 500);
  }
});

router.get('/summary', requireAdmin, async (c) => {
  try {
    const fromStr = c.req.query('from') || '';
    const toStr = c.req.query('to') || '';

    if (!fromStr || !toStr) {
      return c.json(
        {
          success: false,
          error: 'Both from and to parameters are required (YYYY-MM-DD format)',
        },
        400,
      );
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(fromStr) || !dateRegex.test(toStr)) {
      return c.json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD format' }, 400);
    }

    const { startDate, endDate } = parseLocalDateRange(fromStr, toStr);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return c.json({ success: false, error: 'Invalid date values' }, 400);
    }
    if (startDate > endDate) {
      return c.json({ success: false, error: 'Start date cannot be after end date' }, 400);
    }

    const result = await calculateCleaningCosts(startDate, endDate);
    return c.json({ success: true, ...result });
  } catch (e: any) {
    return c.json({ success: false, error: e.message || 'Błąd' }, 500);
  }
});

export default router;
