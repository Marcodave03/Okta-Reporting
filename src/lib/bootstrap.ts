import bcrypt from 'bcryptjs';
import { AppUser, Identity, ReportDef, WorkflowRule } from './models';
import { DEFAULT_RULES } from './notify';
import { SYSTEM_REPORTS } from './reports';
import { ensureDefaultSodPolicies, runSodScan } from './sod';

const g = global as any;

/** Dijalankan sekali per proses: admin awal, workflow default, report sistem, demo data (opsional). */
export function ensureBootstrap(): Promise<void> {
  if (!g.__igaBoot) {
    g.__igaBoot = (async () => {
      const email = (process.env.ADMIN_EMAIL || 'admin@iga.local').toLowerCase();
      if (!(await AppUser.exists({ email }))) {
        await AppUser.create({
          email,
          name: process.env.ADMIN_NAME || 'IGA Administrator',
          role: 'admin',
          passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin123!', 10),
        });
        console.log(`[bootstrap] admin user created: ${email}`);
      }
      for (const r of DEFAULT_RULES) {
        await WorkflowRule.updateOne({ key: r.key }, { $setOnInsert: { enabled: true, recipients: [], ...r } }, { upsert: true });
      }
      for (const r of SYSTEM_REPORTS) {
        await ReportDef.updateOne({ systemKey: r.systemKey }, { $setOnInsert: { ...r, isSystem: true, columns: [], filters: (r as any).filters || [] } }, { upsert: true });
      }
      // policy SoD default untuk data Okta; langsung scan bila identitas sudah ada (tanpa menunggu sync berikutnya)
      if ((await ensureDefaultSodPolicies()) && (await Identity.exists({}))) {
        runSodScan({ notify: false }).catch((e) => console.error('[bootstrap] sod scan', e.message));
      }
      if (process.env.SEED_DEMO_DATA === 'true' && (await Identity.countDocuments({})) === 0) {
        const { seedDemoData } = await import('./seed');
        console.log('[bootstrap] seeding demo data…');
        await seedDemoData();
        console.log('[bootstrap] demo data ready');
      }
    })().catch((e) => {
      g.__igaBoot = null;
      throw e;
    });
  }
  return g.__igaBoot;
}
