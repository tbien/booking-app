import express from 'express';
import { ICalExportService, ICalProperty } from '../../services/ICalExportService';
import { Booking } from '../../models/Booking';
import { PropertyConfig } from '../../models/PropertyConfig';
import { mapBookingsToRows, DEFAULT_PROPERTY_NAME } from './shared';

const router = express.Router();
const icalService = new ICalExportService();

router.get('/data', async (req, res) => {
  try {
    const properties: ICalProperty[] = await PropertyConfig.find().lean();
    const daysAhead = parseInt((req.query.daysAhead as string) || '35', 10);
    const sortBy = (req.query.sortBy as 'start' | 'end') || 'end';
    const fromStr = (req.query.from as string) || '';
    const toStr = (req.query.to as string) || '';
    const from = fromStr ? new Date(fromStr) : null;
    const to = toStr ? new Date(toStr) : null;

    const cutoff = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);

    let query: any = { start: { $lte: cutoff } };
    if (from || to) {
      const rf: any = {};
      if (from) rf.$gte = from;
      if (to) rf.$lte = to;
      query = { end: rf };
    }

    const items = await Booking.find(query).sort({ end: 1, start: 1 }).lean();
    const rows = mapBookingsToRows(items);

    // Send response immediately with DB data
    res.json({
      success: true,
      count: rows.length,
      summary: { mode: from || to ? 'db-only' : 'db' },
      rows,
    });

    // Perform background update only if no filters (to avoid unnecessary fetches for specific date ranges)
    if (!(from || to)) {
      setImmediate(async () => {
        try {
          // Fetch reservations from iCal
          const { reservations, summary } = await icalService.fetchReservations({
            properties,
            daysAhead,
            sortBy,
          });

          // Step 1: Build an array of keys to fetch
          let reservationKeys = reservations.map((r) => ({
            uid: r.uid,
            source: r.source,
          }));

          // Step 2: Fetch all existing bookings in one query
          const existingBookings = await Booking.find({
            $or: reservationKeys,
          }).lean();

          // Step 3: Build a lookup map
          const existingMap = new Map<string, any>();
          for (const b of existingBookings) {
            existingMap.set(`${b.uid}|${b.source}`, b);
          }

          // Step 4: Build upsertOps using the map
          const upsertOps = reservations.map((r) => {
            const existing = existingMap.get(`${r.uid}|${r.source}`);
            const updateSet: any = {
              propertyName: r.propertyName || DEFAULT_PROPERTY_NAME,
              start: r.start,
              end: r.end,
              description: r.description || '',
              location: r.location || '',
            };
            if (typeof existing?.guests === 'number') {
              updateSet.guests = existing.guests;
            }
            return {
              updateOne: {
                filter: { uid: r.uid, source: r.source },
                update: { $set: updateSet },
                upsert: true,
              },
            };
          });

          if (upsertOps.length) await Booking.bulkWrite(upsertOps);

          // remove old reservations not present in fetched data
          reservationKeys = reservations.map((r) => ({
            uid: r.uid,
            source: r.source,
          }));

          // delete only bookings in the future (from today 00:00) to avoid removing historical data
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          await Booking.deleteMany({
            start: { $gt: today, $lte: cutoff },
            $nor: reservationKeys,
          });

          const itemsForCalc = await Booking.find({ start: { $lte: cutoff } })
            .sort({ end: 1, start: 1 })
            .lean();
          const byProp = new Map<string, typeof itemsForCalc>();
          for (const it of itemsForCalc) {
            const key = it.propertyName || DEFAULT_PROPERTY_NAME;
            if (!byProp.has(key)) byProp.set(key, [] as any);
            (byProp.get(key) as any).push(it);
          }
          const bulkOps: any[] = [];
          byProp.forEach((arr) => {
            const changeover = new Set<string>();
            for (const a of arr) {
              const endDate = new Date(a.end).toISOString().split('T')[0];
              for (const b of arr) {
                if (String(a._id) === String(b._id)) continue;
                const startDate = new Date(b.start).toISOString().split('T')[0];
                if (endDate === startDate) changeover.add(endDate);
              }
            }
            for (const a of arr) {
              const endDate = new Date(a.end).toISOString().split('T')[0];
              bulkOps.push({
                updateOne: {
                  filter: { _id: a._id },
                  update: { $set: { isUrgentChangeover: changeover.has(endDate) } },
                },
              });
            }
          });
          if (bulkOps.length) await Booking.bulkWrite(bulkOps);
        } catch (e) {
          console.error('Background iCal update failed:', e);
        }
      });
    }
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message || 'Błąd' });
  }
});

export default router;
