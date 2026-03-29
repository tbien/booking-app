import { Hono } from 'hono';
import Joi from 'joi';
import { v4 as uuidv4 } from 'uuid';
import { Booking } from '../../../../src/models/Booking';
import type { AppEnv } from '../../index';

const router = new Hono<AppEnv>();

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

router.post('/blocks', async (c) => {
  try {
    const body = await c.req.json();
    const { error, value } = blockSchema.validate(body);
    if (error) return c.json({ success: false, error: error.message }, 400);

    const start = new Date(value.start);
    const end = new Date(value.end);

    const blockOverlaps = await findBlockOverlaps(value.propertyId, start, end);
    if (blockOverlaps.length > 0) {
      return c.json(
        {
          success: false,
          error: 'Block overlaps with an existing block',
          conflicts: blockOverlaps.map((b: any) => ({
            id: String(b._id),
            start: b.start,
            end: b.end,
            blockReason: b.blockReason || '',
          })),
        },
        409,
      );
    }

    const icalOverlaps = await findICalOverlaps(value.propertyId, start, end);
    if (icalOverlaps.length > 0) {
      return c.json(
        {
          success: false,
          error: 'Termin zajęty przez rezerwację z zewnętrznej platformy',
          conflictType: 'ical',
          conflicts: icalOverlaps.map((b: any) => ({
            id: String(b._id),
            start: b.start,
            end: b.end,
            source: b.source || '',
          })),
        },
        409,
      );
    }

    const block = await Booking.create({
      propertyId: value.propertyId,
      start,
      end,
      uid: uuidv4(),
      source: 'manual',
      isManual: true,
      manualType: 'block',
      blockReason: value.reason || '',
      hasConflict: false,
    });

    return c.json({ success: true, block: { id: String(block._id) } });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

router.put('/blocks/:id', async (c) => {
  try {
    const block = await Booking.findOne({
      _id: c.req.param('id'),
      isManual: true,
      manualType: 'block',
    }).lean();
    if (!block) return c.json({ success: false, error: 'Block not found' }, 404);

    const body = await c.req.json();
    const { error, value } = blockUpdateSchema.validate(body);
    if (error) return c.json({ success: false, error: error.message }, 400);

    const start = new Date(value.start);
    const end = new Date(value.end);

    const blockOverlaps = await findBlockOverlaps(
      String((block as any).propertyId),
      start,
      end,
      c.req.param('id'),
    );
    if (blockOverlaps.length > 0) {
      return c.json(
        {
          success: false,
          error: 'Block overlaps with an existing block',
          conflicts: blockOverlaps.map((b: any) => ({
            id: String(b._id),
            start: b.start,
            end: b.end,
            blockReason: b.blockReason || '',
            isManual: b.isManual || false,
            manualType: b.manualType || null,
          })),
        },
        409,
      );
    }

    const icalOverlapsOnEdit = await findICalOverlaps(
      String((block as any).propertyId),
      start,
      end,
      c.req.param('id'),
    );
    if (icalOverlapsOnEdit.length > 0) {
      return c.json(
        {
          success: false,
          error: 'Termin zajęty przez rezerwację z zewnętrznej platformy',
          conflictType: 'ical',
          conflicts: icalOverlapsOnEdit.map((b: any) => ({
            id: String(b._id),
            start: b.start,
            end: b.end,
            source: b.source || '',
          })),
        },
        409,
      );
    }

    await Booking.findByIdAndUpdate(c.req.param('id'), {
      $set: { start, end, blockReason: value.reason || '', hasConflict: false },
    });

    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

router.delete('/blocks/:id', async (c) => {
  try {
    const deleted = await Booking.findOneAndDelete({
      _id: c.req.param('id'),
      isManual: true,
      manualType: 'block',
    });
    if (!deleted) return c.json({ success: false, error: 'Block not found' }, 404);
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

router.post('/blocks/:id/resolve-conflict', async (c) => {
  try {
    const updated = await Booking.findOneAndUpdate(
      { _id: c.req.param('id'), isManual: true, manualType: 'block' },
      { $set: { hasConflict: false } },
    );
    if (!updated) return c.json({ success: false, error: 'Block not found' }, 404);
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default router;
