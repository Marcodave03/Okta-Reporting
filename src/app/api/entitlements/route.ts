import { route } from '@/lib/api';
import { Assignment, Entitlement } from '@/lib/models';
import { daysAgo } from '@/lib/util';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ query }) => {
  const f: any = {};
  if (query.get('applicationId')) f.applicationId = query.get('applicationId');
  if (query.get('q')) f.name = new RegExp(query.get('q')!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  if (query.get('riskLevel')) f.riskLevel = query.get('riskLevel');
  if (query.get('privileged') === '1') f.privileged = true;
  const ents = await Entitlement.find(f).sort({ name: 1 }).populate('applicationId', 'label').lean<any[]>();
  const counts = await Assignment.aggregate([
    { $group: { _id: '$entitlementId', n: { $sum: 1 }, unused: { $sum: { $cond: [{ $or: [{ $lt: ['$lastUsedAt', daysAgo(90)] }, { $eq: [{ $ifNull: ['$lastUsedAt', null] }, null] }] }, 1, 0] } } } },
  ]);
  const cm = new Map(counts.map((c: any) => [String(c._id), c]));
  return {
    items: ents.map((e) => ({ ...e, application: e.applicationId?.label || '', applicationId: e.applicationId?._id, holders: cm.get(String(e._id))?.n || 0, unused: cm.get(String(e._id))?.unused || 0 })),
  };
});
