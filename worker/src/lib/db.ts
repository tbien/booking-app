/**
 * MongoDB / Mongoose connection helper for Cloudflare Workers.
 *
 * CF Workers can reuse module-level state across warm requests within the same isolate,
 * so we cache the Mongoose connection promise to avoid reconnecting on every request.
 *
 * Requires: compatibility_flags = ["nodejs_compat_v2"] in wrangler.toml
 *           mongoose ^8.0.0 (v8 supports CF Workers)
 */
import mongoose from 'mongoose';

let connectionPromise: Promise<typeof mongoose> | null = null;

export async function connectDB(mongoURI: string): Promise<typeof mongoose> {
  // Reuse existing connection if already connected
  if (mongoose.connection.readyState >= 1) {
    return mongoose;
  }

  // Reuse in-progress connection attempt
  if (connectionPromise) {
    return connectionPromise;
  }

  const isTLS = mongoURI.startsWith('mongodb+srv') || mongoURI.includes('ssl=true');

  connectionPromise = mongoose
    .connect(mongoURI, {
      ...(isTLS ? { tls: true, tlsAllowInvalidCertificates: false } : {}),
      serverSelectionTimeoutMS: 10_000,
      bufferCommands: false,
    } as any)
    .then((m) => {
      console.log('✅ MongoDB connected (CF Worker)');
      return m;
    })
    .catch((err) => {
      connectionPromise = null; // allow retry on next request
      throw err;
    });

  return connectionPromise;
}
