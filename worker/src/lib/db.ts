/**
 * MongoDB / Mongoose connection helper for Cloudflare Workers.
 *
 * Uses a WeakMap keyed on the `env` object — the recommended CF Workers pattern.
 * The `env` object is stable for the lifetime of an isolate (many requests),
 * so the connection is reused across requests in the same isolate.
 * When CF spins up a new isolate, `env` is a new object → fresh connection.
 *
 * Requires: compatibility_flags = ["nodejs_compat_v2"] in wrangler.toml
 *           mongoose ^8.0.0
 */
import mongoose from 'mongoose';

// Minimal shape needed — avoids circular import with index.ts
interface WithMongoURI {
  MONGODB_URI: string;
}

// WeakMap: env object → in-progress or resolved connection promise
const cache = new WeakMap<object, Promise<typeof mongoose>>();

// Module-level fallback for environments where env object changes per request
let fallbackPromise: Promise<typeof mongoose> | null = null;

export async function connectDB(env: WithMongoURI): Promise<typeof mongoose> {
  // Fast path: already fully connected — skip all caching logic
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  if (!env.MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is not set');
  }

  // WeakMap cache keyed on env object (stable within one CF isolate)
  if (cache.has(env)) {
    return cache.get(env)!;
  }

  // Module-level fallback in case CF creates a new env object per request
  if (fallbackPromise) {
    return fallbackPromise;
  }

  const promise = mongoose
    .connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 30_000,
      maxPoolSize: 5,
    } as any)
    .then((m) => {
      console.log('✅ MongoDB connected (CF Worker)');
      fallbackPromise = Promise.resolve(m); // update fallback to resolved
      return m;
    })
    .catch((err) => {
      cache.delete(env);
      fallbackPromise = null; // allow retry on next request
      throw err;
    });

  cache.set(env, promise);
  fallbackPromise = promise;
  return promise;
}
