import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import icalSummaryRoutes from './routes/ical/summary';
import icalPropertiesRoutes from './routes/ical/properties';
import icalGuestsRoutes from './routes/ical/guests';
import icalNotesRoutes from './routes/ical/notes';
import icalDataRoutes from './routes/ical/data';
import icalFetchRoutes from './routes/ical/fetch';
import icalUiApiRoutes from './routes/ical/ui';
import icalGroupsRoutes from './routes/ical/groups';
import icalSyncRoutes from './routes/ical/sync';
import icalSettingsRoutes from './routes/ical/settings';
import icalMergeRoutes from './routes/ical/merge';
import icalExportRoutes from './routes/ical/export';
import icalBlocksRoutes from './routes/ical/blocks';
import authRoutes from './routes/auth';
import { requireAdmin } from './middleware/auth';
import { SyncScheduler } from './services/SyncScheduler';

import { config } from './config';
import { AdminCredentials } from './models/AdminCredentials';
import bcrypt from 'bcryptjs';

const app = express();
const PORT = config.port;

// Trust Render's reverse proxy so req.secure works and secure cookies are set correctly
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(cors());
if (config.nodeEnv !== 'test') app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Mongo
const mongoURI = config.mongoURI;
const isTLS =
  (mongoURI as string).startsWith('mongodb+srv') || (mongoURI as string).includes('ssl=true');
mongoose
  .connect(mongoURI as string, isTLS ? { tls: true, tlsAllowInvalidCertificates: false } : {})
  .then(async () => {
    console.log('✅ Mongo connected');
    // Auto-init admin password from env var on first deploy (no shell access needed)
    const initPassword = process.env.ADMIN_INIT_PASSWORD;
    if (initPassword) {
      const existing = await AdminCredentials.findOne({ userId: 'admin' });
      if (!existing) {
        const hash = await bcrypt.hash(initPassword, 12);
        await AdminCredentials.create({ userId: 'admin', passwordHash: hash });
        console.log('✅ Admin password initialized from ADMIN_INIT_PASSWORD env var');
      } else {
        console.log('ℹ️  Admin credentials already exist, skipping auto-init');
      }
    }

    // Start auto-sync scheduler
    const syncEnabled = process.env.SYNC_ENABLED !== 'false';
    if (syncEnabled) {
      const syncCron = process.env.SYNC_CRON || '0 * * * *';
      const scheduler = new SyncScheduler();
      scheduler.start(syncCron);
    } else {
      console.log('ℹ️  Auto-sync disabled (SYNC_ENABLED=false)');
    }
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

// Session middleware
app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: mongoURI as string,
      ttl: 7 * 24 * 60 * 60, // 7 dni w sekundach
      autoRemove: 'native',
    }),
    cookie: {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dni
      sameSite: 'lax',
      secure: config.nodeEnv === 'production', // działa poprawnie dzięki trust proxy
    },
  }),
);

// Auth routes (public – login/logout/me)
app.use('/', authRoutes);

// Public iCal export feed (no auth – Booking.com/Airbnb subscribes to this)
app.use('/ical', icalExportRoutes);

// Serve login page (public)
app.get('/login', (req, res) => {
  const loginPath = path.join(process.cwd(), 'public', 'ui', 'login.html');
  if (fs.existsSync(loginPath)) res.sendFile(loginPath);
  else res.status(404).send('Login page not found');
});

// Config page – admin only
app.get('/config', requireAdmin, (req, res) => {
  const configPath = path.join(process.cwd(), 'public', 'ui', 'config.html');
  if (fs.existsSync(configPath)) res.sendFile(configPath);
  else res.status(404).send('Config UI not found');
});

// Calendar page – public view (view-only when not admin)
app.get('/calendar', (req, res) => {
  const calendarPath = path.join(process.cwd(), 'public', 'ui', 'calendar.html');
  if (fs.existsSync(calendarPath)) res.sendFile(calendarPath);
  else res.status(404).send('Calendar UI not found');
});

// Static files (public)
app.use('/', express.static(path.join(process.cwd(), 'public', 'ui')));

// Public read routes (user + admin)
app.use('/ical', icalDataRoutes);
app.use('/ical', icalFetchRoutes);
app.use('/ical', icalSummaryRoutes);
app.use('/ical', icalUiApiRoutes);
app.use('/ical', icalGroupsRoutes); // GET /groups is public; POST/PUT/DELETE guarded inside router
app.use('/ical', icalSettingsRoutes); // GET /settings public; PUT guarded inside router

// Sync jest publiczny – czyta tylko zewnętrzne feedy iCal, nie zwraca wrażliwych danych
app.use('/ical', icalSyncRoutes);

// Admin-only routes (properties router exposes public GETs; admin-only endpoints are guarded inside the router)
app.use('/ical', icalPropertiesRoutes);
app.use('/ical', requireAdmin, icalGuestsRoutes);
app.use('/ical', requireAdmin, icalNotesRoutes);
app.use('/ical', requireAdmin, icalMergeRoutes);
app.use('/ical', requireAdmin, icalBlocksRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(Number(PORT), '0.0.0.0', () => console.log(`🎾 booking-app on :${PORT}`));

export default app;
