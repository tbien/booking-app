import express from 'express';
import { Booking } from '../../models/Booking';
import { PropertyConfig } from '../../models/PropertyConfig';
import { DEFAULT_PROPERTY_NAME } from './shared';

const router = express.Router();

// Helper function to create a date at start of day in local timezone
const getLocalStartOfDay = (year: number, month: number, day: number): Date => {
  const date = new Date(year, month, day, 0, 0, 0, 0);
  return date;
};

// Helper function to create a date at end of day in local timezone
const getLocalEndOfDay = (year: number, month: number, day: number): Date => {
  const date = new Date(year, month, day, 23, 59, 59, 999);
  return date;
};

// Helper function to parse YYYY-MM-DD string to local timezone dates
const parseLocalDateRange = (
  fromStr: string,
  toStr: string,
): { startDate: Date; endDate: Date } => {
  // Parse YYYY-MM-DD format
  const [fromYear, fromMonth, fromDay] = fromStr.split('-').map(Number);
  const [toYear, toMonth, toDay] = toStr.split('-').map(Number);

  // Create dates in local timezone (month is 0-indexed)
  const startDate = getLocalStartOfDay(fromYear, fromMonth - 1, fromDay);
  const endDate = getLocalEndOfDay(toYear, toMonth - 1, toDay);

  return { startDate, endDate };
};

// Helper function to calculate cleaning costs for a given date range
const calculateCleaningCosts = async (startDate: Date, endDate: Date) => {
  const bookings = await Booking.find({
    end: { $gte: startDate, $lte: endDate }, // Filter by checkout date (end)
  }).lean();

  const properties = await PropertyConfig.find().lean();

  // Group properties by name and take the cleaning cost from any source (they should be the same for logical property)
  const propMap = new Map();
  properties.forEach((p) => {
    if (!propMap.has(p.name)) {
      propMap.set(p.name, p.cleaningCost || 0);
    }
  });

  const uniqueProperties = new Set(bookings.map((b) => b.propertyName || DEFAULT_PROPERTY_NAME));
  let total = 0;
  const propertyDetails: { name: string; cost: number }[] = [];

  uniqueProperties.forEach((prop) => {
    const cost = propMap.get(prop) || 0;
    total += cost;
    propertyDetails.push({ name: prop, cost });
  });

  return { total, propertyDetails, bookingCount: bookings.length };
};

router.get('/summary/current-month', async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = getLocalStartOfDay(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = getLocalEndOfDay(now.getFullYear(), now.getMonth() + 1, 0); // Last day of current month

    const result = await calculateCleaningCosts(startOfMonth, endOfMonth);
    res.json({ success: true, ...result });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message || 'Błąd' });
  }
});

router.get('/summary/next-month', async (req, res) => {
  try {
    const now = new Date();
    const startOfNextMonth = getLocalStartOfDay(now.getFullYear(), now.getMonth() + 1, 1);
    const endOfNextMonth = getLocalEndOfDay(now.getFullYear(), now.getMonth() + 2, 0); // Last day of next month

    const result = await calculateCleaningCosts(startOfNextMonth, endOfNextMonth);
    res.json({ success: true, ...result });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message || 'Błąd' });
  }
});

router.get('/summary', async (req, res) => {
  try {
    const fromStr = (req.query.from as string) || '';
    const toStr = (req.query.to as string) || '';

    if (!fromStr || !toStr) {
      return res.status(400).json({
        success: false,
        error: 'Both from and to parameters are required (YYYY-MM-DD format)',
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(fromStr) || !dateRegex.test(toStr)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD format',
      });
    }

    const { startDate, endDate } = parseLocalDateRange(fromStr, toStr);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date values. Use valid YYYY-MM-DD format',
      });
    }

    if (startDate > endDate) {
      return res.status(400).json({
        success: false,
        error: 'Start date cannot be after end date',
      });
    }

    const result = await calculateCleaningCosts(startDate, endDate);
    res.json({ success: true, ...result });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message || 'Błąd' });
  }
});

export default router;
