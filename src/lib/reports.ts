import { Application, Assignment, AuditLog, Campaign, CertItem, Entitlement, Identity, OktaEvent, ReportDef, ReportRun, ReportSchedule, Role, SodPolicy, SodViolation } from './models';
import { exportData, EXPORT_FORMATS } from './exporters';
import { sendMail } from './mailer';
import { kpiBlocks, postSlack, uploadSlackFiles } from './slack';
import { emit } from './notify';
import { executiveSummary } from './metrics';
import { escapeHtml, fmtDate } from './util';
import { HttpError } from './errors';
import parser from 'cron-parser';

type Col = { key: string; label: string; type?: 'string' | 'number' | 'date' | 'boolean' };
type Dataset = { label: string; description: string; columns: Col[]; load: () => Promise<any[]> };

const lookups = async () => {
  const [ids, ents, apps] = await Promise.all([
    Identity.find({}).lean<any[]>(),
    Entitlement.find({}).lean<any[]>(),
    Application.find({}).lean<any[]>(),
  ]);
  const im = new Map(ids.map((i) => [String(i._id), i]));
  const em = new Map(ents.map((e) => [String(e._id), e]));
  const am = new Map(apps.map((a) => [String(a._id), a]));
  return { ids, ents, apps, im, em, am };
};

// harus sama dengan EVENT_CATEGORIES di components/OktaEvents.tsx
const EVENT_CATEGORY_LABELS: Record<string, string> = {
  request: 'Access request', group: 'Group membership', app_access: 'App assignment', lifecycle: 'User lifecycle',
  auth: 'Login & MFA', account: 'Akun & profil', admin: 'Perubahan admin', other: 'Lainnya',
};

