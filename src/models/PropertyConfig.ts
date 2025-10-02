import mongoose from 'mongoose';

const PropertyConfigSchema = new mongoose.Schema({
  // Logical property name (can be shared by multiple iCal sources)
  name: { type: String, required: true, trim: true },
  icalUrl: { type: String, required: true },
  // Source identifier (e.g., 'booking', 'airbnb', 'expedia')
  source: { type: String, required: true, trim: true },
  cleaningCost: { type: Number, default: 0 },
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
});

// Index to query by group
PropertyConfigSchema.index({ groupId: 1 });
// Index to query by property name
PropertyConfigSchema.index({ name: 1 });
// Ensure unique combination of name + source + icalUrl
PropertyConfigSchema.index({ name: 1, source: 1, icalUrl: 1 }, { unique: true });

export const PropertyConfig =
  mongoose.models.PropertyConfig || mongoose.model('PropertyConfig', PropertyConfigSchema);
