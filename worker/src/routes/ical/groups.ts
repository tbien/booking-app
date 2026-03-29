import { Hono } from 'hono';
import { Property } from '../../../../src/models/Property';
import { Group } from '../../../../src/models/Group';
import { requireAdmin } from '../../middleware/auth';
import type { AppEnv } from '../../index';

const router = new Hono<AppEnv>();

router.get('/groups', async (c) => {
  const counts = await Property.aggregate([
    { $match: { groupId: { $ne: null } } },
    { $group: { _id: '$groupId', count: { $sum: 1 } } },
  ]);
  const countMap = new Map<string, number>(counts.map((c: any) => [String(c._id), c.count]));
  const groups = await Group.find().lean();
  const groupsWithCounts = groups.map((g: any) => ({
    ...g,
    propertyCount: countMap.get(String(g._id)) || 0,
  }));
  return c.json({ success: true, groups: groupsWithCounts });
});

router.post('/groups', requireAdmin, async (c) => {
  const { name } = await c.req.json<{ name?: string }>();
  if (!name) return c.json({ success: false, error: 'Name is required' }, 400);
  const exists = await Group.findOne({ name }).lean();
  if (exists) return c.json({ success: false, error: 'Group already exists' }, 400);
  await Group.create({ name });
  return c.json({ success: true });
});

router.put('/groups/:id', requireAdmin, async (c) => {
  const { name } = await c.req.json<{ name?: string }>();
  if (!name) return c.json({ success: false, error: 'Name is required' }, 400);
  await Group.updateOne({ _id: c.req.param('id') }, { $set: { name } });
  return c.json({ success: true });
});

router.delete('/groups/:id', requireAdmin, async (c) => {
  const groupId = c.req.param('id');
  const propsCount = await Property.countDocuments({ groupId });
  if (propsCount > 0) {
    return c.json({ success: false, error: 'Cannot delete group with assigned properties' }, 400);
  }
  await Group.deleteOne({ _id: groupId });
  return c.json({ success: true });
});

export default router;
