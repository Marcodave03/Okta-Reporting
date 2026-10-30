import { sql } from './pg';

const g = global as any;

/** Pastikan PostgreSQL (DATABASE_URL) bisa dijangkau; tabel dibuat otomatis per model saat pertama dipakai. */
export async function connectDB() {
  if (!g.__pgReady) {
    g.__pgReady = sql('SELECT 1').catch((e) => {
      g.__pgReady = null;
      throw e;
    });
  }
  return g.__pgReady;
}
