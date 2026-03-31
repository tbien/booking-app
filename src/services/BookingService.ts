import { Booking } from '../models/Booking';
import { Property } from '../models/Property';
import { buildQueryParams, QueryBuilderOptions } from '../utils/queryBuilder';
import { BookingDto, BookingListParams, PaginationMeta } from '../types/api';

const DEFAULT_PROPERTY_NAME = 'Nieznana';

const toDisplayRows = (
  items: any[],
  propertyToGroupMap: Map<string, string>,
  propertyToDisplayNameMap: Map<string, string>,
): BookingDto[] => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  return items.map((it) => {
    const createdAt = new Date(it.createdAt);
    const isCreatedToday = createdAt >= today && createdAt < tomorrow;
    const startDate = new Date(it.start);
    const isStartingToday = startDate >= today && startDate < tomorrow;

    const displayName =
      propertyToDisplayNameMap.get(String(it.propertyId)) ||
      it.propertyName ||
      DEFAULT_PROPERTY_NAME;

    return {
      id: String(it._id),
      propertyId: String(it.propertyId),
      propertyName: displayName,
      start: it.start,
      end: it.end,
      description: it.description || '',
      source: it.source,
      guests: typeof it.guests === 'number' ? it.guests : null,
      notes: it.notes || '',
      isUrgentChangeover: it.isUrgentChangeover || false,
      isNew: isCreatedToday,
      isStartingToday,
      cancellationStatus: it.cancellationStatus || null,
      isManual: it.isManual || false,
      manualType: it.manualType || null,
      mergedFromIds: it.mergedFromIds || [],
      splitFromId: it.splitFromId || null,
      blockReason: it.blockReason || null,
      hasConflict: it.hasConflict || false,
      groupId: propertyToGroupMap.get(String(it.propertyId)) || null,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
    };
  });
};

const parseLocalDate = (dateStr: string, isEndDate = false): Date => {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (isEndDate) return new Date(year, month - 1, day, 23, 59, 59, 999);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
};

export class BookingService {
  async list(params: BookingListParams): Promise<{ rows: BookingDto[]; meta: PaginationMeta }> {
    const {
      from: fromStr,
      to: toStr,
      sortBy = 'end',
      filterMode = 'sortBy',
      groupId,
      propertyIds,
      includeCancelled = false,
      page = 1,
      limit,
    } = params;

    // Build property filter
    let propertyQuery: any = {};
    if (groupId) propertyQuery.groupId = groupId;
    if (propertyIds) {
      const ids = propertyIds
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean);
      if (ids.length > 0) propertyQuery._id = { $in: ids };
    }

    const properties = await Property.find(propertyQuery).populate('groupId').lean();

    let from: Date;
    let to: Date;
    if (fromStr && toStr) {
      from = parseLocalDate(fromStr, false);
      to = parseLocalDate(toStr, true);
    } else {
      from = new Date();
      from.setHours(0, 0, 0, 0);
      to = new Date(from);
      to.setDate(to.getDate() + 35);
      to.setHours(23, 59, 59, 999);
    }

    const queryOpts: QueryBuilderOptions = {
      from,
      to,
      sortBy,
      includeCancelled,
      daysAhead: 35,
      all: true,
      filterMode,
    };
    const { query } = buildQueryParams(queryOpts);

    if (groupId || propertyIds) {
      const propertyIdList = properties.map((p: any) => p._id);
      if (propertyIdList.length > 0) {
        query.propertyId = { $in: propertyIdList };
      } else {
        return {
          rows: [],
          meta: { page, limit: limit || 1000, total: 0, hasMore: false },
        };
      }
    }

    const finalLimit = limit || 1000;
    const items = await Booking.find(query)
      .sort({ end: 1, start: 1 })
      .skip((page - 1) * finalLimit)
      .limit(finalLimit)
      .lean();
    const totalCount = await Booking.countDocuments(query);

    // Hide originals covered by active manual bookings
    const manualQuery: any = {
      isManual: true,
      cancellationStatus: { $exists: false },
    };
    if (query.propertyId) manualQuery.propertyId = query.propertyId;
    const activeManuals = await Booking.find(manualQuery, {
      mergedFromIds: 1,
      splitFromId: 1,
    }).lean();

    const hiddenIds = new Set<string>();
    for (const m of activeManuals) {
      for (const oid of (m as any).mergedFromIds || []) hiddenIds.add(String(oid));
      if ((m as any).splitFromId) hiddenIds.add(String((m as any).splitFromId));
    }

    const visibleItems =
      hiddenIds.size > 0 ? items.filter((it) => !hiddenIds.has(String(it._id))) : items;

    // Build maps
    const propertyToGroupMap = new Map<string, string>();
    for (const p of properties as any[]) {
      if (p.groupId) {
        const gId = p.groupId._id ? String(p.groupId._id) : String(p.groupId);
        propertyToGroupMap.set(String(p._id), gId);
      }
    }

    const propertyToDisplayNameMap = new Map<string, string>();
    if (!groupId && !propertyIds) {
      const allProps = await Property.find({}, { _id: 1, displayName: 1 }).lean();
      for (const p of allProps as any[]) {
        if (p.displayName) propertyToDisplayNameMap.set(String(p._id), p.displayName);
      }
    } else {
      for (const p of properties as any[]) {
        if (p.displayName) propertyToDisplayNameMap.set(String(p._id), p.displayName);
      }
    }

    const rows = toDisplayRows(visibleItems, propertyToGroupMap, propertyToDisplayNameMap);

    return {
      rows,
      meta: { page, limit: finalLimit, total: totalCount, hasMore: page * finalLimit < totalCount },
    };
  }

  async getById(id: string): Promise<BookingDto | null> {
    const item: any = await Booking.findById(id).lean();
    if (!item) return null;

    const prop: any = await Property.findById(item.propertyId, { displayName: 1, groupId: 1 })
      .populate('groupId')
      .lean();
    const displayNameMap = new Map<string, string>();
    const groupMap = new Map<string, string>();
    if (prop) {
      displayNameMap.set(String(item.propertyId), prop.displayName || '');
      if (prop.groupId) {
        const gId = prop.groupId._id ? String(prop.groupId._id) : String(prop.groupId);
        groupMap.set(String(item.propertyId), gId);
      }
    }

    return toDisplayRows([item], groupMap, displayNameMap)[0] || null;
  }

  async patch(id: string, data: { guests?: number; notes?: string }): Promise<boolean> {
    const update: any = {};
    if (data.guests !== undefined) update.guests = data.guests;
    if (data.notes !== undefined) update.notes = data.notes;

    if (Object.keys(update).length === 0) return false;

    const result = await Booking.updateOne({ _id: id }, { $set: update });
    return result.modifiedCount > 0 || result.matchedCount > 0;
  }

  async deleteCancelled(ids?: string[]): Promise<number> {
    const query: any = { cancellationStatus: 'cancelled' };
    if (ids && ids.length > 0) {
      query._id = { $in: ids };
    }
    const result = await Booking.deleteMany(query);
    return result.deletedCount;
  }
}
