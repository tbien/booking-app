import mongoose from 'mongoose';

const PropertyConfigSchema = new mongoose.Schema({
  // Name is no longer unique – multiple iCal sources can reference same logical property
  name: { type: String, required: true, trim: true },
  icalUrl: { type: String, required: true },
  cleaningCost: { type: Number, default: 0 },
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
});

// Index to query by group
PropertyConfigSchema.index({ groupId: 1 });
// (Optional) If previously a unique index on name exists in Mongo, drop it manually if causing conflicts.

export const PropertyConfig =
  mongoose.models.PropertyConfig || mongoose.model('PropertyConfig', PropertyConfigSchema);
