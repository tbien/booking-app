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

export async function connectDB(env: WithMongoURI): Promise<typeof mongoose> {
  if (cache.has(env)) {
    return cache.get(env)!;
  }

  const promise = mongoose
    .connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 30_000,
      maxPoolSize: 5,
    } as any)
    .then((m) => {
      console.log('✅ MongoDB connected (CF Worker)');
      return m;
    })
    .catch((err) => {
      cache.delete(env); // allow retry on next request if connect failed
      throw err;
    });

  cache.set(env, promise);
  return promise;
}