export const DATASETS: Record<string, Dataset> = {
  identities: {
    label: 'Identities',
    description: 'Seluruh identitas (human & non-human) dari Okta beserta risk score',
    columns: [
      { key: 'displayName', label: 'Name' },
      { key: 'login', label: 'Login' },
      { key: 'email', label: 'Email' },
      { key: 'department', label: 'Department' },
      { key: 'title', label: 'Title' },
      { key: 'identityType', label: 'Identity Type' },
      { key: 'category', label: 'Human/Non-Human' },
      { key: 'status', label: 'Okta Status' },
      { key: 'lifecycle', label: 'Lifecycle' },
      { key: 'manager', label: 'Manager' },
      { key: 'riskScore', label: 'Risk Score', type: 'number' },
      { key: 'riskLevel', label: 'Risk Level' },
      { key: 'entitlements', label: '# Entitlements', type: 'number' },
      { key: 'lastLogin', label: 'Last Login', type: 'date' },
      { key: 'daysSinceLogin', label: 'Days Since Login', type: 'number' },
    ],
    load: async () => {
      const { ids, im } = await lookups();
      const counts = new Map((await Assignment.aggregate([{ $group: { _id: '$identityId', n: { $sum: 1 } } }])).map((x: any) => [String(x._id), x.n]));
      return ids.map((i) => ({
        ...i,
        category: i.identityType === 'human' ? 'Human' : 'Non-Human',
        manager: i.managerId ? im.get(String(i.managerId))?.displayName : '',
        entitlements: counts.get(String(i._id)) || 0,
        daysSinceLogin: i.lastLogin ? Math.floor((Date.now() - new Date(i.lastLogin).getTime()) / 86400000) : null,
      }));
    },
  },
  entitlements: {
    label: 'Entitlements',
    description: 'Group, app assignment & admin role dengan jumlah pemegang',
    columns: [
      { key: 'name', label: 'Entitlement' },
      { key: 'kind', label: 'Type' },
      { key: 'application', label: 'Application' },
      { key: 'riskLevel', label: 'Risk' },
      { key: 'privileged', label: 'Privileged', type: 'boolean' },
      { key: 'owner', label: 'Owner' },
      { key: 'holders', label: 'Holders', type: 'number' },
      { key: 'unusedHolders', label: 'Unused 90d', type: 'number' },
    ],
    load: async () => {
      const { ents, am } = await lookups();
      const agg = await Assignment.aggregate([
        { $group: { _id: '$entitlementId', n: { $sum: 1 }, unused: { $sum: { $cond: [{ $lt: ['$lastUsedAt', new Date(Date.now() - 90 * 86400000)] }, 1, 0] } } } },
      ]);
      const cm = new Map(agg.map((x: any) => [String(x._id), x]));
      return ents.map((e) => ({ ...e, application: e.applicationId ? am.get(String(e.applicationId))?.label : '', holders: cm.get(String(e._id))?.n || 0, unusedHolders: cm.get(String(e._id))?.unused || 0 }));
    },
  },
  access: {
    label: 'Access (Assignments)',
    description: 'Siapa punya akses apa, lengkap dengan data penggunaan',
    columns: [
      { key: 'identity', label: 'Identity' },
      { key: 'login', label: 'Login' },
      { key: 'department', label: 'Department' },
      { key: 'identityType', label: 'Identity Type' },
      { key: 'entitlement', label: 'Entitlement' },
      { key: 'kind', label: 'Type' },
      { key: 'application', label: 'Application' },
      { key: 'riskLevel', label: 'Risk' },
      { key: 'privileged', label: 'Privileged', type: 'boolean' },
      { key: 'grantedAt', label: 'Granted', type: 'date' },
      { key: 'lastUsedAt', label: 'Last Used', type: 'date' },
    ],
    load: async () => {
      const { im, em, am } = await lookups();
      const rows = await Assignment.find({}).lean<any[]>();
      return rows.map((a) => {
        const i = im.get(String(a.identityId)) || {};
        const e = em.get(String(a.entitlementId)) || {};
        return {
          identity: i.displayName,
          login: i.login,
          department: i.department,
          identityType: i.identityType,
          entitlement: e.name,
          kind: e.kind,
          application: e.applicationId ? am.get(String(e.applicationId))?.label : '',
          riskLevel: e.riskLevel,
          privileged: e.privileged,
          grantedAt: a.grantedAt,
          lastUsedAt: a.lastUsedAt,
        };
      });
    },
  },
  sod_violations: {
    label: 'SoD Violations',
    description: 'Pelanggaran Separation of Duties',
    columns: [
      { key: 'policy', label: 'Policy' },
      { key: 'category', label: 'Category' },
      { key: 'severity', label: 'Severity' },
      { key: 'identity', label: 'Identity' },
      { key: 'department', label: 'Department' },
      { key: 'riskScore', label: 'Identity Risk', type: 'number' },
      { key: 'conflictA', label: 'Conflicting Access A' },
      { key: 'conflictB', label: 'Conflicting Access B' },
      { key: 'status', label: 'Status' },
      { key: 'detectedAt', label: 'Detected', type: 'date' },
      { key: 'resolvedAt', label: 'Resolved', type: 'date' },
    ],
    load: async () => {
      const { im, em } = await lookups();
      const pm = new Map((await SodPolicy.find({}).lean<any[]>()).map((p) => [String(p._id), p]));
      const rows = await SodViolation.find({}).lean<any[]>();
      return rows.map((v) => {
        const i = im.get(String(v.identityId)) || {};
        const p = pm.get(String(v.policyId)) || {};
        return {
          policy: p.name,
          category: p.category,
          severity: v.severity,
          identity: i.displayName,
          department: i.department,
          riskScore: i.riskScore,
          conflictA: v.matchedA.map((e: any) => em.get(String(e))?.name).join('; '),
          conflictB: v.matchedB.map((e: any) => em.get(String(e))?.name).join('; '),
          status: v.status,
          detectedAt: v.detectedAt,
          resolvedAt: v.resolvedAt,
        };
      });
    },
  },
  certifications: {
    label: 'Certification Items',
    description: 'Keputusan access review per item',
    columns: [
      { key: 'campaign', label: 'Campaign' },
      { key: 'identity', label: 'Identity' },
      { key: 'department', label: 'Department' },
      { key: 'entitlement', label: 'Entitlement' },
      { key: 'riskLevel', label: 'Risk' },
      { key: 'sodFlag', label: 'SoD Conflict', type: 'boolean' },
      { key: 'reviewer', label: 'Reviewer' },
      { key: 'reviewerLevelName', label: 'Reviewer Level' },
      { key: 'decision', label: 'Decision' },
      { key: 'comment', label: 'Comment' },
      { key: 'decidedAt', label: 'Decided', type: 'date' },
      { key: 'dueDate', label: 'Due', type: 'date' },
      { key: 'overdue', label: 'Overdue', type: 'boolean' },
      { key: 'reassigned', label: 'Reassigned', type: 'boolean' },
      { key: 'remediation', label: 'Remediation' },
    ],
    load: async () => {
      const { im, em } = await lookups();
      const cm = new Map((await Campaign.find({}, { name: 1 }).lean<any[]>()).map((c) => [String(c._id), c.name]));
      const rows = await CertItem.find({}).lean<any[]>();
      const now = new Date();
      return rows.map((r) => ({
        campaign: cm.get(String(r.campaignId)),
        identity: im.get(String(r.identityId))?.displayName,
        department: im.get(String(r.identityId))?.department,
        entitlement: em.get(String(r.entitlementId))?.name,
        riskLevel: r.riskLevel,
        sodFlag: !!r.sodFlag,
        reviewer: r.reviewer,
        reviewerLevelName: r.reviewerLevelName,
        decision: r.decision,
        comment: r.comment,
        decidedAt: r.decidedAt,
        dueDate: r.dueDate,
        overdue: r.decision === 'pending' && r.dueDate && new Date(r.dueDate) < now,
        reassigned: (r.reassignHistory || []).length > 0,
        remediation: r.remediation?.status,
      }));
    },
  },
  campaigns: {
    label: 'Campaigns',
    description: 'Status & completion rate campaign certification',
    columns: [
      { key: 'name', label: 'Campaign' },
      { key: 'scopeType', label: 'Scope' },
      { key: 'status', label: 'Status' },
      { key: 'recurrence', label: 'Recurrence' },
      { key: 'launchedAt', label: 'Launched', type: 'date' },
      { key: 'dueDate', label: 'Due', type: 'date' },
      { key: 'total', label: 'Items', type: 'number' },
      { key: 'pending', label: 'Pending', type: 'number' },
      { key: 'approved', label: 'Approved', type: 'number' },
      { key: 'revoked', label: 'Revoked', type: 'number' },
      { key: 'completion', label: 'Completion %', type: 'number' },
      { key: 'overdue', label: 'Overdue', type: 'boolean' },
      { key: 'owner', label: 'Owner' },
    ],
    load: async () => {
      const rows = await Campaign.find({ isTemplate: { $ne: true } }).lean<any[]>();
      const now = new Date();
      return rows.map((c) => {
        const s = c.stats || {};
        return {
          ...c,
          total: s.total || 0,
          pending: s.pending || 0,
          approved: s.approved || 0,
          revoked: s.revoked || 0,
          completion: s.total ? Math.round(((s.total - s.pending) / s.total) * 1000) / 10 : 0,
          overdue: c.status === 'active' && c.dueDate && new Date(c.dueDate) < now,
        };
      });
    },
  },
  roles: {
    label: 'Roles',
    description: 'Katalog role (hasil mining & manual)',
    columns: [
      { key: 'name', label: 'Role' },
      { key: 'status', label: 'Status' },
      { key: 'source', label: 'Source' },
      { key: 'method', label: 'Method' },
      { key: 'entitlements', label: 'Entitlements' },
      { key: 'entitlementCount', label: '# Entitlements', type: 'number' },
      { key: 'members', label: 'Members', type: 'number' },
      { key: 'confidence', label: 'Confidence', type: 'number' },
    ],
    load: async () => {
      const { em } = await lookups();
      const rows = await Role.find({}).lean<any[]>();
      return rows.map((r) => ({
        ...r,
        entitlements: r.entitlementIds.map((e: any) => em.get(String(e))?.name).join('; '),
        entitlementCount: r.entitlementIds.length,
        members: r.memberIds.length,
      }));
    },
  },
  audit: {
    label: 'Audit Log',
    description: 'Jejak aktivitas administratif',
    columns: [
      { key: 'at', label: 'Time', type: 'date' },
      { key: 'actor', label: 'Actor' },
      { key: 'action', label: 'Action' },
      { key: 'target', label: 'Target' },
    ],
    load: async () => AuditLog.find({}).sort({ at: -1 }).limit(5000).lean<any[]>(),
  },
  okta_events: {
    label: 'Okta Activity',
    description: 'Event System Log Okta: access request, perubahan group & app, lifecycle, login/MFA, perubahan admin',
    columns: [
      { key: 'published', label: 'Date', type: 'date' },
      { key: 'time', label: 'Time (UTC)' },
      { key: 'category', label: 'Category' },
      { key: 'displayMessage', label: 'Activity' },
      { key: 'eventType', label: 'Event Type' },
      { key: 'actor', label: 'Actor' },
      { key: 'actorLogin', label: 'Actor Login' },
      { key: 'targetUser', label: 'Target User' },
      { key: 'targetGroup', label: 'Target Group' },
      { key: 'targetApp', label: 'Target App' },
      { key: 'targets', label: 'All Targets' },
      { key: 'outcome', label: 'Outcome' },
      { key: 'outcomeReason', label: 'Outcome Reason' },
      { key: 'severity', label: 'Severity' },
      { key: 'ipAddress', label: 'IP Address' },
      { key: 'location', label: 'Location' },
    ],
    load: async () => {
      const events = await OktaEvent.find({}, { raw: 0 }).sort({ published: -1 }).limit(50000).lean<any[]>();
      const name = (t: any) => t?.displayName || t?.alternateId || '';
      const ofType = (e: any, rx: RegExp) => (e.targets || []).filter((t: any) => rx.test(t.type || '')).map(name).join('; ');
      return events.map((e) => ({
        ...e,
        time: e.published ? new Date(e.published).toISOString().slice(11, 19) : '',
        category: EVENT_CATEGORY_LABELS[e.category] || e.category,
        actor: name(e.actor),
        actorLogin: e.actor?.alternateId || '',
        targetUser: ofType(e, /^User$/),
        targetGroup: ofType(e, /Group/),
        targetApp: ofType(e, /^App/),
        targets: (e.targets || []).map((t: any) => `${t.type}: ${name(t)}`).join('; '),
      }));
    },
  },
  executive_summary: {
    label: 'Executive Summary',
    description: 'KPI tingkat tinggi untuk Business Owner / eksekutif',
    columns: [
      { key: 'metric', label: 'Metric' },
      { key: 'value', label: 'Value' },
    ],
    load: async () => {
      const s = await executiveSummary();
      return s.kpis.map((k: any) => ({ metric: k.label, value: k.value }));
    },
  },
};

