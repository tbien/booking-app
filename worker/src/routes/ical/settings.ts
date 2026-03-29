import { Hono } from 'hono';
import { AppSettings } from '../../../../src/models/AppSettings';
import { requireAdmin } from '../../middleware/auth';
import type { AppEnv } from '../../index';

const router = new Hono<AppEnv>();

router.get('/settings', async (c) => {
  try {
    const settings = await AppSettings.findOne({ key: 'global' })
      .populate('defaultGroupId', 'name')
      .lean();
    return c.json({
      success: true,
      settings: settings || { defaultGroupId: null },
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

router.put('/settings', requireAdmin, async (c) => {
  try {
    const { defaultGroupId } = await c.req.json<{ defaultGroupId?: string | null }>();
    const update: any = { defaultGroupId: defaultGroupId || null };
    const settings = await AppSettings.findOneAndUpdate(
      { key: 'global' },
      { $set: update },
      { upsert: true, new: true },
    ).populate('defaultGroupId', 'name');
    return c.json({ success: true, settings });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default router;
