import { Application, AppUser, Assignment, Campaign, CertItem, Entitlement, Identity, Role, SodViolation } from './models';
import { emit } from './notify';
import { audit } from './audit';
import { getConfig } from './settings';
import { addDays, addMonths, daysAgo, DAY, escapeHtml, fmtDate } from './util';
import { revokeInOkta } from './okta';
import { HttpError } from './errors';

export const SCOPE_TYPES: Record<string, string> = {
  all: 'Semua akses',
  department: 'Berdasarkan department',
  application: 'Berdasarkan aplikasi',
  entitlement: 'Entitlement / group tertentu',
  role: 'Berdasarkan role',
  risk: 'Berdasarkan tingkat risiko',
  mover: 'Mover (pindah department)',
  leaver: 'Leaver (suspended / deprovisioned)',
  inactive: 'Long inactive / dormant account',
  privileged: 'Privileged access',
  non_human: 'Non-human identity (service, bot, API)',
};

export const REVIEWER_LEVELS: Record<string, string> = {
  manager: 'Manager langsung',
  manager_of_manager: 'Manager dari manager (skip-level)',
  app_owner: 'Application owner',
  entitlement_owner: 'Entitlement / group owner',
  specific: 'Reviewer tertentu',
  fallback: 'Fallback reviewer (admin)',
};

const CAMPAIGN_FIELDS = [
  'name', 'description', 'scopeType', 'scope', 'reviewerHierarchy', 'specificReviewer', 'fallbackReviewer',
  'escalation', 'allowReassign', 'autoRemediate', 'durationDays', 'recurrence', 'startAt', 'owner',
];

export function sanitizeCampaign(body: any) {
  const data: any = {};
  for (const k of CAMPAIGN_FIELDS) if (body?.[k] !== undefined) data[k] = body[k];
  if (data.name !== undefined && !String(data.name).trim()) throw new HttpError(400, 'Nama campaign wajib diisi');
  if (data.reviewerHierarchy && !data.reviewerHierarchy.length) throw new HttpError(400, 'Hierarki reviewer minimal 1 level');
  if (data.reviewerHierarchy?.includes('specific') && !data.specificReviewer) throw new HttpError(400, 'Isi email reviewer tertentu');
  if (data.startAt === '') delete data.startAt;
  return data;
}

export function nextRecurrence(rec: string, from: Date) {
  switch (rec) {
    case 'weekly':
      return addDays(from, 7);
    case 'monthly':
      return addMonths(from, 1);
    case 'quarterly':
      return addMonths(from, 3);
    case 'semiannual':
      return addMonths(from, 6);
    case 'annual':
      return addMonths(from, 12);
    default:
      return null;
  }
}

/** Menentukan pasangan (identity, entitlement) yang masuk scope campaign. */
export async function resolveScope(c: any) {
  const s = c.scope || {};
  const idFilter: any = {};
  const entFilter: any = {};
  switch (c.scopeType) {
    case 'department':
      idFilter.department = { $in: s.departments || [] };
      break;
    case 'application':
      entFilter.applicationId = { $in: s.applicationIds || [] };
      break;
    case 'entitlement':
      entFilter._id = { $in: s.entitlementIds || [] };
      break;
    case 'role': {
      const roles = await Role.find({ _id: { $in: s.roleIds || [] } }).lean<any[]>();
      entFilter._id = { $in: roles.flatMap((r) => r.entitlementIds) };
      idFilter._id = { $in: roles.flatMap((r) => r.memberIds) };
      break;
    }
    case 'risk': {
      const levels = s.riskLevels?.length ? s.riskLevels : ['high', 'critical'];
      if (s.riskTarget === 'entitlement') entFilter.riskLevel = { $in: levels };
      else idFilter.riskLevel = { $in: levels };
      break;
    }
    case 'mover':
      idFilter.lifecycle = 'mover';
      break;
    case 'leaver':
      idFilter.lifecycle = 'leaver';
      break;
    case 'inactive':
      idFilter.$or = [{ lastLogin: { $lt: daysAgo(s.inactiveDays || 90) } }, { lastLogin: null }];
      idFilter.status = { $nin: ['DEPROVISIONED'] };
      break;
    case 'privileged':
      entFilter.privileged = true;
      break;
    case 'non_human':
      idFilter.identityType = { $ne: 'human' };
      break;
  }
  // filter department tambahan untuk scope selain department
  if (c.scopeType !== 'department' && s.departments?.length) idFilter.department = { $in: s.departments };

  const q: any = {};
  if (Object.keys(idFilter).length) q.identityId = { $in: (await Identity.find(idFilter, { _id: 1 }).lean<any[]>()).map((i) => i._id) };
  if (Object.keys(entFilter).length) q.entitlementId = { $in: (await Entitlement.find(entFilter, { _id: 1 }).lean<any[]>()).map((e) => e._id) };
  return Assignment.find(q, { identityId: 1, entitlementId: 1, lastUsedAt: 1 }).lean<any[]>();
}