export function listDatasets() {
  return Object.entries(DATASETS).map(([key, d]) => ({ key, label: d.label, description: d.description, columns: d.columns }));
}

function applyFilter(row: any, f: { field: string; op: string; value: any }) {
  const v = row[f.field];
  const val = f.value;
  const asNum = (x: any) => (x instanceof Date ? x.getTime() : typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x) ? new Date(x).getTime() : Number(x));
  switch (f.op) {
    case 'eq':
      return String(v ?? '').toLowerCase() === String(val ?? '').toLowerCase();
    case 'ne':
      return String(v ?? '').toLowerCase() !== String(val ?? '').toLowerCase();
    case 'contains':
      return String(v ?? '').toLowerCase().includes(String(val ?? '').toLowerCase());
    case 'in':
      return String(val || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .includes(String(v ?? '').toLowerCase());
    case 'gt':
      return asNum(v) > asNum(val);
    case 'lt':
      return asNum(v) < asNum(val);
    case 'older_than_days':
      return !v || new Date(v).getTime() < Date.now() - Number(val) * 86400000;
    case 'is_true':
      return !!v;
    case 'is_false':
      return !v;
    case 'empty':
      return v === null || v === undefined || v === '';
    default:
      return true;
  }
}

export async function runReport(def: any) {
  const ds = DATASETS[def.dataset];
  if (!ds) throw new HttpError(400, `Dataset tidak dikenal: ${def.dataset}`);
  const cols = (def.columns?.length ? def.columns : ds.columns.map((c) => c.key)).map((k: string) => ds.columns.find((c) => c.key === k)).filter(Boolean) as Col[];
  let rows = await ds.load();
  for (const f of def.filters || []) if (f.field && f.op) rows = rows.filter((r) => applyFilter(r, f));
  if (def.sortBy) {
    const dir = def.sortDir === 'desc' ? -1 : 1;
    rows.sort((a, b) => {
      const x = a[def.sortBy], y = b[def.sortBy];
      if (x === y) return 0;
      if (x === undefined || x === null) return 1;
      if (y === undefined || y === null) return -1;
      return (x > y ? 1 : -1) * dir;
    });
  }
  if (def.limit) rows = rows.slice(0, def.limit);
  const out = rows.map((r) => {
    const o: any = {};
    for (const c of cols) {
      let v = r[c.key];
      if (c.type === 'date') v = v ? fmtDate(v) : '';
      else if (c.type === 'boolean') v = v ? 'Yes' : 'No';
      o[c.key] = v ?? '';
    }
    return o;
  });
  return { columns: cols, rows: out, total: out.length };
}

