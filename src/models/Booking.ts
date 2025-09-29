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
  },
  { timestamps: true },
);

// Add indexes for performance
BookingSchema.index({ start: 1 });
BookingSchema.index({ propertyName: 1 });
BookingSchema.index({ uid: 1, source: 1 }, { unique: true });

export const Booking =
  mongoose.models.Booking || mongoose.model<BookingDocument>('Booking', BookingSchema);
