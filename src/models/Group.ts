import mongoose, { Schema, Document } from 'mongoose';

export interface GroupDocument extends Document {
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

const GroupSchema = new Schema<GroupDocument>(
  {
    name: { type: String, required: true, unique: true, trim: true },
  },
  { timestamps: true },
);

GroupSchema.index({ name: 1 }, { unique: true });

export const Group = mongoose.models.Group || mongoose.model<GroupDocument>('Group', GroupSchema);
