import { route, ADMIN, ADMIN_AUDITOR, HttpError } from '@/lib/api';
import { OktaEvent } from '@/lib/models';
import { getEventsState, pullOktaEvents } from '@/lib/okta';
import { getSetting } from '@/lib/settings';

export const dynamic = 'force-dynamic';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Daftar event System Log Okta yang tersimpan, dengan filter. */
export const GET = route(async ({ query }) => {
  const f: any = {};
  const q = query.get('q');
  if (q) {
    const rx = new RegExp(esc(q), 'i');
    f.$or = [{ displayMessage: rx }, { eventType: rx }, { 'actor.alternateId': rx }, { 'actor.displayName': rx }, { 'targets.alternateId': rx }, { 'targets.displayName': rx }, { ipAddress: rx }];
  }
  for (const k of ['category', 'outcome', 'eventType']) if (query.get(k)) f[k] = query.get(k);
  const app = query.get('app');
  if (app) f.targets = { $elemMatch: { type: /App/i, $or: [{ displayName: new RegExp(esc(app), 'i') }, { alternateId: new RegExp(esc(app), 'i') }] } };
  const accessAction = query.get('accessAction');
  if (accessAction === 'grant') f.eventType = /^(application|app)\.user_membership\.(add|create)/i;
  if (accessAction === 'revoke') f.eventType = /^(application|app)\.user_membership\.(remove|delete)/i;
  if (query.get('user')) f.userIds = query.get('user');
  const from = query.get('from');
  const to = query.get('to');
  if (from || to) {
    f.published = {};
    if (from) f.published.$gte = new Date(from);
    if (to) f.published.$lte = new Date(`${to}T23:59:59.999`);
  }
  const limit = Math.min(200, Math.max(1, Number(query.get('limit') || 50)));
  const page = Math.max(1, Number(query.get('page') || 1));
  const [items, total, categories] = await Promise.all([
    OktaEvent.find(f).sort({ published: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    OktaEvent.countDocuments(f),
    OktaEvent.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]),
  ]);
  return {
    items,
    total,
    page,
    limit,
    categories: Object.fromEntries(categories.map((c: any) => [c._id, c.count])),
    state: getEventsState(),
    last: await getSetting('okta.lastEventsPull', null),
  };
}, ADMIN_AUDITOR);

/** Tarik event baru dari Okta sekarang (berjalan di background). */
export const POST = route(async () => {
  if (getEventsState().running) throw new HttpError(409, 'Penarikan log Okta sedang berjalan');
  pullOktaEvents().catch((e) => console.error('[okta] events pull failed:', e.message));
  await new Promise((r) => setTimeout(r, 300));
  return { started: true, state: getEventsState() };
}, ADMIN);
