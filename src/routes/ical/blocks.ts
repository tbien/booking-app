import express from 'express';
import Joi from 'joi';
import { v4 as uuidv4 } from 'uuid';
import { Booking } from '../../models/Booking';

const router = express.Router();

const blockSchema = Joi.object({
  propertyName: Joi.string().min(1).required(),
  start: Joi.date().iso().required(),
  end: Joi.date().iso().greater(Joi.ref('start')).required(),
  reason: Joi.string().allow('').optional(),
});

const blockUpdateSchema = Joi.object({
  start: Joi.date().iso().required(),
  end: Joi.date().iso().greater(Joi.ref('start')).required(),
  reason: Joi.string().allow('').optional(),
});

// Check for overlapping active iCal bookings (non-manual) to return as conflict info.
// Dates follow iCal convention: end is exclusive (= checkout day).
// Both block dates and iCal booking dates are normalised to UTC midnight at import time,
// so a block end=28.03T00:00Z and booking start=28.03T00:00Z correctly returns no conflict
// (28.03T00:00Z < 28.03T00:00Z is false → same-day turnover allowed).
async function findICalOverlaps(
  propertyName: string,
  start: Date,
  end: Date,
  excludeId?: string,
): Promise<any[]> {
  const query: any = {
    propertyName,
    isManual: { $ne: true },
    cancellationStatus: { $exists: false },
    start: { $lt: end },
    end: { $gt: start },
  };
  if (excludeId) query._id = { $ne: excludeId };
  return Booking.find(query).lean();
}

// Check for overlapping BLOCKS only (two blocks can't occupy the same dates)
async function findBlockOverlaps(
  propertyName: string,
  start: Date,
  end: Date,
  excludeId?: string,
): Promise<any[]> {
  const query: any = {
    propertyName,
    isManual: true,
    manualType: 'block',
    cancellationStatus: { $exists: false },
    start: { $lt: end },
    end: { $gt: start },
  };
  if (excludeId) query._id = { $ne: excludeId };
  return Booking.find(query).lean();
}

// POST /ical/blocks — create a block
router.post('/blocks', async (req, res) => {
  try {
    const { error, value } = blockSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, error: error.message });

    const start = new Date(value.start);
    const end = new Date(value.end);

    // Reject if another block already covers these dates
    const blockOverlaps = await findBlockOverlaps(value.propertyName, start, end);
    if (blockOverlaps.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Block overlaps with an existing block',
        conflicts: blockOverlaps.map((b: any) => ({
          id: String(b._id),
          start: b.start,
          end: b.end,
          blockReason: b.blockReason || '',
        })),
      });
    }

    // Reject if any iCal (external) booking covers these dates
    const icalOverlaps = await findICalOverlaps(value.propertyName, start, end);
    if (icalOverlaps.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Termin zajęty przez rezerwację z zewnętrznej platformy',
        conflictType: 'ical',
        conflicts: icalOverlaps.map((b: any) => ({
          id: String(b._id),
          start: b.start,
          end: b.end,
          source: b.source || '',
        })),
      });
    }

    const block = await Booking.create({
      propertyName: value.propertyName,
      start,
      end,
      uid: uuidv4(),
      source: 'manual',
      isManual: true,
      manualType: 'block',
      blockReason: value.reason || '',
      hasConflict: false,
    });

    res.json({ success: true, block: { id: String(block._id) } });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// PUT /ical/blocks/:id — edit dates and reason
router.put('/blocks/:id', async (req, res) => {
  try {
    const block = await Booking.findOne({
      _id: req.params.id,
      isManual: true,
      manualType: 'block',
    }).lean();
    if (!block) return res.status(404).json({ success: false, error: 'Block not found' });

    const { error, value } = blockUpdateSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, error: error.message });

    const start = new Date(value.start);
    const end = new Date(value.end);

    const blockOverlaps = await findBlockOverlaps(
      (block as any).propertyName,
      start,
      end,
      req.params.id,
    );
    if (blockOverlaps.length > 0) {
      return res.status(409).json({
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
      });
    }

    // Reject if any iCal (external) booking covers the new dates
    const icalOverlapsOnEdit = await findICalOverlaps(
      (block as any).propertyName,
      start,
      end,
      req.params.id,
    );
    if (icalOverlapsOnEdit.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Termin zajęty przez rezerwację z zewnętrznej platformy',
        conflictType: 'ical',
        conflicts: icalOverlapsOnEdit.map((b: any) => ({
          id: String(b._id),
          start: b.start,
          end: b.end,
          source: b.source || '',
        })),
      });
    }

    await Booking.findByIdAndUpdate(req.params.id, {
      $set: {
        start,
        end,
        blockReason: value.reason || '',
        hasConflict: false,
      },
    });

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /ical/blocks/:id — only blocks (manualType: 'block')
router.delete('/blocks/:id', async (req, res) => {
  try {
    const deleted = await Booking.findOneAndDelete({
      _id: req.params.id,
      isManual: true,
      manualType: 'block',
    });
    if (!deleted) return res.status(404).json({ success: false, error: 'Block not found' });

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /ical/blocks/:id/resolve-conflict — clear hasConflict flag
router.post('/blocks/:id/resolve-conflict', async (req, res) => {
  try {
    const updated = await Booking.findOneAndUpdate(
      { _id: req.params.id, isManual: true, manualType: 'block' },
      { $set: { hasConflict: false } },
    );
    if (!updated) return res.status(404).json({ success: false, error: 'Block not found' });

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
