import { route } from '@/lib/api';
import { Assignment, Identity } from '@/lib/models';
import { daysAgo } from '@/lib/util';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ query }) => {
  const f: any = {};
  const q = query.get('q');
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    f.$or = [{ displayName: rx }, { login: rx }, { email: rx }, { title: rx }];
  }
  const type = query.get('type');
  if (type === 'non_human') f.identityType = { $ne: 'human' };
  else if (type) f.identityType = type;
  for (const k of ['status', 'lifecycle', 'riskLevel', 'department']) if (query.get(k)) f[k] = query.get(k);
  if (query.get('dormant') === '1') f.$and = [{ $or: [{ lastLogin: { $lt: daysAgo(90) } }, { lastLogin: null }] }];

  const page = Math.max(1, Number(query.get('page') || 1));
  const limit = Math.min(200, Number(query.get('limit') || 25));
  const sortKey = query.get('sort') || 'riskScore';
  const sort: any = { [sortKey]: query.get('dir') === 'asc' ? 1 : -1, _id: 1 };

  const [items, total, departments] = await Promise.all([
    Identity.find(f).sort(sort).skip((page - 1) * limit).limit(limit).populate('managerId', 'displayName').lean<any[]>(),
    Identity.countDocuments(f),
    Identity.distinct('department'),
  ]);
  const counts = await Assignment.aggregate([{ $match: { identityId: { $in: items.map((i) => i._id) } } }, { $group: { _id: '$identityId', n: { $sum: 1 } } }]);
  const cm = new Map(counts.map((c: any) => [String(c._id), c.n]));
  return {
    items: items.map((i) => ({ ...i, manager: i.managerId?.displayName || '', entitlementCount: cm.get(String(i._id)) || 0 })),
    total,
    page,
    limit,
    departments: departments.filter(Boolean).sort(),
  };
});
