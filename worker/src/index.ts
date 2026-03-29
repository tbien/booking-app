/**
 * Cloudflare Workers entry point for booking-app.
 *
 * Uses Hono as the HTTP framework and Mongoose for MongoDB access.
 * Sessions are replaced with JWT stored in an HttpOnly cookie.
 *
 * Required Worker Secrets (set via `wrangler secret put`):
 *   MONGODB_URI       — MongoDB Atlas connection string
 *   SESSION_SECRET    — arbitrary secret for signing JWTs (≥32 chars)
 *
 * Optional:
 *   ADMIN_INIT_PASSWORD — initial admin password (only used when no admin exists)
 */

import { Hono } from 'hono';
import { logger } from 'hono/logger';
import bcrypt from 'bcryptjs';

import { connectDB } from './lib/db';
import { authMiddleware } from './middleware/auth';

// Routes
import authRoutes from './routes/auth';
import icalGroupsRoutes from './routes/ical/groups';
import icalGuestsRoutes from './routes/ical/guests';
import icalNotesRoutes from './routes/ical/notes';
import icalSettingsRoutes from './routes/ical/settings';
import icalBlocksRoutes from './routes/ical/blocks';
import icalMergeRoutes from './routes/ical/merge';
import icalFetchRoutes from './routes/ical/fetch';
import icalExportRoutes from './routes/ical/export';
import icalSummaryRoutes from './routes/ical/summary';
import icalDataRoutes from './routes/ical/data';
import icalSyncRoutes from './routes/ical/sync';
import icalPropertiesRoutes from './routes/ical/properties';

import { AdminCredentials } from '../../src/models/AdminCredentials';
import { runSyncCore } from './routes/ical/sync';

// ── Environment bindings type ─────────────────────────────────────────────────
export type Env = {
  MONGODB_URI: string;
  SESSION_SECRET: string;
  ADMIN_INIT_PASSWORD?: string;
  NODE_ENV?: string;
  SYNC_ENABLED?: string;
};

export type Variables = {
  userId: string;
  role: 'admin' | 'user';
};

export type AppEnv = { Bindings: Env; Variables: Variables };

// ── Hono app ──────────────────────────────────────────────────────────────────
const app = new Hono<AppEnv>();

app.use('*', logger());

// Global error handler — must be registered before routes
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ success: false, error: err.message }, 500);
});

// DB connection middleware — runs before every request
app.use('*', async (c, next) => {
  await connectDB(c.env.MONGODB_URI);
  await next();
});

// JWT session middleware — populates c.get('userId') and c.get('role') if logged in
app.use('*', authMiddleware);

// ── Auth ──────────────────────────────────────────────────────────────────────
app.route('/', authRoutes);

// ── iCal export (public, no auth) ─────────────────────────────────────────────
app.route('/ical', icalExportRoutes);

// ── Public read routes ────────────────────────────────────────────────────────
app.route('/ical', icalDataRoutes);
app.route('/ical', icalFetchRoutes);
app.route('/ical', icalSummaryRoutes);
app.route('/ical', icalGroupsRoutes);
app.route('/ical', icalSettingsRoutes);
app.route('/ical', icalSyncRoutes);
app.route('/ical', icalPropertiesRoutes);

// ── Admin-only routes ─────────────────────────────────────────────────────────
app.route('/ical', icalGuestsRoutes);
app.route('/ical', icalNotesRoutes);
app.route('/ical', icalMergeRoutes);
app.route('/ical', icalBlocksRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── CF Worker export ──────────────────────────────────────────────────────────
export default {
  /** Handle HTTP requests */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Auto-initialise admin password on first deploy (if ADMIN_INIT_PASSWORD is set)
    if (env.ADMIN_INIT_PASSWORD) {
      ctx.waitUntil(
        (async () => {
          try {
            await connectDB(env.MONGODB_URI);
            const existing = await AdminCredentials.findOne({ userId: 'admin' });
            if (!existing) {
              const hash = await bcrypt.hash(env.ADMIN_INIT_PASSWORD!, 12);
              await AdminCredentials.create({ userId: 'admin', passwordHash: hash });
              console.log('✅ Admin password initialised from ADMIN_INIT_PASSWORD');
            }
          } catch (err) {
            console.error('Admin init error:', err);
          }
        })(),
      );
    }

    return app.fetch(request, env, ctx);
  },

  /** Cloudflare Cron Trigger — runs the iCal sync on schedule (set in wrangler.toml) */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const syncEnabled = env.SYNC_ENABLED !== 'false';
    if (!syncEnabled) {
      console.log('ℹ️  Scheduled sync disabled (SYNC_ENABLED=false)');
      return;
    }

    console.log('🔄 Cron trigger: starting scheduled iCal sync');
    try {
      await connectDB(env.MONGODB_URI);
      const result = await runSyncCore({ force: true, syncId: `cron_${event.scheduledTime}` });
      console.log('✅ Scheduled sync completed', result.stats);
    } catch (err) {
      console.error('❌ Scheduled sync failed:', err);
    }
  },
};
