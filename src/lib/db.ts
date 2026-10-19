import mongoose from 'mongoose';

const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/okta_iga';

type Cache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const g = global as any;
const cached: Cache = g.__mongoose || (g.__mongoose = { conn: null, promise: null });

export async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(URI, { bufferCommands: false, serverSelectionTimeoutMS: 8000 });
  }
  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }
  return cached.conn;
}
