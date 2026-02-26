import mongoose, { Document } from 'mongoose';

export interface AppSettingsDocument extends Document {
  key: string;
  defaultGroupId?: mongoose.Types.ObjectId | null;
}

/**
 * Globalne ustawienia aplikacji (singleton per key='global').
 */
const AppSettingsSchema = new mongoose.Schema<AppSettingsDocument>(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    defaultGroupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null },
  },
  { timestamps: true },
);

export const AppSettings =
  mongoose.models.AppSettings ||
  mongoose.model<AppSettingsDocument>('AppSettings', AppSettingsSchema);
