import express from 'express';
import { AppSettings } from '../../models/AppSettings';
import { requireAdmin } from '../../middleware/auth';

const router = express.Router();

// GET /ical/settings – publiczne (frontend musi znać defaultGroupId)
router.get('/settings', async (req, res) => {
  try {
    const settings = await AppSettings.findOne({ key: 'global' })
      .populate('defaultGroupId', 'name')
      .lean();
    res.json({
      success: true,
      settings: settings || { defaultGroupId: null },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// PUT /ical/settings – tylko admin
router.put('/settings', requireAdmin, async (req, res) => {
  try {
    const { defaultGroupId } = req.body as { defaultGroupId?: string | null };

    const update: any = {};
    // null lub pusty string → usuń domyślną grupę
    update.defaultGroupId = defaultGroupId || null;

    const settings = await AppSettings.findOneAndUpdate(
      { key: 'global' },
      { $set: update },
      { upsert: true, new: true },
    ).populate('defaultGroupId', 'name');

    res.json({ success: true, settings });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
