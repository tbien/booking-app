import express from 'express';
import { PropertyConfig } from '../../models/PropertyConfig';
import { Group } from '../../models/Group';
import { propertySchema } from './shared';
import mongoose from 'mongoose';

const router = express.Router();

// config endpoints
router.get('/properties', async (req, res) => {
  const properties = await PropertyConfig.find().populate('groupId').lean();
  res.json({ success: true, properties });
});

router.post('/properties', async (req, res) => {
  const { error, value } = propertySchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, error: error.message });

  let groupId: mongoose.Types.ObjectId | undefined;
  if (value.groupId) {
    const g = await Group.findById(value.groupId).select('_id');
    if (!g) return res.status(400).json({ success: false, error: 'Group not found' });
    groupId = g._id as mongoose.Types.ObjectId;
  }

  await PropertyConfig.create({
    name: value.name,
    icalUrl: value.icalUrl,
    cleaningCost: value.cleaningCost,
    groupId,
  });
  res.json({ success: true });
});

router.put('/properties/:id', async (req, res) => {
  const { error, value } = propertySchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, error: error.message });

  let groupId: mongoose.Types.ObjectId | undefined | null = undefined;
  if (value.groupId === '' || value.groupId === null) {
    groupId = null;
  } else if (value.groupId) {
    const g = await Group.findById(value.groupId).select('_id');
    if (!g) return res.status(400).json({ success: false, error: 'Group not found' });
    groupId = g._id as mongoose.Types.ObjectId;
  }

  await PropertyConfig.updateOne(
    { _id: req.params.id },
    {
      $set: {
        name: value.name,
        icalUrl: value.icalUrl,
        cleaningCost: value.cleaningCost,
        groupId,
      },
    },
  );
  res.json({ success: true });
});

router.delete('/properties/:id', async (req, res) => {
  await PropertyConfig.deleteOne({ _id: req.params.id });
  res.json({ success: true });
});

export default router;
