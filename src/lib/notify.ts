import { AppUser, WorkflowRule } from './models';
import { sendMail } from './mailer';
import { postSlack } from './slack';
import { getConfig } from './settings';
import { render } from './util';

export const WORKFLOW_EVENTS: Record<string, { label: string; vars: string[] }> = {
  'campaign.launched': { label: 'Campaign diluncurkan', vars: ['campaign', 'count', 'dueDate', 'link', 'reviewer'] },
  'campaign.reminder': { label: 'Pengingat reviewer', vars: ['campaign', 'count', 'dueDate', 'link', 'reviewer'] },
  'certification.overdue': { label: 'Certification overdue', vars: ['campaign', 'count', 'dueDate', 'link', 'reviewer'] },
  'certification.escalated': { label: 'Item dieskalasi ke reviewer berikutnya', vars: ['campaign', 'count', 'link', 'reviewer'] },
  'certification.reassigned': { label: 'Item di-reassign', vars: ['campaign', 'count', 'from', 'reason', 'link', 'reviewer'] },
  'certification.revoked': { label: 'Akses dicabut (perlu remediasi)', vars: ['campaign', 'count', 'details', 'link'] },
  'campaign.completed': { label: 'Campaign selesai', vars: ['campaign', 'total', 'approved', 'revoked', 'completionRate', 'link'] },
  'sod.violation.detected': { label: 'Pelanggaran SoD baru', vars: ['count', 'critical', 'high', 'details', 'link'] },
  'okta.sync.completed': { label: 'Sinkronisasi Okta selesai', vars: ['users', 'groups', 'apps', 'assignments', 'duration'] },
  'okta.sync.failed': { label: 'Sinkronisasi Okta gagal', vars: ['error'] },
  'report.delivered': { label: 'Laporan terjadwal terkirim', vars: ['report', 'rows', 'formats'] },
};

export type EmitPayload = {
  vars?: Record<string, any>;
  /** penerima personal (mis. reviewer) dengan variabel khusus per penerima */
  reviewers?: { email: string; vars?: Record<string, any> }[];
  owner?: string;
};

/** Workflow engine: cocokkan event dengan WorkflowRule aktif lalu kirim email / Slack. */
export async function emit(event: string, payload: EmitPayload = {}) {
  if ((global as any).__igaMute) return; // dimatikan sementara saat seeding demo data
  try {
    const rules = await WorkflowRule.find({ event, enabled: true }).lean<any[]>();
    if (!rules.length) return;
    const cfg = await getConfig();
    const baseVars = { appUrl: cfg.app.baseUrl, ...payload.vars };

    for (const rule of rules) {
      const roles: string[] = rule.recipientRoles || [];
      if (rule.channels?.email) {
        // 1) email personal untuk reviewer
        if (roles.includes('reviewers') && payload.reviewers?.length) {
          for (const r of payload.reviewers) {
            const v = { ...baseVars, reviewer: r.email, ...r.vars };
            await sendMail({ to: r.email, subject: render(rule.subject, v), html: render(rule.body, v), event });
          }
        }
        // 2) email broadcast
        const to = new Set<string>((rule.recipients || []).filter(Boolean));
        if (roles.includes('owner') && payload.owner) to.add(payload.owner);
        if (roles.includes('admins')) {
          const admins = await AppUser.find({ role: 'admin', active: true }, { email: 1 }).lean<any[]>();
          admins.forEach((a) => to.add(a.email));
        }
        if (roles.includes('business_owners')) cfg.businessOwners.forEach((e) => to.add(e));
        if (to.size) await sendMail({ to: [...to], subject: render(rule.subject, baseVars), html: render(rule.body, baseVars), event });
      }
      if (rule.channels?.slack) {
        const text = `*${render(rule.subject, baseVars)}*\n${stripHtml(render(rule.body, baseVars))}`;
        await postSlack(text, { target: rule.slackTarget || 'default', event });
      }
    }
  } catch (e) {
    console.error('[workflow] emit failed', event, e);
  }
}

const stripHtml = (s: string) =>
  s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();

