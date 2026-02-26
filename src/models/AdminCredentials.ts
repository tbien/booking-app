import mongoose, { Document } from 'mongoose';

export interface AdminCredentialsDocument extends Document {
  userId: string;
  passwordHash: string;
}

/**
 * Przechowuje zahashowane hasło admina w bazie danych.
 * Tylko jeden dokument (singleton) – zawsze z userId = 'admin'.
 */
const AdminCredentialsSchema = new mongoose.Schema<AdminCredentialsDocument>(
  {
    userId: { type: String, required: true, unique: true, default: 'admin' },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true },
);

export const AdminCredentials =
  mongoose.models.AdminCredentials ||
  mongoose.model<AdminCredentialsDocument>('AdminCredentials', AdminCredentialsSchema);