/* ---------------- Scheduling ---------------- */
export function cronFor(s: any) {
  if (s.frequency === 'custom' && s.cron) return s.cron;
  const [h, m] = String(s.time || '08:00').split(':').map((x) => Number(x) || 0);
  switch (s.frequency) {
    case 'hourly':
      return `${m} * * * *`;
    case 'daily':
      return `${m} ${h} * * *`;
    case 'weekly':
      return `${m} ${h} * * ${s.dayOfWeek ?? 1}`;
    case 'monthly':
      return `${m} ${h} ${s.dayOfMonth || 1} * *`;
    case 'quarterly':
      return `${m} ${h} ${s.dayOfMonth || 1} 1,4,7,10 *`;
    default:
      return `${m} ${h} * * 1`;
  }
}

export function computeNextRun(s: any, from = new Date()) {
  try {
    return parser.parseExpression(cronFor(s), { currentDate: from, tz: process.env.TZ || undefined }).next().toDate();
  } catch {
    throw new HttpError(400, 'Ekspresi cron tidak valid');
  }
}

export async function executeSchedule(scheduleId: string, trigger = 'scheduler') {
  const s = await ReportSchedule.findById(scheduleId);
  if (!s) throw new HttpError(404, 'Schedule tidak ditemukan');
  const def = await ReportDef.findById(s.reportId).lean<any>();
  if (!def) throw new HttpError(404, 'Report tidak ditemukan');
  const run = new ReportRun({ reportId: def._id, scheduleId: s._id, reportName: def.name, ranAt: new Date(), formats: s.formats, trigger, slack: s.slack });
  try {
    const result = await runReport(def);
    const attachments = [];
    for (const f of s.formats.filter((x: string) => EXPORT_FORMATS.includes(x as any))) {
      const file = await exportData(f as any, def.name, result.columns, result.rows);
      attachments.push({ filename: `${slug(def.name)}-${fmtDate(new Date())}.${file.ext}`, content: file.buffer, contentType: file.mime });
    }
    const preview = previewTable(result.columns, result.rows.slice(0, 15));
    const delivered: string[] = [];
    if (s.recipients?.length) {
      const r = await sendMail({
        to: s.recipients,
        subject: `[Report] ${def.name} — ${fmtDate(new Date())}`,
        html: `<p>Laporan terjadwal <b>${escapeHtml(def.name)}</b> (${result.total} baris). File terlampir: ${s.formats.join(', ').toUpperCase()}.</p>${preview}${result.total > 15 ? `<p style="color:#888">…dan ${result.total - 15} baris lainnya di lampiran.</p>` : ''}`,
        attachments,
        event: 'report.scheduled',
      });
      if (r.ok) delivered.push(...s.recipients);
      else throw new Error(`Email gagal: ${r.error}`);
    }
    if (s.slack) {
      let text = `*Report: ${def.name}* — ${result.total} baris (${fmtDate(new Date())})`;
      let blocks: any[] | undefined;
      if (def.dataset === 'executive_summary') blocks = kpiBlocks(`Executive Summary · ${fmtDate(new Date())}`, result.rows.map((r: any) => ({ label: r.metric, value: r.value })), 'Identity Governance Platform');
      else text += '\n' + result.rows.slice(0, 10).map((r: any) => '• ' + result.columns.slice(0, 4).map((c) => r[c.key]).join(' | ')).join('\n');
      const message = await postSlack(text, { target: s.slackTarget as any, blocks, event: 'report.scheduled' });
      if (!message.ok) throw new Error(`Slack gagal: ${message.error}`);
      delivered.push(s.slackTarget === 'business_owner' ? 'slack:business-owner' : 'slack');
      // file lampiran hanya bisa dikirim dengan bot token; tanpa bot token Slack tetap menerima ringkasan teks
      if (attachments.length) {
        const upload = await uploadSlackFiles(attachments, { target: s.slackTarget as any, comment: `Lampiran report *${def.name}*`, event: 'report.scheduled' });
        if (upload.ok) delivered.push(`${s.slackTarget === 'business_owner' ? 'slack:business-owner' : 'slack'} (files)`);
        else if (!upload.skipped) throw new Error(`Upload file ke Slack gagal: ${upload.error}`);
      }
    }
    run.rows = result.total;
    run.status = 'success';
    run.deliveredTo = delivered;
    s.lastStatus = 'success';
    await emit('report.delivered', { vars: { report: def.name, rows: result.total, formats: s.formats.join(', ') } });
  } catch (e: any) {
    run.status = 'failed';
    run.error = e.message;
    s.lastStatus = `failed: ${e.message}`;
  }
  s.lastRunAt = new Date();
  s.nextRunAt = computeNextRun(s);
  await Promise.all([run.save(), s.save()]);
  return run;
}

