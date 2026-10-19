import { route } from '@/lib/api';
import { Identity, SodViolation } from '@/lib/models';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ query }) => {
  const f: any = {};
  for (const k of ['status', 'severity', 'policyId']) if (query.get(k)) f[k] = query.get(k);
  const q = query.get('q');
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    f.identityId = { $in: (await Identity.find({ $or: [{ displayName: rx }, { login: rx }, { department: rx }] }, { _id: 1 }).lean<any[]>()).map((i) => i._id) };
  }
  const items = await SodViolation.find(f)
    .sort({ detectedAt: -1 })
    .limit(1000)
    .populate('policyId', 'name category severity mitigation sideA.label sideB.label')
    .populate('identityId', 'displayName login department title riskScore riskLevel identityType')
    .populate('matchedA', 'name')
    .populate('matchedB', 'name')
    .lean();
  const sevOrder: any = { critical: 0, high: 1, medium: 2, low: 3 };
  items.sort((a: any, b: any) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || sevOrder[a.severity] - sevOrder[b.severity]);
  return { items };
});
