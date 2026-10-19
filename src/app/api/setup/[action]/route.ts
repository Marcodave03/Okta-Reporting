import { route, ADMIN, HttpError } from '@/lib/api';
import { clearGovernanceData, seedDemoData } from '@/lib/seed';
import { runSodScan } from '@/lib/sod';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const POST = route(async ({ params, user }) => {
  switch (params.action) {
    case 'seed': {
      const r = await seedDemoData();
      await audit(user.email, 'setup.seed', 'demo', r);
      return r;
    }
    case 'reset':
      await clearGovernanceData();
      await audit(user.email, 'setup.reset', 'all governance data');
      return { ok: true };
    case 'recompute':
      return runSodScan({ notify: false });
    default:
      throw new HttpError(404, 'Aksi tidak dikenal');
  }
}, ADMIN);