export async function processDueSchedules() {
  const due = await ReportSchedule.find({ enabled: true, nextRunAt: { $lte: new Date() } }, { _id: 1 }).lean<any[]>();
  for (const s of due) {
    try {
      await executeSchedule(String(s._id));
    } catch (e: any) {
      console.error('[scheduler] report failed', s._id, e.message);
    }
  }
  return due.length;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function previewTable(cols: Col[], rows: any[]) {
  const th = cols.slice(0, 6).map((c) => `<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #1662dd;font-size:12px">${escapeHtml(c.label)}</th>`).join('');
  const tr = rows.map((r) => `<tr>${cols.slice(0, 6).map((c) => `<td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:12px">${escapeHtml(r[c.key])}</td>`).join('')}</tr>`).join('');
  return `<table style="border-collapse:collapse;width:100%;margin-top:12px"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

export const SYSTEM_REPORTS = [
  { systemKey: 'all-identities', name: 'All Identities', dataset: 'identities', description: 'Inventaris lengkap identitas', sortBy: 'riskScore', sortDir: 'desc' },
  { systemKey: 'non-human', name: 'Non-Human Identities', dataset: 'identities', description: 'Service account, bot & API identities', filters: [{ field: 'category', op: 'eq', value: 'Non-Human' }], sortBy: 'riskScore', sortDir: 'desc' },
  { systemKey: 'high-risk', name: 'High Risk Identities', dataset: 'identities', description: 'Identitas dengan risk level high/critical', filters: [{ field: 'riskLevel', op: 'in', value: 'high,critical' }], sortBy: 'riskScore', sortDir: 'desc' },
  { systemKey: 'dormant', name: 'Dormant Accounts (90 hari)', dataset: 'identities', description: 'Akun tidak login > 90 hari', filters: [{ field: 'lastLogin', op: 'older_than_days', value: 90 }] },
  { systemKey: 'leavers', name: 'Leavers with Active Access', dataset: 'identities', description: 'Leaver yang masih memiliki entitlement', filters: [{ field: 'lifecycle', op: 'eq', value: 'leaver' }, { field: 'entitlements', op: 'gt', value: 0 }] },
  { systemKey: 'privileged', name: 'Privileged Access', dataset: 'access', description: 'Seluruh akses privileged', filters: [{ field: 'privileged', op: 'eq', value: 'Yes' }] },
  { systemKey: 'sod-open', name: 'Open SoD Violations', dataset: 'sod_violations', description: 'Pelanggaran SoD yang masih terbuka', filters: [{ field: 'status', op: 'eq', value: 'open' }], sortBy: 'severity' },
  { systemKey: 'cert-decisions', name: 'Certification Decisions', dataset: 'certifications', description: 'Seluruh keputusan review' },
  { systemKey: 'cert-overdue', name: 'Overdue Certifications', dataset: 'certifications', description: 'Item review pending yang melewati jatuh tempo', filters: [{ field: 'overdue', op: 'eq', value: 'Yes' }] },
  { systemKey: 'campaign-status', name: 'Campaign Status & Completion', dataset: 'campaigns', description: 'Completion rate tiap campaign', sortBy: 'launchedAt', sortDir: 'desc' },
  { systemKey: 'role-catalog', name: 'Role Catalog', dataset: 'roles', description: 'Daftar role hasil mining dan manual' },
  { systemKey: 'executive', name: 'Executive Summary', dataset: 'executive_summary', description: 'KPI eksekutif untuk Business Owner' },
  { systemKey: 'okta-activity', name: 'Okta Activity (All)', dataset: 'okta_events', description: 'Semua event System Log Okta', sortBy: 'published', sortDir: 'desc' },
  { systemKey: 'okta-access-requests', name: 'Okta Access Requests', dataset: 'okta_events', description: 'Permintaan akses dari Okta beserta persetujuan/penolakannya', filters: [{ field: 'category', op: 'eq', value: 'Access request' }], sortBy: 'published', sortDir: 'desc' },
  { systemKey: 'okta-group-changes', name: 'Group Membership Changes', dataset: 'okta_events', description: 'User ditambah/dikeluarkan dari group Okta', filters: [{ field: 'category', op: 'eq', value: 'Group membership' }], sortBy: 'published', sortDir: 'desc' },
  { systemKey: 'okta-app-changes', name: 'App Assignment Changes', dataset: 'okta_events', description: 'User diberi/dicabut akses aplikasi di Okta', filters: [{ field: 'category', op: 'eq', value: 'App assignment' }], sortBy: 'published', sortDir: 'desc' },
  { systemKey: 'okta-lifecycle', name: 'User Lifecycle Events', dataset: 'okta_events', description: 'User dibuat, diaktifkan, di-suspend, dinonaktifkan', filters: [{ field: 'category', op: 'eq', value: 'User lifecycle' }], sortBy: 'published', sortDir: 'desc' },
  { systemKey: 'okta-failed', name: 'Failed / Denied Okta Events', dataset: 'okta_events', description: 'Login gagal, MFA gagal, dan aksi yang ditolak', filters: [{ field: 'outcome', op: 'in', value: 'FAILURE,DENY' }], sortBy: 'published', sortDir: 'desc' },
  { systemKey: 'okta-admin-changes', name: 'Okta Admin Changes', dataset: 'okta_events', description: 'Perubahan konfigurasi oleh admin (group, app, policy)', filters: [{ field: 'category', op: 'eq', value: 'Perubahan admin' }], sortBy: 'published', sortDir: 'desc' },
];
