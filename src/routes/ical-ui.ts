import express from 'express';
import path from 'path';
import fs from 'fs';
import { ICalExportService, ICalProperty } from '../services/ICalExportService';
import { Booking } from '../models/Booking';

const router = express.Router();
const icalService = new ICalExportService();

function loadPropertiesFromEnvOrFile(): ICalProperty[] {
  const envVar = process.env.ICAL_PROPERTIES;
  if (envVar) {
    try {
      const parsed = JSON.parse(envVar);
      if (Array.isArray(parsed)) return parsed as ICalProperty[];
    } catch {}
  }
  const configPath = path.join(process.cwd(), 'config', 'ical-properties.json');
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ICalProperty[];
    } catch {}
  }
  return [];
}

router.get('/ical/data', async (req, res) => {
  try {
    const properties: ICalProperty[] = loadPropertiesFromEnvOrFile();
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
      const items = await Booking.find({ start: rf }).sort({ start: 1 }).lean();
      const rows = items.map(it => ({
        'id': String(it._id),
        'Nieruchomość': it.propertyName || 'Nieznana',
        'Data rozpoczęcia': new Date(it.start).toLocaleDateString('pl-PL'),
        'Data zakończenia': new Date(it.end).toLocaleDateString('pl-PL'),
        'Status wyjazdu': it.isUrgentChangeover ? 'PILNE' : 'NORMALNE',
        'Opis': it.description || '',
        'Źródło': it.source,
        'Liczba gości': typeof it.guests === 'number' ? it.guests : ''
      }));
      return res.json({ success: true, count: rows.length, summary: { mode: 'db-only' }, rows });
    }

    const { reservations, summary } = await icalService.fetchReservations({ properties, daysAhead, sortBy });
    const nowScopeIds = new Set<string>();
    for (const r of reservations) {
      nowScopeIds.add(`${r.uid}__${r.source}`);
      await Booking.updateOne({ uid: r.uid, source: r.source }, { $set: {
        propertyName: r.propertyName || 'Nieznana', start: r.start, end: r.end, description: r.description || '', location: r.location || ''
      }}, { upsert: true });
    }
    const cutoff = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
    const itemsForCalc = await Booking.find({ start: { $lte: cutoff } }).sort({ start: 1 }).lean();
    const byProp = new Map<string, typeof itemsForCalc>();
    for (const it of itemsForCalc) {
      const key = it.propertyName || 'Nieznana';
      if (!byProp.has(key)) byProp.set(key, [] as any);
      (byProp.get(key) as any).push(it);
    }
    const bulkOps: any[] = [];
    byProp.forEach(arr => {
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
        bulkOps.push({ updateOne: { filter: { _id: a._id }, update: { $set: { isUrgentChangeover: changeover.has(endDate) } } } });
      }
    });
    if (bulkOps.length) await Booking.bulkWrite(bulkOps);

    const items = await Booking.find({ start: { $lte: cutoff } }).sort({ start: 1 }).lean();
    const rows = items.map(it => ({
      'id': String(it._id),
      'Nieruchomość': it.propertyName || 'Nieznana',
      'Data rozpoczęcia': new Date(it.start).toLocaleDateString('pl-PL'),
      'Data zakończenia': new Date(it.end).toLocaleDateString('pl-PL'),
      'Status wyjazdu': it.isUrgentChangeover ? 'PILNE' : 'NORMALNE',
      'Opis': it.description || '',
      'Źródło': it.source,
      'Liczba gości': typeof it.guests === 'number' ? it.guests : ''
    }));
    res.json({ success: true, count: rows.length, summary, rows });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message || 'Błąd' }); }
});

router.post('/ical/guests', async (req, res) => {
  try {
    const { id, guests } = req.body || {};
    const parsed = Number(guests);
    if (!id || Number.isNaN(parsed) || parsed < 0 || parsed > 20) return res.status(400).json({ success: false, error: 'Nieprawidłowe dane (id, guests 0-20)' });
    await Booking.updateOne({ _id: id }, { $set: { guests: parsed } });
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message || 'Błąd' }); }
});

router.get('/', (req, res) => {
  const indexPath = path.join(process.cwd(), 'public', 'ui', 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath); else res.status(404).send('UI not found');
});

export default router;


