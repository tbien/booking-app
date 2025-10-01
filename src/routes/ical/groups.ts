import express from 'express';
import { PropertyConfig } from '../../models/PropertyConfig';
import { Group } from '../../models/Group';

const router = express.Router();

// Group endpoints
router.get('/groups', async (req, res) => {
  // Aggregation to count properties per group
  const counts = await PropertyConfig.aggregate([
    { $match: { groupId: { $ne: null } } },
    { $group: { _id: '$groupId', count: { $sum: 1 } } },
  ]);
  const countMap = new Map<string, number>(counts.map((c) => [String(c._id), c.count]));
  const groups = await Group.find().lean();
  const groupsWithCounts = groups.map((g: any) => ({
    ...g,
    propertyCount: countMap.get(String(g._id)) || 0,
  }));
  res.json({ success: true, groups: groupsWithCounts });
});

router.post('/groups', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'Name is required' });
  const exists = await Group.findOne({ name }).lean();
  if (exists) return res.status(400).json({ success: false, error: 'Group already exists' });
  await Group.create({ name });
  res.json({ success: true });
});

router.put('/groups/:id', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'Name is required' });
  await Group.updateOne({ _id: req.params.id }, { $set: { name } });
  res.json({ success: true });
});

router.delete('/groups/:id', async (req, res) => {
  const groupId = req.params.id;
  const propsCount = await PropertyConfig.countDocuments({ groupId });
  if (propsCount > 0) {
    return res
      .status(400)
      .json({ success: false, error: 'Cannot delete group with assigned properties' });
  }
  await Group.deleteOne({ _id: groupId });
  res.json({ success: true });
});

export default router;