type Ctx = { identities: Map<string, any>; ents: Map<string, any>; apps: Map<string, any>; defaultAdmin: string };

async function loadCtx(): Promise<Ctx> {
  const [ids, ents, apps, admin] = await Promise.all([
    Identity.find({}, { email: 1, managerId: 1, displayName: 1, login: 1, riskLevel: 1 }).lean<any[]>(),
    Entitlement.find({}, { name: 1, owner: 1, applicationId: 1, riskLevel: 1, kind: 1, oktaId: 1 }).lean<any[]>(),
    Application.find({}, { owner: 1, label: 1 }).lean<any[]>(),
    AppUser.findOne({ role: 'admin', active: true }).sort({ createdAt: 1 }).lean<any>(),
  ]);
  return {
    identities: new Map(ids.map((i) => [String(i._id), i])),
    ents: new Map(ents.map((e) => [String(e._id), e])),
    apps: new Map(apps.map((a) => [String(a._id), a])),
    defaultAdmin: admin?.email || process.env.ADMIN_EMAIL || 'admin@iga.local',
  };
}

/** Reviewer berdasarkan hierarki yang dapat dikonfigurasi; mencegah self-review. */
export function resolveReviewer(ctx: Ctx, identity: any, ent: any, c: any, startLevel = 0) {
  const levels: string[] = c.reviewerHierarchy?.length ? c.reviewerHierarchy : ['manager', 'fallback'];
  const self = (identity?.email || '').toLowerCase();
  const fallback = (c.fallbackReviewer || ctx.defaultAdmin).toLowerCase();
  for (let i = Math.max(0, startLevel); i < levels.length; i++) {
    let email: string | undefined;
    const mgr = identity?.managerId ? ctx.identities.get(String(identity.managerId)) : null;
    switch (levels[i]) {
      case 'manager':
        email = mgr?.email;
        break;
      case 'manager_of_manager':
        email = mgr?.managerId ? ctx.identities.get(String(mgr.managerId))?.email : undefined;
        break;
      case 'app_owner':
        email = ent?.applicationId ? ctx.apps.get(String(ent.applicationId))?.owner : undefined;
        break;
      case 'entitlement_owner':
        email = ent?.owner;
        break;
      case 'specific':
        email = c.specificReviewer;
        break;
      case 'fallback':
        email = fallback;
        break;
    }
    if (email && email.toLowerCase() !== self) return { email: email.toLowerCase(), level: i, levelName: levels[i] };
  }
  return { email: fallback, level: levels.length, levelName: 'fallback' };
}

