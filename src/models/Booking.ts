import mongoose, { Schema, Document } from 'mongoose';

export interface BookingDocument extends Document {
  propertyName: string;
  start: Date;
  end: Date;
  description?: string;
  location?: string;
  uid: string;
  source: string;
  isUrgentChangeover?: boolean;
  guests?: number;
  notes?: string;
  cancellationStatus?: 'cancelled';
  isManual?: boolean;
  manualType?: 'merged' | 'split' | 'block';
  mergedFromIds?: string[];
  splitFromId?: string;
  blockReason?: string;
  hasConflict?: boolean;
  // Snapshot of original bookings' dates at the time of merge/split.
  // Used to detect if iCal changed the source bookings after the manual edit.
  sourceSnapshot?: Array<{ uid: string; source: string; start: Date; end: Date }>;
  createdAt: Date;
  updatedAt: Date;
}

const BookingSchema = new Schema<BookingDocument>(
  {
    propertyName: { type: String, required: true, index: true },
    start: { type: Date, required: true, index: true },
    end: { type: Date, required: true, index: true },
    description: { type: String },
    location: { type: String },
    uid: { type: String, required: true },
    source: { type: String, required: true },
    isUrgentChangeover: { type: Boolean, default: false },
    guests: { type: Number, min: 0 },
    notes: { type: String },
    cancellationStatus: { type: String, enum: ['cancelled'], default: undefined },
    isManual: { type: Boolean, default: false },
    manualType: { type: String, enum: ['merged', 'split', 'block'], default: undefined },
    mergedFromIds: [{ type: String }],
    splitFromId: { type: String },
    blockReason: { type: String },
    hasConflict: { type: Boolean, default: false },
    sourceSnapshot: [
      {
        uid: { type: String },
        source: { type: String },
        start: { type: Date },
        end: { type: Date },
      },
    ],
  },
  { timestamps: true },
);

// Indexes
BookingSchema.index({ start: 1 });
BookingSchema.index({ propertyName: 1 });
BookingSchema.index({ uid: 1, source: 1 }, { unique: true });
// Compound index for typical sorting
BookingSchema.index({ end: 1, start: 1 });

export const Booking =
  mongoose.models.Booking || mongoose.model<BookingDocument>('Booking', BookingSchema);
