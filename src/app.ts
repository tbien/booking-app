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
import icalExportRoutes from './routes/ical-export';
import authRoutes from './routes/auth';
import v1Routes from './routes/v1';
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

    // Start server-side auto-sync scheduler (default: once per day at midnight)
    const syncEnabled = process.env.SYNC_ENABLED !== 'false';
    if (syncEnabled) {
      const syncCron = process.env.SYNC_CRON || '0 0 * * *';
      const scheduler = new SyncScheduler();
      scheduler.start(syncCron);
      console.log(`🔄 Auto-sync scheduler started (cron: ${syncCron})`);
      // Run initial sync immediately on startup (fire-and-forget)
      scheduler.runSync().catch((err) => {
        console.error('❌ Initial sync on startup failed:', err);
      });
      console.log('🔄 Initial sync triggered on startup (running in background)');
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

// ── V1 REST API ──────────────────────────────────────────────────────────────
app.use('/api/v1', v1Routes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Vue SPA static files ─────────────────────────────────────────────────────
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  // SPA fallback: serve index.html for any non-API route
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.listen(Number(PORT), '0.0.0.0', () => console.log(`🎾 booking-app on :${PORT}`));

export default app;
