import { route, ADMIN } from '@/lib/api';
import { runSodScan } from '@/lib/sod';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const POST = route(async ({ user }) => {
  const r = await runSodScan({ notify: true });
  await audit(user.email, 'sod.scan', 'manual', r);
  return r;
}, ADMIN);
