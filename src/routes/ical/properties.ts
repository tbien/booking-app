import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import Joi from 'joi';
import mongoose from 'mongoose';
import { Property } from '../../models/Property';
import { PropertyConfig } from '../../models/PropertyConfig';
import { Group } from '../../models/Group';
import { Booking } from '../../models/Booking';

const router = express.Router();

const objectIdPattern = /^[a-fA-F0-9]{24}$/;

const propertyCreateSchema = Joi.object({
  name: Joi.string().min(1).required(),
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

// Helper: resolve groupId
async function resolveGroupId(
  rawGroupId: string | null | undefined,
): Promise<mongoose.Types.ObjectId | null | undefined> {
  if (rawGroupId === '' || rawGroupId === null) return null;
  if (!rawGroupId) return undefined;
  const g = await Group.findById(rawGroupId).select('_id');
  if (!g) throw new Error('Group not found');
  return g._id as mongoose.Types.ObjectId;
}

// ─── PROPERTY level ──────────────────────────────────────────────────────────

// GET /ical/properties — list all logical properties
router.get('/properties', async (req, res) => {
  try {
    const properties = await Property.find().populate('groupId').lean();

    // Count sources for each property
    const propertyIds = properties.map((p) => p._id);
    const sourceCounts = await PropertyConfig.aggregate([
      { $match: { propertyId: { $in: propertyIds } } },
      { $group: { _id: '$propertyId', count: { $sum: 1 } } },
    ]);
    const sourceCountMap = new Map<string, number>(
      sourceCounts.map((s: any) => [String(s._id), s.count]),
    );

    const baseUrl = `${req.protocol}://${req.get('host')}`;
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

    res.json({ success: true, properties: result });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /ical/properties — create a new logical property
router.post('/properties', async (req, res) => {
  try {
    const { error, value } = propertyCreateSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, error: error.message });

    let groupId: mongoose.Types.ObjectId | null | undefined;
    try {
      groupId = await resolveGroupId(value.groupId);
    } catch {
      return res.status(400).json({ success: false, error: 'Group not found' });
    }

    const property = await Property.create({
      name: value.name,
      displayName: value.displayName,
      cleaningCost: value.cleaningCost ?? 0,
      groupId: groupId ?? null,
      exportToken: uuidv4(),
    });

    res.json({
      success: true,
      property: {
        id: String(property._id),
        name: property.name,
        exportToken: property.exportToken,
      },
    });
  } catch (e: any) {
    if (e.code === 11000) {
      return res
        .status(409)
        .json({ success: false, error: 'Property with this name already exists' });
    }
    res.status(500).json({ success: false, error: e.message });
  }
});

// PUT /ical/properties/:id — update displayName, groupId, cleaningCost (name is immutable)
router.put('/properties/:id', async (req, res) => {
  try {
    const { error, value } = propertyUpdateSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, error: error.message });

    let groupId: mongoose.Types.ObjectId | null | undefined;
    try {
      groupId = await resolveGroupId(value.groupId);
    } catch {
      return res.status(400).json({ success: false, error: 'Group not found' });
    }

    const updateData: any = {
      displayName: value.displayName,
      cleaningCost: value.cleaningCost ?? 0,
    };
    if (groupId !== undefined) updateData.groupId = groupId;

    const updated = await Property.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true },
    );
    if (!updated) return res.status(404).json({ success: false, error: 'Property not found' });

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /ical/properties/:id — delete property and its sources; blocked if active bookings exist
router.delete('/properties/:id', async (req, res) => {
  try {
    const property = await Property.findById(req.params.id).lean();
    if (!property) return res.status(404).json({ success: false, error: 'Property not found' });

    const activeBookings = await Booking.countDocuments({
      propertyName: (property as any).name,
      cancellationStatus: { $exists: false },
    });
    if (activeBookings > 0) {
      return res.status(409).json({
        success: false,
        error: `Cannot delete: ${activeBookings} active bookings exist for this property`,
      });
    }

    await PropertyConfig.deleteMany({ propertyId: req.params.id });
    await Property.findByIdAndDelete(req.params.id);

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /ical/properties/:id/regenerate-export-token
router.post('/properties/:id/regenerate-export-token', async (req, res) => {
  try {
    const newToken = uuidv4();
    const updated = await Property.findByIdAndUpdate(
      req.params.id,
      { $set: { exportToken: newToken } },
      { new: true },
    );
    if (!updated) return res.status(404).json({ success: false, error: 'Property not found' });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
      success: true,
      exportToken: newToken,
      exportUrl: `${baseUrl}/ical/export/${newToken}`,
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── SOURCES level ────────────────────────────────────────────────────────────

// GET /ical/properties/:id/sources
router.get('/properties/:id/sources', async (req, res) => {
  try {
    const property = await Property.findById(req.params.id).lean();
    if (!property) return res.status(404).json({ success: false, error: 'Property not found' });

    const sources = await PropertyConfig.find({ propertyId: req.params.id }).lean();
    res.json({
      success: true,
      sources: sources.map((s: any) => ({
        id: String(s._id),
        icalUrl: s.icalUrl,
        source: s.source,
        name: s.name,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /ical/properties/:id/sources
router.post('/properties/:id/sources', async (req, res) => {
  try {
    const property = await Property.findById(req.params.id).lean();
    if (!property) return res.status(404).json({ success: false, error: 'Property not found' });

    const { error, value } = sourceSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, error: error.message });

    const created = await PropertyConfig.create({
      name: (property as any).name,
      icalUrl: value.icalUrl,
      source: value.source,
      propertyId: (property as any)._id,
    });

    res.json({ success: true, source: { id: String(created._id) } });
  } catch (e: any) {
    if (e.code === 11000) {
      return res
        .status(409)
        .json({ success: false, error: 'This iCal source already exists for this property' });
    }
    res.status(500).json({ success: false, error: e.message });
  }
});

// PUT /ical/properties/:id/sources/:sourceId
router.put('/properties/:id/sources/:sourceId', async (req, res) => {
  try {
    const { error, value } = sourceSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, error: error.message });

    const updated = await PropertyConfig.findOneAndUpdate(
      { _id: req.params.sourceId, propertyId: req.params.id },
      { $set: { icalUrl: value.icalUrl, source: value.source } },
      { new: true },
    );
    if (!updated) return res.status(404).json({ success: false, error: 'Source not found' });

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /ical/properties/:id/sources/:sourceId
router.delete('/properties/:id/sources/:sourceId', async (req, res) => {
  try {
    const deleted = await PropertyConfig.findOneAndDelete({
      _id: req.params.sourceId,
      propertyId: req.params.id,
    });
    if (!deleted) return res.status(404).json({ success: false, error: 'Source not found' });

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
