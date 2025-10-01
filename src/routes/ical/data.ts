import express from 'express';
import { ICalExportService, ICalProperty } from '../../services/ICalExportService';
import { Booking } from '../../models/Booking';
import { PropertyConfig } from '../../models/PropertyConfig';
import { mapBookingsToRows, DEFAULT_PROPERTY_NAME } from './shared';

const router = express.Router();
const icalService = new ICalExportService();

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
    let best: { g: string; c: number } | null = null;
    counts.forEach((c: number, g: string) => {
      if (!best || c > best.c) best = { g, c };
    });
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
    const from = fromStr ? new Date(fromStr) : null;
    const to = toStr ? new Date(toStr) : null;
    const all = req.query.all === 'true';
    const page = parseInt((req.query.page as string) || '1', 10);
    const limit = parseInt((req.query.limit as string) || (all ? '1000' : '30'), 10);

    let query: any = {};
    if (!all) {
      const cutoff = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
      query = { start: { $lte: cutoff } };
    }
    if (from || to) {
      const rf: any = {};
      if (from) rf.$gte = from;
      if (to) rf.$lte = to;
      query = { end: rf };
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
      summary: { mode: from || to ? 'db-only' : 'db' },
      rows,
    });

    if (!(from || to)) {
      setImmediate(async () => {
        try {
          const icalProperties: ICalProperty[] = properties.map((p: any) => ({
            name: p.name,
            icalUrl: p.icalUrl,
          }));

          const { reservations } = await icalService.fetchReservations({
            properties: icalProperties,
            daysAhead,
            sortBy,
          });

          const cutoff = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);

          let reservationKeys = reservations.map((r) => ({ uid: r.uid, source: r.source }));
          const existingBookings = await Booking.find({ $or: reservationKeys }).lean();
          const existingMap = new Map<string, any>();
          for (const b of existingBookings) existingMap.set(`${b.uid}|${b.source}`, b);

          const upsertOps = reservations.map((r) => {
            const existing = existingMap.get(`${r.uid}|${r.source}`);
            const updateSet: any = {
              propertyName: r.propertyName || DEFAULT_PROPERTY_NAME,
              start: r.start,
              end: r.end,
              description: r.description || '',
              location: r.location || '',
            };
            if (typeof existing?.guests === 'number') updateSet.guests = existing.guests;
            return {
              updateOne: {
                filter: { uid: r.uid, source: r.source },
                update: { $set: updateSet },
                upsert: true,
              },
            };
          });
          if (upsertOps.length) await Booking.bulkWrite(upsertOps);

          reservationKeys = reservations.map((r) => ({ uid: r.uid, source: r.source }));
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          await Booking.deleteMany({ start: { $gt: today, $lte: cutoff }, $nor: reservationKeys });

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
