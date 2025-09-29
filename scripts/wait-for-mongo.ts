import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/booking-app';
const timeoutMs = parseInt(process.env.WAIT_FOR_MONGO_TIMEOUT_MS || '30000', 10);
const intervalMs = 1000;

async function wait() {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const client = await MongoClient.connect(uri, {} as any);
      await client.db().admin().ping();
      await client.close();
      console.log('Mongo is ready');
      return;
    } catch (e) {
      console.log('Waiting for Mongo...', (e as Error).message);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  console.error('Timed out waiting for Mongo');
  process.exit(1);
}

wait();
