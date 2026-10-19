import { route } from '@/lib/api';
import { Campaign, CertItem, Identity } from '@/lib/models';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ query, user }) => {
  const f: any = {};
  const reviewer = query.get('reviewer');
  if (user.role !== 'admin' && user.role !== 'auditor') f.reviewer = user.email;
  else if (reviewer === 'me') f.reviewer = user.email;
  else if (reviewer) f.reviewer = reviewer.toLowerCase();
  if (query.get('campaignId')) f.campaignId = query.get('campaignId');
  if (query.get('decision')) f.decision = query.get('decision');
  if (query.get('sod') === '1') f.sodFlag = true;
  if (query.get('activeOnly') === '1') f.campaignId = { $in: (await Campaign.find({ status: 'active' }, { _id: 1 }).lean<any[]>()).map((c) => c._id) };
  const q = query.get('q');
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    f.identityId = { $in: (await Identity.find({ $or: [{ displayName: rx }, { login: rx }] }, { _id: 1 }).lean<any[]>()).map((i) => i._id) };
  }
  const page = Math.max(1, Number(query.get('page') || 1));
  const limit = Math.min(500, Number(query.get('limit') || 50));
  const [items, total] = await Promise.all([
    CertItem.find(f)
      .sort({ sodFlag: -1, identityId: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('identityId', 'displayName login email department title identityType riskLevel riskScore lifecycle')
      .populate('entitlementId', 'name kind riskLevel privileged')
      .populate('applicationId', 'label')
      .populate('campaignId', 'name status dueDate allowReassign')
      .lean(),
    CertItem.countDocuments(f),
  ]);
  return { items, total, page, limit };
});
