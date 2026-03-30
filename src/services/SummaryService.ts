import { Booking } from '../models/Booking';
import { Property } from '../models/Property';
import { SummaryDto } from '../types/api';

const DEFAULT_PROPERTY_NAME = 'Nieznana';

const getLocalStartOfDay = (year: number, month: number, day: number): Date =>
  new Date(year, month, day, 0, 0, 0, 0);

const getLocalEndOfDay = (year: number, month: number, day: number): Date =>
  new Date(year, month, day, 23, 59, 59, 999);

async function calculateCleaningCosts(startDate: Date, endDate: Date): Promise<SummaryDto> {
  const bookings = await Booking.find({
    end: { $gte: startDate, $lte: endDate },
  }).lean();

  const props = await Property.find({}, { _id: 1, displayName: 1, name: 1, cleaningCost: 1 }).lean();

  const costMap = new Map<string, number>();
  const nameMap = new Map<string, string>();
  (props as any[]).forEach((p) => {
    const key = String(p._id);
    costMap.set(key, p.cleaningCost || 0);
    nameMap.set(key, p.displayName || p.name);
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
}

export class SummaryService {
  async getForDateRange(from: string, to: string): Promise<SummaryDto> {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(from) || !dateRegex.test(to)) {
      throw Object.assign(new Error('Invalid date format. Use YYYY-MM-DD'), { status: 400 });
    }

    const [fromY, fromM, fromD] = from.split('-').map(Number);
    const [toY, toM, toD] = to.split('-').map(Number);
    const startDate = getLocalStartOfDay(fromY, fromM - 1, fromD);
    const endDate = getLocalEndOfDay(toY, toM - 1, toD);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw Object.assign(new Error('Invalid date values'), { status: 400 });
    }
    if (startDate > endDate) {
      throw Object.assign(new Error('Start date cannot be after end date'), { status: 400 });
    }

    return calculateCleaningCosts(startDate, endDate);
  }

  async getCurrentMonth(): Promise<SummaryDto> {
    const now = new Date();
    const startOfMonth = getLocalStartOfDay(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = getLocalEndOfDay(now.getFullYear(), now.getMonth() + 1, 0);
    return calculateCleaningCosts(startOfMonth, endOfMonth);
  }

  async getNextMonth(): Promise<SummaryDto> {
    const now = new Date();
    const startOfNextMonth = getLocalStartOfDay(now.getFullYear(), now.getMonth() + 1, 1);
    const endOfNextMonth = getLocalEndOfDay(now.getFullYear(), now.getMonth() + 2, 0);
    return calculateCleaningCosts(startOfNextMonth, endOfNextMonth);
  }
}