export async function previewCampaign(c: any) {
  const assigns = await resolveScope(c);
  const ctx = await loadCtx();
  const reviewers: Record<string, number> = {};
  for (const a of assigns) {
    const r = resolveReviewer(ctx, ctx.identities.get(String(a.identityId)), ctx.ents.get(String(a.entitlementId)), c);
    reviewers[r.email] = (reviewers[r.email] || 0) + 1;
  }
  return {
    items: assigns.length,
    identities: new Set(assigns.map((a) => String(a.identityId))).size,
    reviewers: Object.entries(reviewers)
      .map(([email, count]) => ({ email, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export async function launchCampaign(id: string, actor: string) {
  const def = await Campaign.findById(id);
  if (!def) throw new HttpError(404, 'Campaign tidak ditemukan');
  if (!['draft', 'scheduled'].includes(def.status)) throw new HttpError(400, `Campaign berstatus ${def.status} tidak dapat diluncurkan`);
  const now = new Date();

  let inst = def;
  if (def.recurrence && def.recurrence !== 'none') {
    // campaign berulang: definisi tetap 'scheduled', buat instance baru
    const obj = def.toObject();
    delete obj._id;
    delete obj.createdAt;
    delete obj.updatedAt;
    inst = new Campaign({ ...obj, name: `${def.name} · ${fmtDate(now)}`, isTemplate: false, parentId: def._id, recurrence: 'none', status: 'draft', nextRunAt: null });
    def.isTemplate = true;
    def.lastRunAt = now;
    def.nextRunAt = nextRecurrence(def.recurrence, def.nextRunAt && def.nextRunAt > now ? def.nextRunAt : now);
    def.status = 'scheduled';
    await def.save();
  }

  const assigns = await resolveScope(inst);
  const ctx = await loadCtx();
  const viols = await SodViolation.find({ status: 'open' }, { identityId: 1, matchedA: 1, matchedB: 1 }).lean<any[]>();
  const sodKeys = new Set<string>();
  viols.forEach((v) => [...v.matchedA, ...v.matchedB].forEach((e: any) => sodKeys.add(`${v.identityId}:${e}`)));

  const dueDate = addDays(now, inst.durationDays || 14);
  const items = assigns.map((a) => {
    const identity = ctx.identities.get(String(a.identityId));
    const ent = ctx.ents.get(String(a.entitlementId));
    const r = resolveReviewer(ctx, identity, ent, inst);
    return {
      campaignId: inst._id,
      identityId: a.identityId,
      entitlementId: a.entitlementId,
      applicationId: ent?.applicationId,
      reviewer: r.email,
      reviewerLevel: r.level,
      reviewerLevelName: r.levelName,
      assignedAt: now,
      decision: 'pending',
      dueDate,
      riskLevel: ent?.riskLevel === 'critical' || identity?.riskLevel === 'critical' ? 'critical' : ent?.riskLevel || 'low',
      sodFlag: sodKeys.has(`${a.identityId}:${a.entitlementId}`),
      lastUsedAt: a.lastUsedAt,
    };
  });

  inst.status = 'active';
  inst.launchedAt = now;
  inst.dueDate = dueDate;
  inst.owner = inst.owner || actor;
  await inst.save();
  if (items.length) await CertItem.insertMany(items, { ordered: false });
  await refreshStats(String(inst._id), false);

  const byReviewer: Record<string, number> = {};
  items.forEach((i) => (byReviewer[i.reviewer] = (byReviewer[i.reviewer] || 0) + 1));
  const cfg = await getConfig();
  await emit('campaign.launched', {
    vars: { campaign: inst.name, dueDate: fmtDate(dueDate), total: items.length, reviewerCount: Object.keys(byReviewer).length, link: `${cfg.app.baseUrl}/reviews` },
    reviewers: Object.entries(byReviewer).map(([email, count]) => ({ email, vars: { count } })),
  });
  await audit(actor, 'campaign.launch', inst.name, { items: items.length, campaignId: String(inst._id) });
  return inst;
}

export async function refreshStats(campaignId: string, allowComplete = true) {
  const c = await Campaign.findById(campaignId);
  if (!c) return null;
  const agg = await CertItem.aggregate([
    { $match: { campaignId: c._id } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        approved: { $sum: { $cond: [{ $eq: ['$decision', 'approved'] }, 1, 0] } },
        revoked: { $sum: { $cond: [{ $eq: ['$decision', 'revoked'] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $eq: ['$decision', 'pending'] }, 1, 0] } },
        reassigned: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$reassignHistory', []] } }, 0] }, 1, 0] } },
      },
    },
  ]);
  const s = agg[0] || { total: 0, approved: 0, revoked: 0, pending: 0, reassigned: 0 };
  const overdue = c.dueDate && c.dueDate < new Date() ? s.pending : 0;
  c.stats = { total: s.total, approved: s.approved, revoked: s.revoked, pending: s.pending, reassigned: s.reassigned, overdue };
  const justCompleted = allowComplete && c.status === 'active' && s.pending === 0;
  if (c.status === 'active' && s.pending === 0 && (allowComplete || s.total === 0)) {
    c.status = 'completed';
    c.completedAt = new Date();
  }
  await c.save();
  if (justCompleted) {
    const cfg = await getConfig();
    await emit('campaign.completed', {
      owner: c.owner,
      vars: {
        campaign: c.name,
        total: s.total,
        approved: s.approved,
        revoked: s.revoked,
        completionRate: s.total ? Math.round(((s.approved + s.revoked) / s.total) * 100) : 100,
        link: `${cfg.app.baseUrl}/campaigns/${c._id}`,
      },
    });
  }
  return c;
}

/** Keputusan reviewer (approve / revoke) untuk satu atau banyak item. */
export async function decide(user: { email: string; role: string }, itemIds: string[], decision: 'approved' | 'revoked' | 'pending', comment = '') {
  const filter: any = { _id: { $in: itemIds } };
  if (user.role !== 'admin') filter.reviewer = user.email.toLowerCase();
  const items = await CertItem.find(filter);
  if (!items.length) throw new HttpError(404, 'Tidak ada item yang dapat diputuskan oleh Anda');
  const campaigns = new Map<string, any>();
  for (const id of new Set(items.map((i) => String(i.campaignId)))) campaigns.set(id, await Campaign.findById(id).lean());
  for (const it of items) {
    const c = campaigns.get(String(it.campaignId));
    if (c?.status !== 'active') throw new HttpError(400, `Campaign "${c?.name}" tidak aktif`);
  }

  const now = new Date();
  const revoked: any[] = [];
  for (const it of items) {
    it.decision = decision;
    it.comment = comment;
    it.decidedAt = decision === 'pending' ? null : now;
    it.decidedBy = user.email;
    if (decision === 'revoked') {
      const c = campaigns.get(String(it.campaignId));
      it.remediation = c?.autoRemediate ? await remediate(it) : { status: 'pending', message: 'Menunggu remediasi manual', at: now };
      revoked.push(it);
    } else {
      it.remediation = { status: 'none', at: now };
    }
    await it.save();
  }
  for (const id of campaigns.keys()) await refreshStats(id);

  if (revoked.length) {
    const ids = await Identity.find({ _id: { $in: revoked.map((r) => r.identityId) } }, { displayName: 1 }).lean<any[]>();
    const ents = await Entitlement.find({ _id: { $in: revoked.map((r) => r.entitlementId) } }, { name: 1 }).lean<any[]>();
    const im = new Map(ids.map((i) => [String(i._id), i.displayName]));
    const em = new Map(ents.map((e) => [String(e._id), e.name]));
    const cfg = await getConfig();
    const first = campaigns.get(String(revoked[0].campaignId));
    await emit('certification.revoked', {
      vars: {
        campaign: first?.name,
        count: revoked.length,
        details: `<ul>${revoked
          .slice(0, 25)
          .map((r) => `<li>${escapeHtml(im.get(String(r.identityId)))} → ${escapeHtml(em.get(String(r.entitlementId)))} (remediasi: ${r.remediation.status})</li>`)
          .join('')}</ul>`,
        link: `${cfg.app.baseUrl}/campaigns/${first?._id}`,
      },
    });
  }
  await audit(user.email, `certification.${decision}`, `${items.length} item`, { itemIds, comment });
  return { updated: items.length };
}

/** Remediasi: cabut akses di Okta (jika diaktifkan) atau simulasi untuk data demo. */
export async function remediate(item: any) {
  const now = new Date();
  const [identity, ent] = await Promise.all([Identity.findById(item.identityId).lean<any>(), Entitlement.findById(item.entitlementId).lean<any>()]);
  if (!identity || !ent) return { status: 'failed', message: 'Identity/entitlement tidak ditemukan', at: now };
  try {
    if (identity.source === 'okta' && ent.source === 'okta') {
      const { okta } = await getConfig();
      if (!okta.remediation) return { status: 'pending', message: 'Remediasi Okta nonaktif (OKTA_REMEDIATION_ENABLED=false) — lakukan manual', at: now };
      await revokeInOkta(identity, ent);
      await Assignment.deleteOne({ identityId: identity._id, entitlementId: ent._id });
      return { status: 'done', message: 'Akses dicabut di Okta', at: now };
    }
    await Assignment.deleteOne({ identityId: identity._id, entitlementId: ent._id });
    return { status: 'done', message: 'Akses dihapus (data demo / non-Okta)', at: now };
  } catch (e: any) {
    return { status: 'failed', message: e.message, at: now };
  }
}

export async function reassign(user: { email: string; role: string }, itemIds: string[], to: string, reason = '') {
  const target = (to || '').toLowerCase().trim();
  if (!/^\S+@\S+$/.test(target)) throw new HttpError(400, 'Email reviewer tujuan tidak valid');
  const filter: any = { _id: { $in: itemIds }, decision: 'pending' };
  if (user.role !== 'admin') filter.reviewer = user.email.toLowerCase();
  const items = await CertItem.find(filter);
  if (!items.length) throw new HttpError(404, 'Tidak ada item pending yang dapat di-reassign');
  const camp = await Campaign.findById(items[0].campaignId).lean<any>();
  if (!camp?.allowReassign && user.role !== 'admin') throw new HttpError(403, 'Campaign ini tidak mengizinkan reassignment');
  const now = new Date();
  for (const it of items) {
    const identity = await Identity.findById(it.identityId, { email: 1 }).lean<any>();
    if (identity?.email?.toLowerCase() === target) throw new HttpError(400, 'Reviewer tidak boleh me-review aksesnya sendiri');
    it.reassignHistory.push({ from: it.reviewer, to: target, by: user.email, reason, at: now });
    it.reviewer = target;
    it.reviewerLevelName = 'reassigned';
    it.assignedAt = now;
    await it.save();
  }
  for (const id of new Set(items.map((i) => String(i.campaignId)))) await refreshStats(id);
  const cfg = await getConfig();
  await emit('certification.reassigned', {
    vars: { campaign: camp?.name, from: user.email, reason: reason || '-', link: `${cfg.app.baseUrl}/reviews` },
    reviewers: [{ email: target, vars: { count: items.length } }],
  });
  await audit(user.email, 'certification.reassign', target, { count: items.length, reason });
  return { updated: items.length };
}

export async function sendReminders(campaignId: string, event = 'campaign.reminder') {
  const c = await Campaign.findById(campaignId);
  if (!c) throw new HttpError(404, 'Campaign tidak ditemukan');
  const pending = await CertItem.aggregate([{ $match: { campaignId: c._id, decision: 'pending' } }, { $group: { _id: '$reviewer', n: { $sum: 1 } } }]);
  const cfg = await getConfig();
  await emit(event, {
    vars: { campaign: c.name, dueDate: fmtDate(c.dueDate), link: `${cfg.app.baseUrl}/reviews` },
    reviewers: pending.map((p: any) => ({ email: p._id, vars: { count: p.n } })),
  });
  c.lastReminderAt = new Date();
  await c.save();
  return { reviewers: pending.length };
}

/** Dipanggil scheduler: launch campaign terjadwal. */
export async function processScheduledCampaigns() {
  const due = await Campaign.find({ status: 'scheduled', nextRunAt: { $lte: new Date() } }, { _id: 1 }).lean<any[]>();
  for (const c of due) {
    try {
      await launchCampaign(String(c._id), 'scheduler');
    } catch (e: any) {
      console.error('[scheduler] launch failed', c._id, e.message);
    }
  }
  return due.length;
}

/** Dipanggil scheduler: eskalasi hierarki & pengingat overdue. */
export async function processEscalationsAndOverdue() {
  const now = new Date();
  const active = await Campaign.find({ status: 'active' });
  if (!active.length) return;
  const ctx = await loadCtx();
  for (const c of active) {
    if (c.escalation?.enabled) {
      const threshold = new Date(now.getTime() - (c.escalation.afterDays || 7) * DAY);
      const stale = await CertItem.find({ campaignId: c._id, decision: 'pending', assignedAt: { $lte: threshold } });
      const notify: Record<string, number> = {};
      for (const it of stale) {
        const escalations = it.reassignHistory.filter((h: any) => h.reason === 'auto-escalation').length;
        if (escalations >= (c.escalation.maxLevel ?? 2)) continue;
        const next = resolveReviewer(ctx, ctx.identities.get(String(it.identityId)), ctx.ents.get(String(it.entitlementId)), c, (it.reviewerLevel ?? 0) + 1);
        if (next.email === it.reviewer) continue;
        it.reassignHistory.push({ from: it.reviewer, to: next.email, by: 'system', reason: 'auto-escalation', at: now });
        it.reviewer = next.email;
        it.reviewerLevel = next.level;
        it.reviewerLevelName = next.levelName;
        it.assignedAt = now;
        await it.save();
        notify[next.email] = (notify[next.email] || 0) + 1;
      }
      if (Object.keys(notify).length) {
        const cfg = await getConfig();
        await emit('certification.escalated', {
          vars: { campaign: c.name, link: `${cfg.app.baseUrl}/reviews` },
          reviewers: Object.entries(notify).map(([email, count]) => ({ email, vars: { count } })),
        });
        await refreshStats(String(c._id));
      }
    }
    if (c.dueDate && c.dueDate < now && (!c.lastReminderAt || c.lastReminderAt < new Date(now.getTime() - DAY))) {
      await sendReminders(String(c._id), 'certification.overdue');
      await refreshStats(String(c._id));
    }
  }
}
