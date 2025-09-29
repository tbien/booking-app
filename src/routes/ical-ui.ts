import express from 'express';
import path from 'path';
import fs from 'fs';
import { ICalExportService, ICalProperty } from '../services/ICalExportService';
import { Booking } from '../models/Booking';
import { PropertyConfig } from '../models/PropertyConfig';
import Joi from 'joi';

const GUESTS_MIN = 0;
const GUESTS_MAX = 20;
const DEFAULT_PROPERTY_NAME = 'Nieznana';

const router = express.Router();
const icalService = new ICalExportService();

const guestSchema = Joi.object({
  id: Joi.string().required(),
  guests: Joi.number().integer().min(GUESTS_MIN).max(GUESTS_MAX).required(),
});

const propertySchema = Joi.object({
  name: Joi.string().min(1).required(),
  icalUrl: Joi.string().uri().required(),
});

router.get('/data', async (req, res) => {
  try {
    const properties: ICalProperty[] = await PropertyConfig.find().lean();
    const daysAhead = parseInt((req.query.daysAhead as string) || '35', 10);
    const sortBy = (req.query.sortBy as 'start' | 'end') || 'end';
    const fromStr = (req.query.from as string) || '';
    const toStr = (req.query.to as string) || '';
    const from = fromStr ? new Date(fromStr) : null;
    const to = toStr ? new Date(toStr) : null;

    if (from || to) {
      const rf: any = {};
      if (from) rf.$gte = from;
      if (to) rf.$lte = to;
      const items = await Booking.find({ start: rf }).sort({ end: 1, start: 1 }).lean();
      const rows = items.map((it) => ({
        id: String(it._id),
        Nieruchomość: it.propertyName || DEFAULT_PROPERTY_NAME,
        'Data rozpoczęcia': new Date(it.start).toLocaleDateString('pl-PL'),
        'Data zakończenia': new Date(it.end).toLocaleDateString('pl-PL'),
        'Status wyjazdu': it.isUrgentChangeover ? 'PILNE' : 'NORMALNE',
        Opis: it.description || '',
        Źródło: it.source,
        'Liczba gości': typeof it.guests === 'number' ? it.guests : '',
      }));
      return res.json({
        success: true,
        count: rows.length,
        summary: { mode: 'db-only' },
        rows,
      });
    }

    // Fetch reservations from iCal
    const { reservations, summary } = await icalService.fetchReservations({
      properties,
      daysAhead,
      sortBy,
    });

    const cutoff = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);

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

    const items = await Booking.find({ start: { $lte: cutoff } })
      .sort({ end: 1, start: 1 })
      .lean();
    const rows = items.map((it) => ({
      id: String(it._id),
      Nieruchomość: it.propertyName || DEFAULT_PROPERTY_NAME,
      'Data rozpoczęcia': new Date(it.start).toLocaleDateString('pl-PL'),
      'Data zakończenia': new Date(it.end).toLocaleDateString('pl-PL'),
      'Status wyjazdu': it.isUrgentChangeover ? 'PILNE' : 'NORMALNE',
      Opis: it.description || '',
      Źródło: it.source,
      'Liczba gości': typeof it.guests === 'number' ? it.guests : '',
    }));
    res.json({ success: true, count: rows.length, summary, rows });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message || 'Błąd' });
  }
});

router.post('/guests', async (req, res) => {
  try {
    const { error, value } = guestSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, error: error.message });
    await Booking.updateOne({ _id: value.id }, { $set: { guests: value.guests } });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message || 'Błąd' });
  }
});

// add routes for serving the UI

router.get('/', (req, res) => {
  const indexPath = path.join(process.cwd(), 'public', 'ui', 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else res.status(404).send('UI not found');
});

router.get('/config', (req, res) => {
  const configPath = path.join(process.cwd(), 'public', 'ui', 'config.html');
  if (fs.existsSync(configPath)) res.sendFile(configPath);
  else res.status(404).send('Config UI not found');
});

// config endpoints
router.get('/properties', async (req, res) => {
  const properties = await PropertyConfig.find().lean();
  res.json({ success: true, properties });
});

router.post('/properties', async (req, res) => {
  const { error, value } = propertySchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, error: error.message });
  await PropertyConfig.create({ name: value.name, icalUrl: value.icalUrl });
  res.json({ success: true });
});

router.put('/properties/:id', async (req, res) => {
  const { error, value } = propertySchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, error: error.message });
  await PropertyConfig.updateOne(
    { _id: req.params.id },
    { $set: { name: value.name, icalUrl: value.icalUrl } },
  );
  res.json({ success: true });
});

router.delete('/properties/:id', async (req, res) => {
  await PropertyConfig.deleteOne({ _id: req.params.id });
  res.json({ success: true });
});

export default router;
