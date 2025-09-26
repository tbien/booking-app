import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';

import { ICalExportService, ICalProperty } from './services/ICalExportService';
import { Booking } from './models/Booking';
import icalUiRoutes from './routes/ical-ui';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(cors());
if (process.env.NODE_ENV !== 'test') app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Mongo
const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/booking-app';
mongoose.connect(mongoURI as any).then(() => console.log('✅ Mongo connected')).catch(e => { console.error(e); process.exit(1); });

// UI + routes
// Upewnij się, że istnieje katalog config i plik ical-properties.json
const configDir = path.join(process.cwd(), 'config');
const configFile = path.join(configDir, 'ical-properties.json');
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}
if (!fs.existsSync(configFile)) {
  const example = [
    { name: 'Apartament 1', url: 'https://www.airbnb.pl/calendar/ical/xxxx.ics?s=token' },
    { name: 'Apartament 1', url: 'https://ical.booking.com/v1/export?t=token' }
  ];
  try { fs.writeFileSync(configFile, JSON.stringify(example, null, 2), 'utf-8'); } catch {}
}

app.use('/ui', icalUiRoutes);
app.use('/', express.static(path.join(process.cwd(), 'public', 'ui')));

// API
const icalService = new ICalExportService();

app.get('/ui/ical/data', async (req, res) => {
  try {
    const configPath = path.join(process.cwd(), 'config', 'ical-properties.json');
    let properties: ICalProperty[] = [];
    if (fs.existsSync(configPath)) properties = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
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
      return res.json({ success: true, count: items.length, rows: items });
    }

    const { reservations } = await icalService.fetchReservations({ properties, daysAhead, sortBy });
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
    res.json({ success: true, count: items.length, rows: items });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message || 'Błąd' });
  }
});

app.post('/ui/ical/guests', async (req, res) => {
  try {
    const { id, guests } = req.body || {};
    const parsed = Number(guests);
    if (!id || Number.isNaN(parsed) || parsed < 0 || parsed > 20) return res.status(400).json({ success: false, error: 'Nieprawidłowe dane (id, guests 0-20)' });
    await Booking.updateOne({ _id: id }, { $set: { guests: parsed } });
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message || 'Błąd' }); }
});

app.get('/health', (_, res) => res.json({ status: 'OK', ts: new Date().toISOString() }));

app.listen(PORT, () => console.log(`🎾 booking-app on :${PORT}`));

export default app;



