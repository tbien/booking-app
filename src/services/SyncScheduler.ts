import cron, { ScheduledTask } from 'node-cron';
import { PropertyConfig } from '../models/PropertyConfig';
import { Booking } from '../models/Booking';
import { ICalExportService, ICalProperty } from './ICalExportService';
import logger from '../utils/logger';

export class SyncScheduler {
  private task: ScheduledTask | null = null;
  private icalService: ICalExportService;

  constructor() {
    this.icalService = new ICalExportService();
  }

  start(cronExpression: string = '0 * * * *'): void {
    if (!cron.validate(cronExpression)) {
      logger.error('[SyncScheduler] Invalid cron expression', { cronExpression });
      return;
    }

    logger.info('[SyncScheduler] Starting auto-sync scheduler', { cronExpression });

    this.task = cron.schedule(cronExpression, async () => {
      await this.runSync();
    });
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
      logger.info('[SyncScheduler] Stopped auto-sync scheduler');
    }
  }

  async runSync(): Promise<{
    propertiesSynced: number;
    bookingsUpdated: number;
    bookingsCancelled: number;
  }> {
    const syncId = `auto_${Date.now()}`;
    logger.info(`[SyncScheduler][${syncId}] Starting scheduled sync`);

    try {
      const properties = await PropertyConfig.find().lean();
      if (properties.length === 0) {
        logger.info(`[SyncScheduler][${syncId}] No properties configured, skipping`);
        return { propertiesSynced: 0, bookingsUpdated: 0, bookingsCancelled: 0 };
      }

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const syncEnd = new Date(tomorrow);
      syncEnd.setDate(syncEnd.getDate() + 365);
      syncEnd.setHours(23, 59, 59, 999);

      const icalProperties: ICalProperty[] = properties.map((p: any) => ({
        name: p.name,
        icalUrl: p.icalUrl,
      }));

      const { reservations, summary } = await this.icalService.fetchReservationsInRange({
        properties: icalProperties,
        from: tomorrow,
        to: syncEnd,
        sortBy: 'end',
      });

      if (summary.errors.length > 0) {
        logger.warn(`[SyncScheduler][${syncId}] iCal fetch errors`, { errors: summary.errors });
      }

      const existingBookings = await Booking.find({
        $and: [{ start: { $lte: syncEnd } }, { end: { $gte: tomorrow } }],
        source: { $in: icalProperties.map((p) => p.icalUrl) },
        isManual: { $ne: true },
      }).lean();

      const existingMap = new Map<string, any>();
      for (const b of existingBookings) {
        existingMap.set(`${b.uid}|${b.source}`, b);
      }

      const upsertOps: any[] = [];
      const cancelOps: any[] = [];

      for (const r of reservations) {
        const existing = existingMap.get(`${r.uid}|${r.source}`);
        const updateSet: any = {
          propertyName: r.propertyName || 'Nieznana',
          start: r.start,
          end: r.end,
          description: r.description || '',
          location: r.location || '',
        };
        if (typeof existing?.guests === 'number') updateSet.guests = existing.guests;
        if (existing?.notes) updateSet.notes = existing.notes;

        upsertOps.push({
          updateOne: {
            filter: { uid: r.uid, source: r.source },
            update: { $set: updateSet, $unset: { cancellationStatus: '' } },
            upsert: true,
          },
        });
        existingMap.delete(`${r.uid}|${r.source}`);
      }

      for (const [, booking] of existingMap) {
        cancelOps.push({
          updateOne: {
            filter: { _id: booking._id },
            update: { $set: { cancellationStatus: 'cancelled' } },
          },
        });
      }

      let bookingsUpdated = 0;
      let bookingsCancelled = 0;

      if (upsertOps.length > 0) {
        const result = await Booking.bulkWrite(upsertOps);
        bookingsUpdated = result.upsertedCount + result.modifiedCount;
      }
      if (cancelOps.length > 0) {
        const result = await Booking.bulkWrite(cancelOps);
        bookingsCancelled = result.modifiedCount;
      }

      logger.info(`[SyncScheduler][${syncId}] Sync completed`, {
        propertiesSynced: icalProperties.length,
        bookingsUpdated,
        bookingsCancelled,
      });

      return { propertiesSynced: icalProperties.length, bookingsUpdated, bookingsCancelled };
    } catch (e: any) {
      logger.error(`[SyncScheduler][${syncId}] Sync failed`, { error: e.message, stack: e.stack });
      return { propertiesSynced: 0, bookingsUpdated: 0, bookingsCancelled: 0 };
    }
  }
}