export const DEFAULT_RULES = [
  {
    key: 'campaign-launched-reviewers',
    name: 'Notifikasi reviewer saat campaign diluncurkan',
    event: 'campaign.launched',
    channels: { email: true, slack: false },
    recipientRoles: ['reviewers'],
    subject: 'Access review baru: {{campaign}}',
    body: '<p>Halo {{reviewer}},</p><p>Anda memiliki <b>{{count}}</b> item access review pada campaign <b>{{campaign}}</b> yang harus diselesaikan sebelum <b>{{dueDate}}</b>.</p><p><a href="{{link}}">Buka My Reviews</a></p>',
  },
  {
    key: 'campaign-launched-slack',
    name: 'Umumkan campaign baru ke Slack',
    event: 'campaign.launched',
    channels: { email: false, slack: true },
    recipientRoles: [],
    subject: 'Campaign certification diluncurkan: {{campaign}}',
    body: 'Total {{total}} item untuk {{reviewerCount}} reviewer. Jatuh tempo {{dueDate}}.',
  },
  {
    key: 'campaign-reminder',
    name: 'Pengingat manual reviewer',
    event: 'campaign.reminder',
    channels: { email: true, slack: false },
    recipientRoles: ['reviewers'],
    subject: 'Pengingat: {{count}} review menunggu ({{campaign}})',
    body: '<p>Halo {{reviewer}},</p><p>Masih ada <b>{{count}}</b> item yang belum direview pada <b>{{campaign}}</b>. Jatuh tempo: {{dueDate}}.</p><p><a href="{{link}}">Review sekarang</a></p>',
  },
  {
    key: 'certification-overdue',
    name: 'Peringatan certification overdue',
    event: 'certification.overdue',
    channels: { email: true, slack: false },
    recipientRoles: ['reviewers'],
    subject: 'OVERDUE: {{count}} review pada {{campaign}}',
    body: '<p>Halo {{reviewer}},</p><p>Campaign <b>{{campaign}}</b> telah melewati jatuh tempo ({{dueDate}}) dan Anda masih memiliki <b>{{count}}</b> item pending.</p><p><a href="{{link}}">Selesaikan sekarang</a></p>',
  },
  {
    key: 'certification-escalated',
    name: 'Eskalasi ke reviewer berikutnya (hierarki)',
    event: 'certification.escalated',
    channels: { email: true, slack: false },
    recipientRoles: ['reviewers'],
    subject: 'Eskalasi review: {{campaign}}',
    body: '<p>Halo {{reviewer}},</p><p><b>{{count}}</b> item review dieskalasi kepada Anda karena reviewer sebelumnya belum merespons.</p><p><a href="{{link}}">Buka My Reviews</a></p>',
  },
  {
    key: 'certification-reassigned',
    name: 'Notifikasi reassign reviewer',
    event: 'certification.reassigned',
    channels: { email: true, slack: false },
    recipientRoles: ['reviewers'],
    subject: '{{count}} review dialihkan kepada Anda',
    body: '<p>Halo {{reviewer}},</p><p>{{from}} mengalihkan <b>{{count}}</b> item pada <b>{{campaign}}</b> kepada Anda.</p><p>Alasan: {{reason}}</p><p><a href="{{link}}">Buka My Reviews</a></p>',
  },
  {
    key: 'certification-revoked',
    name: 'Notifikasi admin saat akses dicabut',
    event: 'certification.revoked',
    channels: { email: true, slack: false },
    recipientRoles: ['admins'],
    subject: '{{count}} akses dicabut pada {{campaign}}',
    body: '<p>Akses berikut diputuskan <b>REVOKE</b>:</p>{{details}}<p><a href="{{link}}">Lihat campaign</a></p>',
  },
  {
    key: 'campaign-completed',
    name: 'Laporan campaign selesai ke owner & Business Owner',
    event: 'campaign.completed',
    channels: { email: true, slack: true },
    slackTarget: 'business_owner',
    recipientRoles: ['owner', 'business_owners'],
    subject: 'Campaign selesai: {{campaign}}',
    body: '<p>Campaign <b>{{campaign}}</b> telah selesai.</p><ul><li>Total item: {{total}}</li><li>Approved: {{approved}}</li><li>Revoked: {{revoked}}</li><li>Completion: {{completionRate}}%</li></ul><p><a href="{{link}}">Lihat detail</a></p>',
  },
  {
    key: 'sod-violation-detected',
    name: 'Alert pelanggaran SoD baru',
    event: 'sod.violation.detected',
    channels: { email: true, slack: true },
    recipientRoles: ['admins'],
    subject: '{{count}} pelanggaran SoD baru terdeteksi',
    body: '<p>SoD scan menemukan <b>{{count}}</b> pelanggaran baru (critical: {{critical}}, high: {{high}}).</p>{{details}}<p><a href="{{link}}">Tinjau pelanggaran</a></p>',
  },
  {
    key: 'okta-sync-completed',
    name: 'Ringkasan sinkronisasi Okta',
    event: 'okta.sync.completed',
    enabled: false,
    channels: { email: false, slack: true },
    recipientRoles: [],
    subject: 'Okta sync selesai',
    body: 'Users: {{users}}, Groups: {{groups}}, Apps: {{apps}}, Assignments: {{assignments}} ({{duration}}s)',
  },
  {
    key: 'okta-sync-failed',
    name: 'Alert sinkronisasi Okta gagal',
    event: 'okta.sync.failed',
    channels: { email: true, slack: true },
    recipientRoles: ['admins'],
    subject: 'Okta sync GAGAL',
    body: '<p>Sinkronisasi Okta gagal: <code>{{error}}</code></p>',
  },
];
