import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Property, PropertyDocument } from '../models/Property';
import { PropertyConfig } from '../models/PropertyConfig';
import { Group } from '../models/Group';
import { Booking } from '../models/Booking';
import {
  PropertyDto,
  PropertyCreateDto,
  PropertyUpdateDto,
  SourceDto,
  SourceCreateDto,
} from '../types/api';

const slugify = (str: string) =>
  str
    .toLowerCase()
    .replace(/ą/g, 'a')
    .replace(/ć/g, 'c')
    .replace(/ę/g, 'e')
    .replace(/ł/g, 'l')
    .replace(/ń/g, 'n')
    .replace(/ó/g, 'o')
    .replace(/ś/g, 's')
    .replace(/ź/g, 'z')
    .replace(/ż/g, 'z')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

async function resolveGroupId(
  rawGroupId: string | null | undefined,
): Promise<mongoose.Types.ObjectId | null | undefined> {
  if (rawGroupId === '' || rawGroupId === null) return null;
  if (!rawGroupId) return undefined;
  const g = await Group.findById(rawGroupId).select('_id');
  if (!g) throw new Error('Group not found');
  return g._id as mongoose.Types.ObjectId;
}

export class PropertyService {
  async list(baseUrl: string): Promise<PropertyDto[]> {
    const properties = await Property.find().populate('groupId').lean();
    const propertyIds = properties.map((p) => p._id);
    const sourceCounts = await PropertyConfig.aggregate([
      { $match: { propertyId: { $in: propertyIds } } },
      { $group: { _id: '$propertyId', count: { $sum: 1 } } },
    ]);
    const sourceCountMap = new Map<string, number>(
      sourceCounts.map((s: any) => [String(s._id), s.count]),
    );

    return properties.map((p: any) => ({
      id: String(p._id),
      name: p.name,
      displayName: p.displayName,
      groupId: p.groupId?._id ? String(p.groupId._id) : null,
      groupName: p.groupId?.name || null,
      cleaningCost: p.cleaningCost,
      exportToken: p.exportToken,
      exportUrl: `${baseUrl}/ical/export/${p.exportToken}`,
      sourcesCount: sourceCountMap.get(String(p._id)) || 0,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
  }

  async getById(id: string, baseUrl: string): Promise<PropertyDto | null> {
    const p = await Property.findById(id).populate('groupId').lean();
    if (!p) return null;
    const count = await PropertyConfig.countDocuments({ propertyId: id });
    return {
      id: String((p as any)._id),
      name: (p as any).name,
      displayName: (p as any).displayName,
      groupId: (p as any).groupId?._id ? String((p as any).groupId._id) : null,
      groupName: (p as any).groupId?.name || null,
      cleaningCost: (p as any).cleaningCost,
      exportToken: (p as any).exportToken,
      exportUrl: `${baseUrl}/ical/export/${(p as any).exportToken}`,
      sourcesCount: count,
      createdAt: (p as any).createdAt,
      updatedAt: (p as any).updatedAt,
    };
  }

  async create(dto: PropertyCreateDto): Promise<{ id: string; name: string; exportToken: string }> {
    const groupId = await resolveGroupId(dto.groupId);
    const name = dto.name || slugify(dto.displayName) || `property-${Date.now()}`;

    const property = await Property.create({
      name,
      displayName: dto.displayName,
      cleaningCost: dto.cleaningCost ?? 0,
      groupId: groupId ?? null,
      exportToken: uuidv4(),
    });

    return {
      id: String(property._id),
      name: property.name,
      exportToken: property.exportToken,
    };
  }

  async update(id: string, dto: PropertyUpdateDto): Promise<boolean> {
    const groupId = await resolveGroupId(dto.groupId);
    const updateData: any = {
      displayName: dto.displayName,
      cleaningCost: dto.cleaningCost ?? 0,
    };
    if (groupId !== undefined) updateData.groupId = groupId;

    const updated = await Property.findByIdAndUpdate(id, { $set: updateData }, { new: true });
    return !!updated;
  }

  async delete(id: string): Promise<void> {
    const property = await Property.findById(id).lean();
    if (!property) throw Object.assign(new Error('Property not found'), { status: 404 });

    const activeBookings = await Booking.countDocuments({
      propertyId: id,
      cancellationStatus: { $exists: false },
    });
    if (activeBookings > 0) {
      throw Object.assign(
        new Error(`Cannot delete: ${activeBookings} active bookings exist for this property`),
        { status: 409 },
      );
    }

    await PropertyConfig.deleteMany({ propertyId: id });
    await Property.findByIdAndDelete(id);
  }

  async regenerateExportToken(
    id: string,
    baseUrl: string,
  ): Promise<{ exportToken: string; exportUrl: string }> {
    const newToken = uuidv4();
    const updated = await Property.findByIdAndUpdate(
      id,
      { $set: { exportToken: newToken } },
      { new: true },
    );
    if (!updated) throw Object.assign(new Error('Property not found'), { status: 404 });

    return { exportToken: newToken, exportUrl: `${baseUrl}/ical/export/${newToken}` };
  }

  // ── Sources ──────────────────────────────────────────────────────────────

  async listSources(propertyId: string): Promise<SourceDto[]> {
    const property = await Property.findById(propertyId).lean();
    if (!property) throw Object.assign(new Error('Property not found'), { status: 404 });

    const sources = await PropertyConfig.find({ propertyId }).lean();
    return sources.map((s: any) => ({
      id: String(s._id),
      icalUrl: s.icalUrl,
      source: s.source,
      name: s.name,
    }));
  }

  async addSource(propertyId: string, dto: SourceCreateDto): Promise<{ id: string }> {
    const property = await Property.findById(propertyId).lean();
    if (!property) throw Object.assign(new Error('Property not found'), { status: 404 });

    const created = await PropertyConfig.create({
      name: (property as any).name,
      icalUrl: dto.icalUrl,
      source: dto.source,
      propertyId: (property as any)._id,
    });

    return { id: String(created._id) };
  }

  async updateSource(propertyId: string, sourceId: string, dto: SourceCreateDto): Promise<boolean> {
    const updated = await PropertyConfig.findOneAndUpdate(
      { _id: sourceId, propertyId },
      { $set: { icalUrl: dto.icalUrl, source: dto.source } },
      { new: true },
    );
    return !!updated;
  }

  async deleteSource(propertyId: string, sourceId: string): Promise<boolean> {
    const deleted = await PropertyConfig.findOneAndDelete({ _id: sourceId, propertyId });
    return !!deleted;
  }
}
