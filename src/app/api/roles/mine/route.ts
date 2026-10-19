import { route, ADMIN } from '@/lib/api';
import { mineRoles } from '@/lib/roleMining';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const POST = route(async ({ body, user }) => {
  const opts = {
    method: body?.method === 'cluster' ? 'cluster' : 'attribute',
    groupBy: Array.isArray(body?.groupBy) && body.groupBy.length ? body.groupBy : ['department', 'title'],
    minSupport: Math.min(1, Math.max(0.3, Number(body?.minSupport) || 0.7)),
    minMembers: Math.max(2, Number(body?.minMembers) || 3),
    similarity: Math.min(1, Math.max(0.3, Number(body?.similarity) || 0.75)),
    useUsage: body?.useUsage !== false,
    unusedDays: Number(body?.unusedDays) || 90,
  } as const;
  const r = await mineRoles(opts as any, user.email);
  await audit(user.email, 'role.mine', opts.method, r);
  return r;
}, ADMIN);
