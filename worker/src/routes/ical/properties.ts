import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import Joi from 'joi';
import mongoose from 'mongoose';
import { Property } from '../../../../src/models/Property';
import { PropertyConfig } from '../../../../src/models/PropertyConfig';
import { Group } from '../../../../src/models/Group';
import { Booking } from '../../../../src/models/Booking';
import { requireAdmin } from '../../middleware/auth';
import type { AppEnv } from '../../index';

const router = new Hono<AppEnv>();

const objectIdPattern = /^[a-fA-F0-9]{24}$/;

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

const propertyCreateSchema = Joi.object({
  name: Joi.string().min(1).optional(),
  displayName: Joi.string().min(1).required(),
  groupId: Joi.string().pattern(objectIdPattern).allow('', null).optional(),
  cleaningCost: Joi.number().min(0).default(0),
});

const propertyUpdateSchema = Joi.object({
  displayName: Joi.string().min(1).required(),
  groupId: Joi.string().pattern(objectIdPattern).allow('', null).optional(),
  cleaningCost: Joi.number().min(0).default(0),
});

const sourceSchema = Joi.object({
  icalUrl: Joi.string().uri().required(),
  source: Joi.string().min(1).required(),
});

async function resolveGroupId(
  rawGroupId: string | null | undefined,
): Promise<mongoose.Types.ObjectId | null | undefined> {
  if (rawGroupId === '' || rawGroupId === null) return null;
  if (!rawGroupId) return undefined;
  const g = await Group.findById(rawGroupId).select('_id');
  if (!g) throw new Error('Group not found');
  return g._id as mongoose.Types.ObjectId;
}

