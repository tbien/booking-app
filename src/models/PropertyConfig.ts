import mongoose from 'mongoose';

const PropertyConfigSchema = new mongoose.Schema({
  name: { type: String, required: true },
  icalUrl: { type: String, required: true },
  cleaningCost: { type: Number, default: 0 },
});

export const PropertyConfig =
  mongoose.models.PropertyConfig || mongoose.model('PropertyConfig', PropertyConfigSchema);
