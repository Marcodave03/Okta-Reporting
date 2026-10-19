import { route, ADMIN, HttpError } from '@/lib/api';
import { Campaign, CertItem } from '@/lib/models';
import { sanitizeCampaign } from '@/lib/campaigns';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ params }) => {
  const campaign = await Campaign.findById(params.id).lean<any>();
  if (!campaign) throw new HttpError(404, 'Campaign tidak ditemukan');
  const now = new Date();
  const [reviewers, instances] = await Promise.all([
    CertItem.aggregate([
      { $match: { campaignId: campaign._id } },
      {
        $group: {
          _id: '$reviewer',
          total: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$decision', 'pending'] }, 1, 0] } },
          approved: { $sum: { $cond: [{ $eq: ['$decision', 'approved'] }, 1, 0] } },
          revoked: { $sum: { $cond: [{ $eq: ['$decision', 'revoked'] }, 1, 0] } },
        },
      },
      { $sort: { pending: -1 } },
    ]),
    Campaign.find({ parentId: campaign._id }, { name: 1, status: 1, launchedAt: 1, stats: 1 }).sort({ launchedAt: -1 }).lean(),
  ]);
  return { campaign: { ...campaign, overdue: campaign.status === 'active' && campaign.dueDate && new Date(campaign.dueDate) < now }, reviewers, instances };
});

export const PATCH = route(async ({ params, body, user }) => {
  const c = await Campaign.findById(params.id);
  if (!c) throw new HttpError(404, 'Campaign tidak ditemukan');
  const data = sanitizeCampaign(body);
  if (['active', 'completed', 'cancelled'].includes(c.status)) {
    // campaign berjalan: hanya field non-scope yang boleh diubah
    for (const k of ['description', 'allowReassign', 'escalation', 'fallbackReviewer', 'autoRemediate']) if (data[k] !== undefined) (c as any)[k] = data[k];
    if (body.dueDate) c.dueDate = new Date(body.dueDate);
  } else {
    Object.assign(c, data);
    if (c.status === 'scheduled' && data.startAt) c.nextRunAt = new Date(data.startAt);
  }
  await c.save();
  await audit(user.email, 'campaign.update', c.name);
  return c;
}, ADMIN);

export const DELETE = route(async ({ params, user }) => {
  const c = await Campaign.findById(params.id);
  if (!c) throw new HttpError(404, 'Campaign tidak ditemukan');
  await CertItem.deleteMany({ campaignId: c._id });
  await c.deleteOne();
  await audit(user.email, 'campaign.delete', c.name);
  return { ok: true };
}, ADMIN);
