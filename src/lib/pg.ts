import { Pool, PoolClient, types } from 'pg';

// Tanggal disimpan di JSONB sebagai string ISO; ubah kembali menjadi Date saat dibaca.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const parseJson = (s: string) => JSON.parse(s, (_k, v) => (typeof v === 'string' && v.length >= 20 && ISO_DATE.test(v) ? new Date(v) : v));
types.setTypeParser(3802, parseJson); // jsonb
types.setTypeParser(114, parseJson); // json

const g = global as any;

export function pool(): Pool {
  if (!g.__pgPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL belum diset');
    const local = /@(localhost|127\.0\.0\.1|postgres)(:|\/)/.test(url);
    const ssl = process.env.PGSSL === 'false' || (local && process.env.PGSSL !== 'true') ? false : { rejectUnauthorized: false };
    g.__pgPool = new Pool({
      connectionString: url,
      ssl,
      // Clever Cloud DEV membatasi 5 koneksi per user; di serverless tiap instance cukup 1 koneksi
      max: Number(process.env.PG_POOL_MAX || (process.env.VERCEL ? 1 : 3)),
      idleTimeoutMillis: process.env.VERCEL ? 5_000 : 10_000,
      connectionTimeoutMillis: 10_000,
    });
    g.__pgPool.on('error', (e: Error) => console.error('[pg] idle client error', e.message));
  }
  return g.__pgPool;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ambil koneksi; ulangi bila server sedang penuh (53300) atau koneksi gagal dibuka. */
async function connect(): Promise<PoolClient> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await pool().connect();
    } catch (e: any) {
      const transient = e?.code === '53300' || e?.code === 'ECONNRESET' || /Connection terminated|timeout|too many/i.test(e?.message || '');
      if (!transient || attempt >= 5) throw e;
      await delay(300 * attempt);
    }
  }
}

export async function sql<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const client = await connect();
  try {
    const r = await client.query(text, params);
    client.release();
    return r.rows as T[];
  } catch (e: any) {
    // error dari server (punya kode SQLSTATE) → koneksi masih sehat; selain itu buang koneksinya
    client.release(e?.code && /^[0-9A-Z]{5}$/.test(e.code) ? undefined : e);
    throw e;
  }
}
