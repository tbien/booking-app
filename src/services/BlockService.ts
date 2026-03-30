import { v4 as uuidv4 } from 'uuid';
import Joi from 'joi';
import { Booking } from '../models/Booking';
import { BlockCreateDto, BlockUpdateDto } from '../types/api';

const blockSchema = Joi.object({
  propertyId: Joi.string().length(24).required(),
  start: Joi.date().iso().required(),
  end: Joi.date().iso().greater(Joi.ref('start')).required(),
  reason: Joi.string().allow('').optional(),
});

const blockUpdateSchema = Joi.object({
  start: Joi.date().iso().required(),
  end: Joi.date().iso().greater(Joi.ref('start')).required(),
  reason: Joi.string().allow('').optional(),
});

async function findICalOverlaps(
  propertyId: string,
  start: Date,
  end: Date,
  excludeId?: string,
): Promise<any[]> {
  const query: any = {
    propertyId,
    isManual: { $ne: true },
    cancellationStatus: { $exists: false },
    start: { $lt: end },
    end: { $gt: start },
  };
  if (excludeId) query._id = { $ne: excludeId };
  return Booking.find(query).lean();
}

async function findBlockOverlaps(
  propertyId: string,
  start: Date,
  end: Date,
  excludeId?: string,
): Promise<any[]> {
  const query: any = {
    propertyId,
    isManual: true,
    manualType: 'block',
    cancellationStatus: { $exists: false },
    start: { $lt: end },
    end: { $gt: start },
  };
  if (excludeId) query._id = { $ne: excludeId };
  return Booking.find(query).lean();
}

export class BlockService {
  validateCreate(body: unknown) {
    return blockSchema.validate(body);
  }

  validateUpdate(body: unknown) {
    return blockUpdateSchema.validate(body);
  }

  async create(dto: BlockCreateDto): Promise<{ id: string }> {
    const start = new Date(dto.start);
    const end = new Date(dto.end);

    const blockOverlaps = await findBlockOverlaps(dto.propertyId, start, end);
    if (blockOverlaps.length > 0) {
      const err: any = new Error('Block overlaps with an existing block');
      err.status = 409;
      err.conflicts = blockOverlaps.map((b: any) => ({
        id: String(b._id), start: b.start, end: b.end, blockReason: b.blockReason || '',
      }));
      throw err;
    }

    const icalOverlaps = await findICalOverlaps(dto.propertyId, start, end);
    if (icalOverlaps.length > 0) {
      const err: any = new Error('Termin zajęty przez rezerwację z zewnętrznej platformy');
      err.status = 409;
      err.conflictType = 'ical';
      err.conflicts = icalOverlaps.map((b: any) => ({
        id: String(b._id), start: b.start, end: b.end, source: b.source || '',
      }));
      throw err;
    }

    const block = await Booking.create({
      propertyId: dto.propertyId,
      start,
      end,
      uid: uuidv4(),
      source: 'manual',
      isManual: true,
      manualType: 'block',
      blockReason: dto.reason || '',
      hasConflict: false,
    });

    return { id: String(block._id) };
  }

  async update(id: string, dto: BlockUpdateDto): Promise<void> {
    const block = await Booking.findOne({ _id: id, isManual: true, manualType: 'block' }).lean();
    if (!block) throw Object.assign(new Error('Block not found'), { status: 404 });

    const start = new Date(dto.start);
    const end = new Date(dto.end);

    const blockOverlaps = await findBlockOverlaps(String((block as any).propertyId), start, end, id);
    if (blockOverlaps.length > 0) {
      const err: any = new Error('Block overlaps with an existing block');
      err.status = 409;
      err.conflicts = blockOverlaps.map((b: any) => ({
        id: String(b._id), start: b.start, end: b.end, blockReason: b.blockReason || '',
      }));
      throw err;
    }

    const icalOverlaps = await findICalOverlaps(String((block as any).propertyId), start, end, id);
    if (icalOverlaps.length > 0) {
      const err: any = new Error('Termin zajęty przez rezerwację z zewnętrznej platformy');
      err.status = 409;
      err.conflictType = 'ical';
      err.conflicts = icalOverlaps.map((b: any) => ({
        id: String(b._id), start: b.start, end: b.end, source: b.source || '',
      }));
      throw err;
    }

    await Booking.findByIdAndUpdate(id, { $set: { start, end, blockReason: dto.reason || '', hasConflict: false } });
  }

  async delete(id: string): Promise<void> {
    const deleted = await Booking.findOneAndDelete({ _id: id, isManual: true, manualType: 'block' });
    if (!deleted) throw Object.assign(new Error('Block not found'), { status: 404 });
  }

  async resolveConflict(id: string): Promise<void> {
    const updated = await Booking.findOneAndUpdate(
      { _id: id, isManual: true, manualType: 'block' },
      { $set: { hasConflict: false } },
    );
    if (!updated) throw Object.assign(new Error('Block not found'), { status: 404 });
  }
}