// GET /ical/properties
router.get('/properties', async (c) => {
  try {
    const properties = await Property.find().populate('groupId').lean();
    const propertyIds = properties.map((p) => p._id);
    const sourceCounts = await PropertyConfig.aggregate([
      { $match: { propertyId: { $in: propertyIds } } },
      { $group: { _id: '$propertyId', count: { $sum: 1 } } },
    ]);
    const sourceCountMap = new Map<string, number>(
      sourceCounts.map((s: any) => [String(s._id), s.count]),
    );

    const baseUrl = new URL(c.req.url).origin;
    const result = properties.map((p: any) => ({
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

    return c.json({ success: true, properties: result });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// POST /ical/properties
router.post('/properties', requireAdmin, async (c) => {
  try {
    const body = await c.req.json();
    const { error, value } = propertyCreateSchema.validate(body);
    if (error) return c.json({ success: false, error: error.message }, 400);

    let groupId: mongoose.Types.ObjectId | null | undefined;
    try {
      groupId = await resolveGroupId(value.groupId);
    } catch {
      return c.json({ success: false, error: 'Group not found' }, 400);
    }

    const name = value.name || slugify(value.displayName) || `property-${Date.now()}`;
    const property = await Property.create({
      name,
      displayName: value.displayName,
      cleaningCost: value.cleaningCost ?? 0,
      groupId: groupId ?? null,
      exportToken: uuidv4(),
    });

    return c.json({
      success: true,
      property: {
        id: String(property._id),
        name: property.name,
        exportToken: property.exportToken,
      },
    });
  } catch (e: any) {
    if (e.code === 11000) {
      return c.json({ success: false, error: 'Property with this name already exists' }, 409);
    }
    return c.json({ success: false, error: e.message }, 500);
  }
});

// PUT /ical/properties/:id
router.put('/properties/:id', requireAdmin, async (c) => {
  try {
    const body = await c.req.json();
    const { error, value } = propertyUpdateSchema.validate(body);
    if (error) return c.json({ success: false, error: error.message }, 400);

    let groupId: mongoose.Types.ObjectId | null | undefined;
    try {
      groupId = await resolveGroupId(value.groupId);
    } catch {
      return c.json({ success: false, error: 'Group not found' }, 400);
    }

    const updateData: any = {
      displayName: value.displayName,
      cleaningCost: value.cleaningCost ?? 0,
    };
    if (groupId !== undefined) updateData.groupId = groupId;

    const updated = await Property.findByIdAndUpdate(
      c.req.param('id'),
      { $set: updateData },
      { new: true },
    );
    if (!updated) return c.json({ success: false, error: 'Property not found' }, 404);

    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// DELETE /ical/properties/:id
router.delete('/properties/:id', requireAdmin, async (c) => {
  try {
    const property = await Property.findById(c.req.param('id')).lean();
    if (!property) return c.json({ success: false, error: 'Property not found' }, 404);

    const activeBookings = await Booking.countDocuments({
      propertyId: c.req.param('id'),
      cancellationStatus: { $exists: false },
    });
    if (activeBookings > 0) {
      return c.json(
        { success: false, error: `Cannot delete: ${activeBookings} active bookings exist` },
        409,
      );
    }

    await PropertyConfig.deleteMany({ propertyId: c.req.param('id') });
    await Property.findByIdAndDelete(c.req.param('id'));
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// POST /ical/properties/:id/regenerate-export-token
router.post('/properties/:id/regenerate-export-token', requireAdmin, async (c) => {
  try {
    const newToken = uuidv4();
    const updated = await Property.findByIdAndUpdate(
      c.req.param('id'),
      { $set: { exportToken: newToken } },
      { new: true },
    );
    if (!updated) return c.json({ success: false, error: 'Property not found' }, 404);

    const baseUrl = new URL(c.req.url).origin;
    return c.json({
      success: true,
      exportToken: newToken,
      exportUrl: `${baseUrl}/ical/export/${newToken}`,
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// GET /ical/properties/:id/sources
router.get('/properties/:id/sources', async (c) => {
  try {
    const property = await Property.findById(c.req.param('id')).lean();
    if (!property) return c.json({ success: false, error: 'Property not found' }, 404);

    const sources = await PropertyConfig.find({ propertyId: c.req.param('id') }).lean();
    return c.json({
      success: true,
      sources: sources.map((s: any) => ({
        id: String(s._id),
        icalUrl: s.icalUrl,
        source: s.source,
        name: s.name,
      })),
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// POST /ical/properties/:id/sources
router.post('/properties/:id/sources', requireAdmin, async (c) => {
  try {
    const property = await Property.findById(c.req.param('id')).lean();
    if (!property) return c.json({ success: false, error: 'Property not found' }, 404);

    const body = await c.req.json();
    const { error, value } = sourceSchema.validate(body);
    if (error) return c.json({ success: false, error: error.message }, 400);

    const created = await PropertyConfig.create({
      name: (property as any).name,
      icalUrl: value.icalUrl,
      source: value.source,
      propertyId: (property as any)._id,
    });
    return c.json({ success: true, source: { id: String(created._id) } });
  } catch (e: any) {
    if (e.code === 11000) {
      return c.json(
        { success: false, error: 'This iCal source already exists for this property' },
        409,
      );
    }
    return c.json({ success: false, error: e.message }, 500);
  }
});

// PUT /ical/properties/:id/sources/:sourceId
router.put('/properties/:id/sources/:sourceId', requireAdmin, async (c) => {
  try {
    const body = await c.req.json();
    const { error, value } = sourceSchema.validate(body);
    if (error) return c.json({ success: false, error: error.message }, 400);

    const updated = await PropertyConfig.findOneAndUpdate(
      { _id: c.req.param('sourceId'), propertyId: c.req.param('id') },
      { $set: { icalUrl: value.icalUrl, source: value.source } },
      { new: true },
    );
    if (!updated) return c.json({ success: false, error: 'Source not found' }, 404);
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// DELETE /ical/properties/:id/sources/:sourceId
router.delete('/properties/:id/sources/:sourceId', requireAdmin, async (c) => {
  try {
    const deleted = await PropertyConfig.findOneAndDelete({
      _id: c.req.param('sourceId'),
      propertyId: c.req.param('id'),
    });
    if (!deleted) return c.json({ success: false, error: 'Source not found' }, 404);
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default router;
