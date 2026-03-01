import mongoose, { Schema, Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export interface PropertyDocument extends Document {
  name: string;
  displayName: string;
  tenantId?: mongoose.Types.ObjectId | null;
  exportToken: string;
  cleaningCost: number;
  groupId?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const PropertySchema = new Schema<PropertyDocument>(
  {
    name: { type: String, required: true, trim: true },
    displayName: { type: String, required: true, trim: true },
    // optional - reserved for future multi-tenancy
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    exportToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => uuidv4(),
    },
    cleaningCost: { type: Number, default: 0 },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', default: null },
  },
  { timestamps: true },
);

// Unique per tenant (null tenantId = single-tenant mode)
PropertySchema.index({ tenantId: 1, name: 1 }, { unique: true });

export const Property =
  mongoose.models.Property || mongoose.model<PropertyDocument>('Property', PropertySchema);
