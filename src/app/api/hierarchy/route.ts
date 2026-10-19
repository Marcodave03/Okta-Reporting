import { route } from '@/lib/api';
import { CertItem, Identity } from '@/lib/models';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const [people, pending] = await Promise.all([
    Identity.find({}, { displayName: 1, title: 1, department: 1, managerId: 1, identityType: 1, riskLevel: 1, riskScore: 1, email: 1, status: 1, lifecycle: 1 }).lean<any[]>(),
    CertItem.aggregate([{ $match: { decision: 'pending' } }, { $group: { _id: '$reviewer', n: { $sum: 1 } } }]),
  ]);
  const pm = new Map(pending.map((p: any) => [p._id, p.n]));
  return { nodes: people.map((p) => ({ ...p, pendingReviews: pm.get(p.email) || 0 })) };
});
