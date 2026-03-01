import dotenv from 'dotenv';

dotenv.config();

const isProd = process.env.NODE_ENV === 'production';

if (isProd && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET environment variable is required in production');
}

export const config = {
  port: process.env.PORT || 4000,
  mongoURI: process.env.MONGODB_URI || 'mongodb://localhost:27017/booking-app',
  nodeEnv: process.env.NODE_ENV,
  // Admin password is stored in MongoDB (AdminCredentials collection), not in env.
  // Run `npm run init-admin` to set it up.
  sessionSecret: process.env.SESSION_SECRET || 'booking-app-dev-secret-do-not-use-in-prod',
  // Auto-sync scheduler
  syncEnabled: process.env.SYNC_ENABLED !== 'false',
  syncCron: process.env.SYNC_CRON || '0 * * * *',
  cronSecret: process.env.CRON_SECRET || '',
};
