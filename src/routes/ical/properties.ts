import express from 'express';
import { PropertyConfig } from '../../models/PropertyConfig';
import { propertySchema } from './shared';

const router = express.Router();

// config endpoints
router.get('/properties', async (req, res) => {
  const properties = await PropertyConfig.find().lean();
  res.json({ success: true, properties });
});

router.post('/properties', async (req, res) => {
  const { error, value } = propertySchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, error: error.message });
  await PropertyConfig.create({
    name: value.name,
    icalUrl: value.icalUrl,
    cleaningCost: value.cleaningCost,
  });
  res.json({ success: true });
});

router.put('/properties/:id', async (req, res) => {
  const { error, value } = propertySchema.validate(req.body);
  if (error) return res.status(400).json({ success: false, error: error.message });
  await PropertyConfig.updateOne(
    { _id: req.params.id },
    { $set: { name: value.name, icalUrl: value.icalUrl, cleaningCost: value.cleaningCost } },
  );
  res.json({ success: true });
});

router.delete('/properties/:id', async (req, res) => {
  await PropertyConfig.deleteOne({ _id: req.params.id });
  res.json({ success: true });
});

export default router;
