/**
 * MongoDB / Mongoose connection helper for Cloudflare Workers.
 *
 * CF Workers' `connect()` socket API explicitly supports reuse between request
 * handlers: "Sockets can be used between different fetch() handlers."
 * Module-level connection caching is therefore safe in production CF Workers.
 *
 * NOTE: `wrangler dev` (miniflare) has a known local-simulation bug where TCP
 * socket events may not propagate between requests. Use `wrangler dev --remote`
 * or deploy to production to fully test MongoDB queries.
 *
 * Requires: compatibility_flags = ["nodejs_compat_v2"] in wrangler.toml
 *           mongoose ^8.0.0
 */
import mongoose from 'mongoose';

let connectionPromise: Promise<typeof mongoose> | null = null;

export async function connectDB(mongoURI: string): Promise<typeof mongoose> {
  if (mongoose.connection.readyState >= 1) {
    return mongoose;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = mongoose
    .connect(mongoURI, {
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 30_000,
      maxPoolSize: 5,
    } as any)
    .then((m) => {
      console.log('✅ MongoDB connected (CF Worker)');
      return m;
    })
    .catch((err) => {
      connectionPromise = null;
      throw err;
    });

  return connectionPromise;
}


