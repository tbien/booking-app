import express from 'express';
import { ICalExportService, ICalProperty } from '../../services/ICalExportService';
import { Booking } from '../../models/Booking';
import { PropertyConfig } from '../../models/PropertyConfig';
import { DEFAULT_PROPERTY_NAME } from './shared';
import logger from '../../utils/logger';
import { SyncScheduler } from '../../services/SyncScheduler';

const router = express.Router();
const icalService = new ICalExportService();

router.post('/sync', async (req, res) => {
  const startTime = Date.now();
  const syncId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  logger.info(`[${syncId}] Starting iCal sync`, {
    from: req.body.from || 'today',
    to: req.body.to || 'today+35days',
    groupId: req.body.groupId || 'all',
    propertyNames: req.body.propertyNames || 'all',
  });

  try {
    const groupId = (req.body.groupId as string) || '';
    const propertyNames = (req.body.propertyNames as string) || '';
    const fromStr = (req.body.from as string) || '';
    const toStr = (req.body.to as string) || '';

    // Parse date strings or use defaults (today + 35 days)
    const parseDate = (dateStr: string): Date => {
      const [y, m, d] = dateStr.split('-').map(Number);
      return new Date(y, m - 1, d);
    };

    // Sync window: ALWAYS from tomorrow to maintain historical data integrity
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    let syncStart: Date;
    let syncEnd: Date;

    if (fromStr && toStr) {
      // Use provided dates but ensure we don't update historical data
      syncStart = parseDate(fromStr);
      syncStart.setHours(0, 0, 0, 0);

      // If fromDate is in the past, start from tomorrow
      if (syncStart < tomorrow) {
        syncStart = tomorrow;
      }

      syncEnd = parseDate(toStr);
      syncEnd.setHours(23, 59, 59, 999);
    } else {
      // Default: sync from tomorrow for 365 days (same as SyncScheduler)
      syncStart = tomorrow;
      syncEnd = new Date(tomorrow);
      syncEnd.setDate(syncEnd.getDate() + 365);
      syncEnd.setHours(23, 59, 59, 999);
    }

    // If entire range is in the past, skip sync to preserve historical data
    if (syncEnd < tomorrow) {
      const message =
        'Zakres dat jest w przeszłości. Synchronizacja pomija dane historyczne aby je zachować.';
      logger.info(`[${syncId}] Skipping sync for historical date range`, {
        from: syncStart.toISOString(),
        to: syncEnd.toISOString(),
        reason: 'Historical data preservation',
      });
      return res.json({
        success: true,
        message,
        stats: { propertiesSynced: 0, bookingsUpdated: 0, bookingsCancelled: 0 },
        syncId,
        duration: Date.now() - startTime,
      });
    }

    logger.debug(`[${syncId}] Sync window calculated`, {
      from: syncStart.toISOString(),
      to: syncEnd.toISOString(),
      note: 'Historical data (before tomorrow) is preserved',
    });

    // Build property filter
    let propertyQuery: any = {};
    if (groupId) {
      propertyQuery.groupId = groupId;
      logger.debug(`[${syncId}] Filtering by group`, { groupId });
    }
    if (propertyNames) {
      const names = propertyNames
        .split(',')
        .map((n: string) => n.trim())
        .filter(Boolean);
      if (names.length > 0) {
        propertyQuery.name = { $in: names };
        logger.debug(`[${syncId}] Filtering by properties`, { properties: names });
      }
    }

    // Get properties to sync
    const properties = await PropertyConfig.find(propertyQuery).lean();
    logger.info(`[${syncId}] Properties query completed`, { count: properties.length });

    if (properties.length === 0) {
      const message = 'No properties found to sync. Check your filters or add iCal sources.';
      logger.warn(`[${syncId}] No properties to sync`, { message });
      return res.json({
        success: true,
        message,
        stats: { propertiesSynced: 0, bookingsUpdated: 0, bookingsCancelled: 0 },
        syncId,
        duration: Date.now() - startTime,
      });
    }

    const icalProperties: ICalProperty[] = properties.map((p: any) => ({
      name: p.name,
      icalUrl: p.icalUrl,
    }));

    // Fetch reservations from iCal using the calculated date range
    logger.info(`[${syncId}] Starting iCal data fetch`, {
      sourceCount: icalProperties.length,
      from: syncStart.toISOString(),
      to: syncEnd.toISOString(),
    });
    const { reservations, summary } = await icalService.fetchReservationsInRange({
      properties: icalProperties,
      from: syncStart,
      to: syncEnd,
      sortBy: 'end',
    });

    logger.info(`[${syncId}] iCal fetch completed`, {
      totalReservations: summary.totalReservations,
      successfulUrls: summary.successfulUrls,
      failedUrls: summary.failedUrls,
    });

    if (summary.errors.length > 0) {
      logger.warn(`[${syncId}] iCal fetch errors detected`, { errors: summary.errors });
    }

    // Get existing bookings in the sync window (only future bookings from tomorrow)
    const existingBookings = await Booking.find({
      $and: [{ start: { $lte: syncEnd } }, { end: { $gte: syncStart } }],
      source: { $in: icalProperties.map((p) => p.icalUrl) },
      isManual: { $ne: true }, // never touch manual (merged/split) bookings
    }).lean();

    logger.debug(`[${syncId}] Existing bookings query completed`, {
      count: existingBookings.length,
    });

    // All iCal-sourced bookings go into the sync map (manual bookings have source='manual'
    // so they are never in existingBookings and are never auto-cancelled).
    const existingMap = new Map<string, any>();
    for (const b of existingBookings) {
      existingMap.set(`${b.uid}|${b.source}`, b);
    }

    // Build a set of original booking IDs that are currently hidden by an active manual booking.
    // These must NOT have their cancellationStatus cleared by sync — they stay hidden.
    const syncedPropertyNames = properties.map((p: any) => p.name);
    const activeManuals = await Booking.find(
      {
        isManual: true,
        propertyName: { $in: syncedPropertyNames },
        cancellationStatus: { $exists: false },
      },
      { mergedFromIds: 1, splitFromId: 1 },
    ).lean();
    const hiddenByManual = new Set<string>();
    for (const m of activeManuals) {
      for (const oid of (m as any).mergedFromIds || []) hiddenByManual.add(String(oid));
      if ((m as any).splitFromId) hiddenByManual.add(String((m as any).splitFromId));
    }

    // Prepare operations
    const upsertOps = [];
    const cancelOps = [];

    // Process reservations from iCal
    logger.info(`[${syncId}] Processing iCal reservations`, { count: reservations.length });
    for (const r of reservations) {
      const existing = existingMap.get(`${r.uid}|${r.source}`);
      const updateSet: any = {
        propertyName: r.propertyName || DEFAULT_PROPERTY_NAME,
        start: r.start,
        end: r.end,
        description: r.description || '',
        location: r.location || '',
      };

      // Preserve user data
      if (typeof existing?.guests === 'number') updateSet.guests = existing.guests;
      if (existing?.notes) updateSet.notes = existing.notes;

      // If this booking is currently hidden by an active manual (merged/split) booking,
      // do NOT clear its cancellationStatus — it must stay hidden until the manual is undone.
      const isHidden = existing && hiddenByManual.has(String(existing._id));
      const updateOp: any = { $set: updateSet };
      if (!isHidden) {
        updateOp.$unset = { cancellationStatus: '' };
      }

      upsertOps.push({
        updateOne: {
          filter: { uid: r.uid, source: r.source },
          update: updateOp,
          upsert: true,
        },
      });

      // Remove from existing map (these are still active)
      existingMap.delete(`${r.uid}|${r.source}`);
    }

    // Remaining bookings in existingMap are missing from iCal - mark as cancelled
    const bookingsToCancel = existingMap.size;
    logger.info(`[${syncId}] Bookings to cancel`, { count: bookingsToCancel });
    for (const [key, booking] of existingMap) {
      cancelOps.push({
        updateOne: {
          filter: { _id: booking._id },
          update: { $set: { cancellationStatus: 'cancelled' } },
        },
      });
    }

    // Detect conflicts: a manual (merged/split) booking has a conflict when at least one
    // of its original source bookings changed its dates in iCal compared to the snapshot
    // taken at the time of the manual operation.
    // Originals are never cancelled — they stay in DB and get updated by sync normally.
    // We just need to alert the user so they can decide whether to keep or remove the manual booking.
    const icalByKey = new Map<string, (typeof reservations)[0]>();
    for (const r of reservations) {
      icalByKey.set(`${r.uid}|${r.source}`, r);
    }

    const toDay = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

    // Re-use activeManuals fetched above (already filtered by syncedPropertyNames).
    // Extend the projection to include fields needed for conflict detection.
    // (We fetch again with fuller projection to get sourceSnapshot.)
    const manualsForConflicts = await Booking.find(
      {
        isManual: true,
        propertyName: { $in: syncedPropertyNames },
        cancellationStatus: { $exists: false },
      },
      { _id: 1, propertyName: 1, start: 1, end: 1, manualType: 1, sourceSnapshot: 1 },
    ).lean();

    const conflicts: any[] = [];
    for (const manual of manualsForConflicts) {
      const snapshot: Array<{ uid: string; source: string; start: Date; end: Date }> =
        (manual as any).sourceSnapshot || [];

      if (snapshot.length === 0) continue; // legacy bookings without snapshot — skip

      const changedOriginals: Array<{
        uid: string;
        snapshotStart: string;
        snapshotEnd: string;
        newStart: string;
        newEnd: string;
      }> = [];

      for (const snap of snapshot) {
        const current = icalByKey.get(`${snap.uid}|${snap.source}`);
        if (!current) continue; // outside sync window — not a conflict

        const snapStart = toDay(snap.start);
        const snapEnd = toDay(snap.end);
        const curStart = toDay(current.start);
        const curEnd = toDay(current.end);

        if (snapStart !== curStart || snapEnd !== curEnd) {
          changedOriginals.push({
            uid: snap.uid,
            snapshotStart: snapStart,
            snapshotEnd: snapEnd,
            newStart: curStart,
            newEnd: curEnd,
          });
        }
      }

      if (changedOriginals.length > 0) {
        conflicts.push({
          manualBooking: {
            id: String(manual._id),
            propertyName: (manual as any).propertyName,
            start: (manual as any).start,
            end: (manual as any).end,
            manualType: (manual as any).manualType,
          },
          changedOriginals,
          reason:
            changedOriginals.length === 1
              ? 'Jedna z oryginalnych rezerwacji zmieniła daty w iCal po wykonaniu scalenia/podziału.'
              : `${changedOriginals.length} z oryginalnych rezerwacji zmieniły daty w iCal po wykonaniu scalenia/podziału.`,
        });
      }
    }

    // Execute operations
    let bookingsUpdated = 0;
    let bookingsCancelled = 0;

    try {
      if (upsertOps.length > 0) {
        logger.debug(`[${syncId}] Executing upsert operations`, { count: upsertOps.length });
        const upsertResult = await Booking.bulkWrite(upsertOps);
        bookingsUpdated = upsertResult.upsertedCount + upsertResult.modifiedCount;
        logger.info(`[${syncId}] Upsert operations completed`, { updated: bookingsUpdated });
      }

      if (cancelOps.length > 0) {
        logger.debug(`[${syncId}] Executing cancellation operations`, { count: cancelOps.length });
        const cancelResult = await Booking.bulkWrite(cancelOps);
        bookingsCancelled = cancelResult.modifiedCount;
        logger.info(`[${syncId}] Cancellation operations completed`, {
          cancelled: bookingsCancelled,
        });
      }
    } catch (dbError: any) {
      logger.error(`[${syncId}] Database operation failed`, {
        error: dbError.message,
        stack: dbError.stack,
      });
      throw new Error(`Database error during sync: ${dbError.message}`);
    }

    // Update changeover flags for active bookings within window
    logger.debug(`[${syncId}] Starting changeover flag updates`);
    const activeBookings = await Booking.find({
      $and: [{ start: { $lte: syncEnd } }, { end: { $gte: syncStart } }],
      cancellationStatus: { $ne: 'cancelled' },
    })
      .sort({ end: 1, start: 1 })
      .lean();

    const byProp = new Map<string, typeof activeBookings>();
    for (const it of activeBookings) {
      const key = it.propertyName || DEFAULT_PROPERTY_NAME;
      if (!byProp.has(key)) byProp.set(key, []);
      byProp.get(key)!.push(it);
    }

    const changeoverOps: any[] = [];
    const toLocalDay = (d: Date | string) => {
      const dt = new Date(d);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    byProp.forEach((arr) => {
      const changeover = new Set<string>();
      for (const a of arr) {
        const endDate = toLocalDay(a.end);
        for (const b of arr) {
          if (String(a._id) === String(b._id)) continue;
          const startDate = toLocalDay(b.start);
          if (endDate === startDate) changeover.add(endDate);
        }
      }
      for (const a of arr) {
        const endDate = toLocalDay(a.end);
        changeoverOps.push({
          updateOne: {
            filter: { _id: a._id },
            update: { $set: { isUrgentChangeover: changeover.has(endDate) } },
          },
        });
      }
    });

    if (changeoverOps.length > 0) {
      logger.debug(`[${syncId}] Executing changeover updates`, { count: changeoverOps.length });
      await Booking.bulkWrite(changeoverOps);
    }

    const duration = Date.now() - startTime;
    const successMessage = `Synchronizacja zakończona! Zsynchronizowano ${icalProperties.length} nieruchomości, zaktualizowano ${bookingsUpdated} rezerwacji, anulowano ${bookingsCancelled} rezerwacji.`;

    logger.info(`[${syncId}] Sync completed successfully`, {
      duration,
      propertiesSynced: icalProperties.length,
      bookingsUpdated,
      bookingsCancelled,
    });

    res.json({
      success: true,
      message: successMessage,
      stats: {
        propertiesSynced: icalProperties.length,
        bookingsUpdated,
        bookingsCancelled,
        icalSummary: summary,
      },
      conflicts,
      syncId,
      duration,
    });
  } catch (e: any) {
    const duration = Date.now() - startTime;
    logger.error(`[${syncId}] Sync failed`, {
      duration,
      error: e.message,
      stack: e.stack,
    });

    // Determine error type and provide helpful message
    let errorMessage = 'Wystąpił błąd podczas synchronizacji.';
    let errorDetails = '';

    if (e.message?.includes('fetch')) {
      errorMessage = 'Błąd pobierania danych z iCal. Sprawdź połączenia internetowe i adresy URL.';
      errorDetails = 'Problem z połączeniem do zewnętrznych źródeł iCal.';
    } else if (e.message?.includes('Database') || e.message?.includes('Mongo')) {
      errorMessage = 'Błąd bazy danych podczas synchronizacji.';
      errorDetails = 'Problem z zapisem danych. Spróbuj ponownie za chwilę.';
    } else if (e.message?.includes('timeout')) {
      errorMessage = 'Przekroczono limit czasu synchronizacji.';
      errorDetails =
        'Operacja trwała zbyt długo. Spróbuj synchronizować mniejszą liczbę nieruchomości.';
    } else {
      errorDetails = e.message || 'Nieznany błąd.';
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      details: errorDetails,
      syncId,
      duration,
    });
  }
});

// POST /ical/sync-all — trigger full sync for all properties
// Protected by X-Cron-Secret header (for internal/external scheduler use)
router.post('/sync-all', async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const scheduler = new SyncScheduler();
    const result = await scheduler.runSync();
    res.json({ success: true, ...result });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
