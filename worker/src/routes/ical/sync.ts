import { Hono } from 'hono';
import { ICalExportService, type ICalProperty } from '../../../../src/services/ICalExportService';
import { Booking } from '../../../../src/models/Booking';
import { PropertyConfig } from '../../../../src/models/PropertyConfig';
import { Property } from '../../../../src/models/Property';
import { AppSettings } from '../../../../src/models/AppSettings';
import { DEFAULT_PROPERTY_NAME } from '../../../../src/routes/ical/shared';
import { requireAdmin } from '../../middleware/auth';
import type { AppEnv } from '../../index';

const router = new Hono<AppEnv>();
const icalService = new ICalExportService();

/** Core sync logic — shared between the HTTP endpoint and the cron trigger. */
export async function runSyncCore(opts: {
  groupId?: string;
  propertyNames?: string;
  fromStr?: string;
  toStr?: string;
  force?: boolean;
  syncId?: string;
}): Promise<{
  success: boolean;
  message: string;
  skipped?: boolean;
  stats: { propertiesSynced: number; bookingsUpdated: number; bookingsCancelled: number };
  conflicts?: any[];
  syncId: string;
  duration: number;
}> {
  const startTime = Date.now();
  const syncId = opts.syncId || `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // 1h throttle unless forced
  if (!opts.force) {
    try {
      const settings = await AppSettings.findOne({ key: 'global' }).lean();
      const lastSync: Date | null = (settings as any)?.lastSyncAt || null;
      if (lastSync) {
        const hoursSince = (Date.now() - new Date(lastSync).getTime()) / (1000 * 3600);
        if (hoursSince < 1) {
          const allConfigs = await PropertyConfig.find({}, { icalUrl: 1 }).lean();
          const allUrls = allConfigs.map((p: any) => p.icalUrl).filter(Boolean);
          const syncedUrls: string[] = await Booking.distinct('source', {
            source: { $in: allUrls },
            isManual: { $ne: true },
          });
          const hasNewProperty = allUrls.some((url: string) => !syncedUrls.includes(url));
          if (!hasNewProperty) {
            return {
              success: true,
              skipped: true,
              message: `Synchronizacja jest aktualna (ostatnia: ${new Date(lastSync).toLocaleString('pl-PL')}).`,
              stats: { propertiesSynced: 0, bookingsUpdated: 0, bookingsCancelled: 0 },
              syncId,
              duration: Date.now() - startTime,
            };
          }
        }
      }
    } catch {
      // if check fails, proceed
    }
  }

  const parseDate = (dateStr: string): Date => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  let syncStart: Date;
  let syncEnd: Date;

  if (opts.fromStr && opts.toStr) {
    syncStart = parseDate(opts.fromStr);
    syncStart.setHours(0, 0, 0, 0);
    if (syncStart < tomorrow) syncStart = tomorrow;
    syncEnd = parseDate(opts.toStr);
    syncEnd.setHours(23, 59, 59, 999);
  } else {
    syncStart = tomorrow;
    syncEnd = new Date(tomorrow);
    syncEnd.setDate(syncEnd.getDate() + 365);
    syncEnd.setHours(23, 59, 59, 999);
  }

  if (syncEnd < tomorrow) {
    return {
      success: true,
      message:
        'Zakres dat jest w przeszłości. Synchronizacja pomija dane historyczne aby je zachować.',
      stats: { propertiesSynced: 0, bookingsUpdated: 0, bookingsCancelled: 0 },
      syncId,
      duration: Date.now() - startTime,
    };
  }

  let nameFilter: string[] | null = null;

  if (opts.groupId) {
    const propertiesInGroup = await Property.find({ groupId: opts.groupId }).select('name').lean();
    nameFilter = propertiesInGroup.map((p: any) => p.name);
  }

  if (opts.propertyNames) {
    const names = opts.propertyNames
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    if (names.length > 0) {
      nameFilter = nameFilter ? names.filter((n) => nameFilter!.includes(n)) : names;
    }
  }

  const propertyQuery: any = nameFilter ? { name: { $in: nameFilter } } : {};
  const properties = await PropertyConfig.find(propertyQuery).lean();

  if (properties.length === 0) {
    return {
      success: true,
      message: 'No properties found to sync.',
      stats: { propertiesSynced: 0, bookingsUpdated: 0, bookingsCancelled: 0 },
      syncId,
      duration: Date.now() - startTime,
    };
  }

  const icalProperties: ICalProperty[] = properties.map((p: any) => ({
    name: p.name,
    icalUrl: p.icalUrl,
    propertyId: String(p.propertyId),
  }));

  const { reservations, summary } = await icalService.fetchReservationsInRange({
    properties: icalProperties,
    from: syncStart,
    to: syncEnd,
    sortBy: 'end',
  });

  const existingBookings = await Booking.find({
    $and: [{ start: { $lte: syncEnd } }, { end: { $gte: syncStart } }],
    source: { $in: icalProperties.map((p) => p.icalUrl) },
    isManual: { $ne: true },
  }).lean();

  const existingMap = new Map<string, any>();
  for (const b of existingBookings) {
    existingMap.set(`${b.uid}|${b.source}`, b);
  }

  const syncedPropertyIds = properties.map((p: any) => p.propertyId);
  const activeManuals = await Booking.find(
    {
      isManual: true,
      propertyId: { $in: syncedPropertyIds },
      cancellationStatus: { $exists: false },
    },
    { mergedFromIds: 1, splitFromId: 1 },
  ).lean();

  const hiddenByManual = new Set<string>();
  for (const m of activeManuals) {
    for (const oid of (m as any).mergedFromIds || []) hiddenByManual.add(String(oid));
    if ((m as any).splitFromId) hiddenByManual.add(String((m as any).splitFromId));
  }

  const upsertOps: any[] = [];
  const cancelOps: any[] = [];

  for (const r of reservations) {
    const existing = existingMap.get(`${r.uid}|${r.source}`);
    const updateSet: any = {
      propertyId: r.propertyId,
      propertyName: r.propertyName || DEFAULT_PROPERTY_NAME,
      start: r.start,
      end: r.end,
      description: r.description || '',
      location: r.location || '',
    };
    if (typeof existing?.guests === 'number') updateSet.guests = existing.guests;
    if (existing?.notes) updateSet.notes = existing.notes;

    const isHidden = existing && hiddenByManual.has(String(existing._id));
    const updateOp: any = { $set: updateSet };
    if (!isHidden) updateOp.$unset = { cancellationStatus: '' };

    upsertOps.push({
      updateOne: {
        filter: { uid: r.uid, source: r.source },
        update: updateOp,
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

  // Conflict detection
  const icalByKey = new Map<string, (typeof reservations)[0]>();
  for (const r of reservations) icalByKey.set(`${r.uid}|${r.source}`, r);
  const toDay = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

  const manualsForConflicts = await Booking.find(
    {
      isManual: true,
      propertyId: { $in: syncedPropertyIds },
      cancellationStatus: { $exists: false },
    },
    { _id: 1, propertyName: 1, propertyId: 1, start: 1, end: 1, manualType: 1, sourceSnapshot: 1 },
  ).lean();

  const conflicts: any[] = [];
  for (const manual of manualsForConflicts) {
    const snapshot: Array<{ uid: string; source: string; start: Date; end: Date }> =
      (manual as any).sourceSnapshot || [];
    if (snapshot.length === 0) continue;

    const changedOriginals: any[] = [];
    for (const snap of snapshot) {
      const current = icalByKey.get(`${snap.uid}|${snap.source}`);
      if (!current) continue;
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
            ? 'Jedna z oryginalnych rezerwacji zmieniła daty w iCal.'
            : `${changedOriginals.length} z oryginalnych rezerwacji zmieniły daty w iCal.`,
      });
    }
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

  // Update changeover flags
  const activeBookings = await Booking.find({
    $and: [{ start: { $lte: syncEnd } }, { end: { $gte: syncStart } }],
    cancellationStatus: { $ne: 'cancelled' },
  })
    .sort({ end: 1, start: 1 })
    .lean();

  const byProp = new Map<string, typeof activeBookings>();
  for (const it of activeBookings) {
    const key = it.propertyId ? String(it.propertyId) : DEFAULT_PROPERTY_NAME;
    if (!byProp.has(key)) byProp.set(key, []);
    byProp.get(key)!.push(it);
  }

  const toLocalDay = (d: Date | string) => {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };
  const changeoverOps: any[] = [];
  byProp.forEach((arr) => {
    const changeover = new Set<string>();
    for (const a of arr) {
      const endDate = toLocalDay(a.end);
      for (const b of arr) {
        if (String(a._id) === String(b._id)) continue;
        if (toLocalDay(b.start) === endDate) changeover.add(endDate);
      }
    }
    for (const a of arr) {
      changeoverOps.push({
        updateOne: {
          filter: { _id: a._id },
          update: { $set: { isUrgentChangeover: changeover.has(toLocalDay(a.end)) } },
        },
      });
    }
  });
  if (changeoverOps.length > 0) await Booking.bulkWrite(changeoverOps);

  const uniquePropertyIds = new Set(icalProperties.map((p) => String(p.propertyId)));
  const propertiesSynced = uniquePropertyIds.size;

  try {
    await AppSettings.updateOne(
      { key: 'global' },
      { $set: { lastSyncAt: new Date() } },
      { upsert: true },
    );
  } catch {
    // ignore
  }

  return {
    success: true,
    message: `Synchronizacja zakończona! Zsynchronizowano ${propertiesSynced} nieruchomości, zaktualizowano ${bookingsUpdated} rezerwacji, anulowano ${bookingsCancelled} rezerwacji.`,
    stats: {
      propertiesSynced,
      bookingsUpdated,
      bookingsCancelled,
      icalSummary: summary,
    } as any,
    conflicts,
    syncId,
    duration: Date.now() - startTime,
  };
}

// POST /ical/sync (admin only)
router.post('/sync', requireAdmin, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const result = await runSyncCore({
      groupId: body.groupId || '',
      propertyNames: body.propertyNames || '',
      fromStr: body.from || '',
      toStr: body.to || '',
      force: body.force === true || body.force === 'true',
    });
    return c.json(result);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// POST /ical/sync-all (admin only)
router.post('/sync-all', requireAdmin, async (c) => {
  try {
    const result = await runSyncCore({ force: true });
    return c.json(result);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default router;
