import express from 'express';
import { ICalExportService, ICalProperty } from '../../services/ICalExportService';
import { Booking } from '../../models/Booking';
import { PropertyConfig } from '../../models/PropertyConfig';
import { DEFAULT_PROPERTY_NAME } from './shared';
import logger from '../../utils/logger';

const router = express.Router();
const icalService = new ICalExportService();

router.post('/sync', async (req, res) => {
  const startTime = Date.now();
  const syncId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  logger.info(`[${syncId}] Starting iCal sync`, {
    daysAhead: req.body.daysAhead || 35,
    groupId: req.body.groupId || 'all',
    propertyNames: req.body.propertyNames || 'all',
  });

  try {
    const daysAhead = parseInt((req.body.daysAhead as string) || '35', 10);
    const groupId = (req.body.groupId as string) || '';
    const propertyNames = (req.body.propertyNames as string) || '';

    // Calculate sync window
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() + daysAhead);

    logger.debug(`[${syncId}] Sync window calculated`, {
      from: today.toISOString(),
      to: cutoff.toISOString(),
      daysAhead,
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

    // Fetch reservations from iCal
    logger.info(`[${syncId}] Starting iCal data fetch`, { sourceCount: icalProperties.length });
    const { reservations, summary } = await icalService.fetchReservations({
      properties: icalProperties,
      daysAhead,
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

    // Get existing bookings that overlap the sync window (start <= cutoff && end >= today)
    const existingBookings = await Booking.find({
      $and: [{ start: { $lte: cutoff } }, { end: { $gte: today } }],
      source: { $in: icalProperties.map((p) => p.icalUrl) },
    }).lean();

    logger.debug(`[${syncId}] Existing bookings query completed`, {
      count: existingBookings.length,
    });

    const existingMap = new Map<string, any>();
    for (const b of existingBookings) {
      existingMap.set(`${b.uid}|${b.source}`, b);
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
        cancellationStatus: null, // Ensure active
      };

      // Preserve user data
      if (typeof existing?.guests === 'number') updateSet.guests = existing.guests;
      if (existing?.notes) updateSet.notes = existing.notes;

      upsertOps.push({
        updateOne: {
          filter: { uid: r.uid, source: r.source },
          update: { $set: updateSet },
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
      $and: [{ start: { $lte: cutoff } }, { end: { $gte: today } }],
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

export default router;
