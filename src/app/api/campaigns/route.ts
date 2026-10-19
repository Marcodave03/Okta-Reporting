import { route, ADMIN, HttpError } from '@/lib/api';
import { Campaign } from '@/lib/models';
import { launchCampaign, REVIEWER_LEVELS, sanitizeCampaign, SCOPE_TYPES } from '@/lib/campaigns';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ query }) => {
  const f: any = {};
  if (query.get('status')) f.status = query.get('status');
  const items = await Campaign.find(f).sort({ createdAt: -1 }).lean<any[]>();
  const now = new Date();
  return {
    items: items.map((c) => ({ ...c, overdue: c.status === 'active' && c.dueDate && new Date(c.dueDate) < now })),
    scopeTypes: SCOPE_TYPES,
    reviewerLevels: REVIEWER_LEVELS,
  };
});

export const POST = route(async ({ body, user }) => {
  const data = sanitizeCampaign(body);
  if (!data.name) throw new HttpError(400, 'Nama campaign wajib diisi');
  const mode = body.launchMode || 'now'; // now | schedule | draft
  const c = await Campaign.create({ ...data, owner: data.owner || user.email, createdBy: user.email, status: 'draft' });
  if (mode === 'schedule') {
    const start = data.startAt ? new Date(data.startAt) : new Date();
    c.status = 'scheduled';
    c.nextRunAt = start;
    c.isTemplate = !!(data.recurrence && data.recurrence !== 'none');
    await c.save();
    await audit(user.email, 'campaign.schedule', c.name, { nextRunAt: start, recurrence: c.recurrence });
    return c;
  }
  await audit(user.email, 'campaign.create', c.name);
  if (mode === 'now') return launchCampaign(String(c._id), user.email);
  return c;
}, ADMIN);
