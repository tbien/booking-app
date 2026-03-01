import mongoose from 'mongoose';

const PropertyConfigSchema = new mongoose.Schema({
  // Logical property name (must match Property.name; Booking.propertyName is display-only and not used as a key)
  name: { type: String, required: true, trim: true },
  icalUrl: { type: String, required: true },
  // Source identifier (e.g., 'booking', 'airbnb', 'expedia')
  source: { type: String, required: true, trim: true },
  // Reference to the logical Property entity
  propertyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: true,
    index: true,
  },
});

// Index to query by property name
PropertyConfigSchema.index({ name: 1 });
// Index to query by propertyId
PropertyConfigSchema.index({ propertyId: 1 });
// Ensure unique combination of name + source + icalUrl
PropertyConfigSchema.index({ name: 1, source: 1, icalUrl: 1 }, { unique: true });

export const PropertyConfig =
  mongoose.models.PropertyConfig || mongoose.model('PropertyConfig', PropertyConfigSchema);
