import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { config } from '../config';
import { AdminCredentials } from '../models/AdminCredentials';
import { SyncScheduler } from '../services/SyncScheduler';

/**
 * Connect to MongoDB, auto-init admin credentials, start sync scheduler.
 * Exits the process on connection failure.
 */
export async function initDatabase(): Promise<void> {
  const mongoURI = config.mongoURI as string;
  const isTLS = mongoURI.startsWith('mongodb+srv') || mongoURI.includes('ssl=true');

  try {
    await mongoose.connect(mongoURI, isTLS ? { tls: true, tlsAllowInvalidCertificates: false } : {});
    console.log('✅ Mongo connected');

    await initAdminCredentials();
    initSyncScheduler();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

async function initAdminCredentials(): Promise<void> {
  const initPassword = process.env.ADMIN_INIT_PASSWORD;
  if (!initPassword) return;

  const existing = await AdminCredentials.findOne({ userId: 'admin' });
  if (!existing) {
    const hash = await bcrypt.hash(initPassword, 12);
    await AdminCredentials.create({ userId: 'admin', passwordHash: hash });
    console.log('✅ Admin password initialized from ADMIN_INIT_PASSWORD env var');
  } else {
    console.log('ℹ️  Admin credentials already exist, skipping auto-init');
  }
}

function initSyncScheduler(): void {
  const syncEnabled = process.env.SYNC_ENABLED !== 'false';
  if (!syncEnabled) {
    console.log('ℹ️  Auto-sync disabled (SYNC_ENABLED=false)');
    return;
  }

  const syncCron = process.env.SYNC_CRON || '0 0 * * *';
  const scheduler = new SyncScheduler();
  scheduler.start(syncCron);
  console.log(`🔄 Auto-sync scheduler started (cron: ${syncCron})`);

  scheduler.runSync().catch((err) => {
    console.error('❌ Initial sync on startup failed:', err);
  });
  console.log('🔄 Initial sync triggered on startup (running in background)');
}
