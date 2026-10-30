import {
  Application, Assignment, AuditLog, Campaign, CertItem, Entitlement, Identity, NotificationLog,
  ReportDef, ReportRun, ReportSchedule, Role, Setting, Snapshot, SodPolicy, SodViolation,
} from './models';
import { entitlementRisk } from './okta';
import { installTemplate, runSodScan, SOD_TEMPLATES } from './sod';
import { mineRoles } from './roleMining';
import { launchCampaign, refreshStats } from './campaigns';
import { computeNextRun } from './reports';
import { addDays, daysAgo, dayKey, DAY } from './util';

export async function clearGovernanceData() {
  await Promise.all(
    [Identity, Application, Entitlement, Assignment, Role, SodPolicy, SodViolation, Snapshot, Campaign, CertItem, ReportSchedule, ReportRun, NotificationLog, AuditLog].map((m) => m.deleteMany({})),
  );
  // policy ikut terhapus → izinkan policy SoD default Okta dipasang ulang pada sync berikutnya
  await Setting.deleteOne({ key: 'sod.defaultsInstalled' });
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const APPS: [string, string][] = [
  ['SAP ERP', 'Finance'], ['NetSuite', 'Finance'], ['Coupa', 'Finance'], ['Kyriba Treasury', 'Finance'],
  ['ADP Payroll', 'Human Resources'], ['Workday', 'Human Resources'], ['Salesforce', 'Sales'], ['Zendesk', 'Sales'],
  ['GitHub', 'Engineering'], ['AWS Console', 'Engineering'], ['Jira', 'Engineering'], ['Snowflake', 'Engineering'],
  ['ServiceNow', 'IT'], ['Okta Admin Console', 'IT'], ['Splunk', 'IT'], ['Slack', 'IT'], ['Google Workspace', 'IT'],
  ['HubSpot', 'Marketing'], ['DocuSign', 'Legal'], ['Tableau', 'Operations'],
];

const GROUPS: [string, string | null][] = [
  ['SAP - Vendor Create', 'SAP ERP'], ['SAP - Payment Approve', 'SAP ERP'], ['SAP - GL Viewer', 'SAP ERP'],
  ['NetSuite - Journal Entry Create', 'NetSuite'], ['NetSuite - Journal Approve', 'NetSuite'],
  ['Coupa - Requisition Create', 'Coupa'], ['Coupa - PO Approve', 'Coupa'],
  ['Kyriba - Bank Account Maintenance', 'Kyriba Treasury'], ['Kyriba - Payment Release', 'Kyriba Treasury'],
  ['ADP - Payroll Admin', 'ADP Payroll'], ['ADP - Payroll Viewer', 'ADP Payroll'],
  ['Workday - HR Data Edit', 'Workday'], ['Workday - Employee Self Service', 'Workday'],
  ['Salesforce - Sales Order Entry', 'Salesforce'], ['Salesforce - Credit Limit Manage', 'Salesforce'], ['Salesforce - Admin', 'Salesforce'],
  ['Zendesk - Agent', 'Zendesk'],
  ['GitHub - Developer', 'GitHub'], ['GitHub - Org Admin', 'GitHub'],
  ['AWS - Production Deploy', 'AWS Console'], ['AWS - Admin', 'AWS Console'], ['AWS - ReadOnly', 'AWS Console'],
  ['Jira - User', 'Jira'], ['Snowflake - Analyst', 'Snowflake'], ['Snowflake - Sysadmin', 'Snowflake'],
  ['ServiceNow - Change Submit', 'ServiceNow'], ['ServiceNow - Change Approve', 'ServiceNow'], ['ServiceNow - Access Approver', 'ServiceNow'],
  ['Okta - Super Admin', 'Okta Admin Console'], ['Okta - Security Admin', 'Okta Admin Console'], ['Okta - Help Desk Admin', 'Okta Admin Console'], ['Okta - User Provisioning Admin', 'Okta Admin Console'],
  ['Splunk - Audit Log Admin', 'Splunk'], ['Splunk - Viewer', 'Splunk'],
  ['HubSpot - Marketer', 'HubSpot'], ['DocuSign - Sender', 'DocuSign'], ['Tableau - Creator', 'Tableau'], ['Tableau - Viewer', 'Tableau'],
  ['Everyone', null], ['VPN Users', null], ['Executives', null], ['Finance Team', null], ['Engineering Team', null], ['Sales Team', null],
  ['HR Team', null], ['IT Team', null], ['Marketing Team', null], ['Operations Team', null], ['Legal Team', null],
];

const COMMON = ['Everyone', 'Slack - Access', 'Google Workspace - Access'];
const DEPTS: Record<string, { size: number; team: string; titles: string[]; base: string[]; extras: [string, number][] }> = {
  Finance: {
    size: 18, team: 'Finance Team', titles: ['Accountant', 'AP Specialist', 'Financial Analyst', 'Controller', 'Treasury Analyst'],
    base: ['VPN Users', 'SAP ERP - Access', 'NetSuite - Access', 'Coupa - Access', 'SAP - GL Viewer', 'Tableau - Access', 'Tableau - Viewer'],
    extras: [['SAP - Vendor Create', 0.35], ['SAP - Payment Approve', 0.3], ['NetSuite - Journal Entry Create', 0.5], ['NetSuite - Journal Approve', 0.25], ['Coupa - Requisition Create', 0.5], ['Coupa - PO Approve', 0.25], ['Kyriba Treasury - Access', 0.25], ['Kyriba - Bank Account Maintenance', 0.12], ['Kyriba - Payment Release', 0.14]],
  },
  Engineering: {
    size: 34, team: 'Engineering Team', titles: ['Software Engineer', 'Senior Software Engineer', 'DevOps Engineer', 'QA Engineer', 'Data Engineer', 'SRE'],
    base: ['VPN Users', 'GitHub - Access', 'GitHub - Developer', 'Jira - Access', 'Jira - User', 'AWS Console - Access', 'AWS - ReadOnly'],
    extras: [['AWS - Production Deploy', 0.3], ['AWS - Admin', 0.08], ['Snowflake - Access', 0.3], ['Snowflake - Analyst', 0.3], ['ServiceNow - Access', 0.4], ['ServiceNow - Change Submit', 0.4], ['ServiceNow - Change Approve', 0.12], ['GitHub - Org Admin', 0.05]],
  },
  Sales: {
    size: 24, team: 'Sales Team', titles: ['Account Executive', 'Sales Development Rep', 'Sales Ops Analyst', 'Customer Success Manager'],
    base: ['Salesforce - Access', 'Salesforce - Sales Order Entry', 'Zendesk - Access', 'Zendesk - Agent'],
    extras: [['Salesforce - Credit Limit Manage', 0.2], ['Salesforce - Admin', 0.05], ['Tableau - Access', 0.3], ['Tableau - Viewer', 0.3], ['DocuSign - Access', 0.3], ['DocuSign - Sender', 0.3]],
  },
  'Human Resources': {
    size: 10, team: 'HR Team', titles: ['HR Generalist', 'HR Business Partner', 'Recruiter', 'Compensation Analyst'],
    base: ['Workday - Access', 'Workday - Employee Self Service', 'Workday - HR Data Edit'],
    extras: [['ADP Payroll - Access', 0.5], ['ADP - Payroll Viewer', 0.4], ['ADP - Payroll Admin', 0.3], ['DocuSign - Access', 0.3], ['DocuSign - Sender', 0.3]],
  },
  IT: {
    size: 14, team: 'IT Team', titles: ['IT Support Specialist', 'Systems Administrator', 'Security Engineer', 'IAM Engineer', 'Network Engineer'],
    base: ['VPN Users', 'ServiceNow - Access', 'ServiceNow - Change Submit', 'Okta Admin Console - Access', 'Okta - Help Desk Admin', 'Jira - Access', 'Jira - User'],
    extras: [['Okta - Super Admin', 0.1], ['Okta - Security Admin', 0.25], ['Okta - User Provisioning Admin', 0.3], ['ServiceNow - Access Approver', 0.25], ['Splunk - Access', 0.45], ['Splunk - Audit Log Admin', 0.18], ['Splunk - Viewer', 0.3], ['AWS Console - Access', 0.3], ['AWS - Admin', 0.1], ['ServiceNow - Change Approve', 0.2]],
  },
  Marketing: {
    size: 12, team: 'Marketing Team', titles: ['Marketing Specialist', 'Content Strategist', 'Growth Marketer', 'Brand Designer'],
    base: ['HubSpot - Access', 'HubSpot - Marketer'],
    extras: [['Tableau - Access', 0.3], ['Tableau - Viewer', 0.3], ['Salesforce - Access', 0.3]],
  },
  Operations: {
    size: 14, team: 'Operations Team', titles: ['Operations Analyst', 'Supply Chain Specialist', 'Procurement Officer', 'Business Analyst'],
    base: ['Tableau - Access', 'Tableau - Creator', 'ServiceNow - Access'],
    extras: [['Coupa - Access', 0.4], ['Coupa - Requisition Create', 0.35], ['Coupa - PO Approve', 0.12], ['Snowflake - Access', 0.2], ['Snowflake - Analyst', 0.2]],
  },
  Legal: {
    size: 6, team: 'Legal Team', titles: ['Legal Counsel', 'Paralegal', 'Compliance Officer'],
    base: ['DocuSign - Access', 'DocuSign - Sender'],
    extras: [['Workday - Access', 0.2]],
  },
};

const NON_HUMAN: [string, 'service' | 'bot' | 'api', string, string[], number][] = [
  ['svc-backup', 'service', 'IT', ['Everyone', 'AWS Console - Access', 'AWS - Admin'], 210],
  ['svc-jenkins', 'service', 'Engineering', ['GitHub - Access', 'GitHub - Developer', 'AWS Console - Access', 'AWS - Production Deploy'], 1],
  ['svc-terraform', 'service', 'Engineering', ['AWS Console - Access', 'AWS - Admin', 'GitHub - Access', 'GitHub - Org Admin'], 3],
  ['svc-datadog', 'service', 'IT', ['AWS Console - Access', 'AWS - ReadOnly', 'Splunk - Access', 'Splunk - Viewer'], 0],
  ['svc-snowflake-etl', 'service', 'Engineering', ['Snowflake - Access', 'Snowflake - Sysadmin'], 0],
  ['svc-okta-provisioning', 'service', 'IT', ['Okta Admin Console - Access', 'Okta - User Provisioning Admin', 'Okta - Super Admin'], 2],
  ['bot-slack-notifier', 'bot', 'IT', ['Slack - Access'], 0],
  ['bot-github-actions', 'bot', 'Engineering', ['GitHub - Access', 'GitHub - Developer'], 0],
  ['bot-servicenow', 'bot', 'IT', ['ServiceNow - Access', 'ServiceNow - Change Submit', 'ServiceNow - Change Approve'], 5],
  ['api-salesforce-sync', 'api', 'Sales', ['Salesforce - Access', 'Salesforce - Admin'], 0],
  ['api-workday-integration', 'api', 'Human Resources', ['Workday - Access', 'Workday - HR Data Edit', 'ADP Payroll - Access', 'ADP - Payroll Admin'], 1],
  ['api-payments-gateway', 'api', 'Finance', ['SAP ERP - Access', 'SAP - Payment Approve', 'Kyriba Treasury - Access', 'Kyriba - Payment Release'], 130],
];

const FIRST = ['Andi', 'Budi', 'Citra', 'Dewi', 'Eko', 'Fajar', 'Gita', 'Hendra', 'Indah', 'Joko', 'Kartika', 'Lukas', 'Maya', 'Nadia', 'Oscar', 'Putri', 'Rizky', 'Sari', 'Taufik', 'Umar', 'Vina', 'Wahyu', 'Yuni', 'Zahra', 'Agus', 'Bella', 'Dimas', 'Fitri', 'Galih', 'Hana', 'Irfan', 'Jessica', 'Kevin', 'Laras', 'Michael', 'Nina', 'Rafi', 'Sinta', 'Tono', 'Wulan', 'Arif', 'Clara', 'Daniel', 'Elsa', 'Ferry', 'Grace', 'Ilham', 'Jihan'];
const LAST = ['Pratama', 'Santoso', 'Wijaya', 'Kusuma', 'Saputra', 'Hidayat', 'Nugroho', 'Lestari', 'Siregar', 'Halim', 'Gunawan', 'Setiawan', 'Purnomo', 'Tanoto', 'Wibowo', 'Hartono', 'Sutanto', 'Putra', 'Rahman', 'Susanto', 'Firmansyah', 'Anggraini', 'Simanjuntak', 'Effendi'];

export async function seedDemoData() {
  const g = global as any;
  g.__igaMute = true;
  try {
    await clearGovernanceData();
    const rand = rng(20261016);
    const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
    const chance = (p: number) => rand() < p;
    const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@iga.local').toLowerCase();

    /* ---------- identities ---------- */
    const usedNames = new Set<string>();
    const person = () => {
      for (;;) {
        const f = pick(FIRST), l = pick(LAST);
        if (!usedNames.has(f + l)) {
          usedNames.add(f + l);
          return { firstName: f, lastName: l };
        }
      }
    };
    const docs: any[] = [];
    const mk = (p: any) => {
      const n = person();
      const login = `${n.firstName}.${n.lastName}@company.com`.toLowerCase();
      const d = {
        ...n,
        displayName: `${n.firstName} ${n.lastName}`,
        login,
        email: login,
        oktaId: `demo-${docs.length + 1}`,
        status: 'ACTIVE',
        identityType: 'human',
        lifecycle: 'active',
        lastLogin: daysAgo(between(0, 20)),
        sourceCreatedAt: daysAgo(between(200, 2000)),
        source: 'demo',
        location: pick(['Jakarta', 'Surabaya', 'Bandung', 'Singapore', 'Remote']),
        employeeType: 'Employee',
        ...p,
      };
      docs.push(d);
      return d;
    };
    const ceo = mk({ department: 'Executive', title: 'Chief Executive Officer' });
    const heads: Record<string, any> = {};
    const staffByDept: Record<string, any[]> = {};
    for (const [dept, cfg] of Object.entries(DEPTS)) {
      const head = mk({ department: dept, title: `VP of ${dept}`, _mgr: ceo });
      if (dept === 'IT') Object.assign(head, { email: adminEmail, login: adminEmail, displayName: 'IGA Administrator', firstName: 'IGA', lastName: 'Administrator', title: 'CIO / IAM Owner' });
      heads[dept] = head;
      const managers = [mk({ department: dept, title: `${dept} Manager`, _mgr: head })];
      if (cfg.size >= 12) managers.push(mk({ department: dept, title: `Senior ${dept} Manager`, _mgr: head }));
      staffByDept[dept] = [];
      for (let i = 0; i < cfg.size - managers.length - 1; i++) staffByDept[dept].push(mk({ department: dept, title: pick(cfg.titles), _mgr: managers[i % managers.length] }));
    }
    const allStaff = Object.values(staffByDept).flat();
    const shuffled = [...allStaff].sort(() => rand() - 0.5);
    const movers = shuffled.slice(0, 8);
    const leavers = shuffled.slice(8, 15);
    const inactive = shuffled.slice(15, 27);
    const joiners = shuffled.slice(27, 33);
    const deptNames = Object.keys(DEPTS);
    movers.forEach((m) => Object.assign(m, { lifecycle: 'mover', previousDepartment: pick(deptNames.filter((d) => d !== m.department)), departmentChangedAt: daysAgo(between(3, 45)) }));
    leavers.forEach((m) => Object.assign(m, { lifecycle: 'leaver', status: chance(0.5) ? 'SUSPENDED' : 'DEPROVISIONED', lastLogin: daysAgo(between(20, 70)), statusChangedAt: daysAgo(between(5, 30)) }));
    inactive.forEach((m) => Object.assign(m, { lifecycle: 'inactive', lastLogin: chance(0.15) ? null : daysAgo(between(95, 320)) }));
    joiners.forEach((m) => Object.assign(m, { lifecycle: 'joiner', sourceCreatedAt: daysAgo(between(1, 25)) }));

    for (const [login, type, dept, , lastDays] of NON_HUMAN) {
      docs.push({
        oktaId: `demo-nh-${login}`, login: `${login}@company.com`, email: `${login}@company.com`, displayName: login, firstName: login, lastName: '',
        department: dept, title: type === 'service' ? 'Service Account' : type === 'bot' ? 'Bot Account' : 'API Integration',
        identityType: type, employeeType: type === 'service' ? 'Service Account' : type.toUpperCase(), status: 'ACTIVE',
        lifecycle: lastDays > 90 ? 'inactive' : 'active', lastLogin: daysAgo(lastDays), sourceCreatedAt: daysAgo(between(300, 1500)), source: 'demo', _mgr: heads[dept],
      });
    }

    const created = await Identity.insertMany(docs.map(({ _mgr, ...d }) => d));
    const byLogin = new Map(created.map((c: any) => [c.login, c]));
    await Identity.bulkWrite(
      docs.filter((d) => d._mgr).map((d) => ({ updateOne: { filter: { _id: byLogin.get(d.login)._id }, update: { $set: { managerId: byLogin.get(d._mgr.login)._id, managerRef: d._mgr.login } } } })),
    );

    /* ---------- applications & entitlements ---------- */
    const appDocs = await Application.insertMany(
      APPS.map(([label, dept]) => ({ oktaId: `demo-app-${label}`, name: label.toLowerCase().replace(/\s+/g, '_'), label, status: 'ACTIVE', signOnMode: 'SAML_2_0', owner: heads[dept].email, riskLevel: entitlementRisk(label).riskLevel, source: 'demo' })),
    );
    const appByLabel = new Map(appDocs.map((a: any) => [a.label, a]));
    const entRows: any[] = [];
    for (const a of appDocs) entRows.push({ oktaId: `app:demo-${a.label}`, kind: 'app', name: `${a.label} - Access`, applicationId: a._id, riskLevel: 'low', privileged: false, owner: a.owner, source: 'demo' });
    for (const [name, appLabel] of GROUPS) {
      const r = entitlementRisk(name);
      const app = appLabel ? appByLabel.get(appLabel) : null;
      const teamDept = Object.entries(DEPTS).find(([, c]) => c.team === name)?.[0];
      entRows.push({ oktaId: `demo-grp-${name}`, kind: 'group', name, applicationId: app?._id, ...r, owner: app?.owner || (teamDept ? heads[teamDept].email : adminEmail), source: 'demo', description: app ? `Okta group pushed to ${app.label}` : 'Okta directory group' });
    }
    const entDocs = await Entitlement.insertMany(entRows);
    const entByName = new Map(entDocs.map((e: any) => [e.name, e]));

    /* ---------- assignments (dengan usage data) ---------- */
    const assignments = new Map<string, any>();
    const grant = (identity: any, entName: string) => {
      const e = entByName.get(entName);
      if (!identity || !e) return;
      const key = `${identity._id}:${e._id}`;
      if (assignments.has(key)) return;
      const stale = ['inactive', 'leaver'].includes(identity.lifecycle);
      const r = rand();
      const lastUsedAt = stale ? (chance(0.7) ? daysAgo(between(95, 300)) : null) : r < 0.72 ? daysAgo(between(0, 30)) : r < 0.92 ? daysAgo(between(91, 220)) : null;
      assignments.set(key, { identityId: identity._id, entitlementId: e._id, grantedAt: daysAgo(between(30, 900)), lastUsedAt, source: 'demo' });
    };
    for (const c of created) {
      const i: any = c;
      if (i.identityType !== 'human') continue;
      COMMON.forEach((n) => grant(i, n));
      if (i.department === 'Executive') {
        ['Executives', 'Tableau - Access', 'Tableau - Viewer', 'Salesforce - Access'].forEach((n) => grant(i, n));
        continue;
      }
      const cfg = DEPTS[i.department];
      grant(i, cfg.team);
      cfg.base.forEach((n) => grant(i, n));
      const isLead = /VP|Manager|CIO/.test(i.title);
      cfg.extras.forEach(([n, p]) => chance(isLead ? Math.min(p * 1.6, 0.9) : p) && grant(i, n));
      if (i.lifecycle === 'mover' && i.previousDepartment) {
        const prev = DEPTS[i.previousDepartment];
        grant(i, prev.team);
        prev.base.slice(0, 3).forEach((n) => grant(i, n));
        prev.extras.slice(0, 2).forEach(([n]) => chance(0.5) && grant(i, n));
      }
    }
    for (const [login, , , ents] of NON_HUMAN) ents.forEach((n) => grant(byLogin.get(`${login}@company.com`), n));
    // admin perlu akses kritikal untuk skenario SoD demo
    const admin = byLogin.get(adminEmail);
    ['Okta - Super Admin', 'Splunk - Access', 'Splunk - Audit Log Admin', 'Okta - User Provisioning Admin'].forEach((n) => grant(admin, n));
    await Assignment.insertMany([...assignments.values()], { ordered: false });

    /* ---------- SoD policies ---------- */
    for (const t of SOD_TEMPLATES) await installTemplate(t.key, 'predefined', 'seed');
    await SodPolicy.create({
      name: 'AWS Admin vs Snowflake Sysadmin (Custom)',
      description: 'Kebijakan custom: satu identitas tidak boleh memegang kontrol penuh cloud & data warehouse.',
      category: 'Custom · Data Security',
      severity: 'high',
      isPredefined: false,
      sideA: { label: 'Cloud Admin', entitlementIds: [entByName.get('AWS - Admin')._id], patterns: [] },
      sideB: { label: 'Data Warehouse Admin', entitlementIds: [entByName.get('Snowflake - Sysadmin')._id], patterns: [] },
      mitigation: 'Gunakan break-glass account dengan approval.',
      createdBy: 'seed',
    });
    // tambah 1 identitas dengan konflik custom
    const dev = staffByDept.Engineering.map((d) => byLogin.get(d.login))[3];
    for (const n of ['AWS - Admin', 'Snowflake - Access', 'Snowflake - Sysadmin']) {
      const e = entByName.get(n);
      await Assignment.updateOne({ identityId: dev._id, entitlementId: e._id }, { $setOnInsert: { grantedAt: daysAgo(40), lastUsedAt: daysAgo(2), source: 'demo' } }, { upsert: true });
    }
    await runSodScan({ notify: false });

    // backdate sebagian violation & buat beberapa yang mitigated/remediated
    const viols = await SodViolation.find({});
    for (const v of viols) {
      v.detectedAt = daysAgo(between(1, 80));
      if (chance(0.12)) Object.assign(v, { status: 'mitigated', note: 'Compensating control: dual approval di sistem', resolvedBy: adminEmail });
      else if (chance(0.06)) Object.assign(v, { status: 'accepted', note: 'Risk accepted oleh CFO hingga Q1 2027', resolvedBy: adminEmail });
      await v.save();
    }

    /* ---------- tren historis 90 hari ---------- */
    const now = await Snapshot.findOne({ day: dayKey() }).lean<any>();
    const hist: any[] = [];
    for (let d = 89; d >= 1; d--) {
      const f = 1 + (d / 89) * 0.55 + (rand() - 0.5) * 0.08;
      const sev = now.sodBySeverity;
      const s = { low: Math.round(sev.low * f), medium: Math.round(sev.medium * f), high: Math.round(sev.high * f), critical: Math.round(sev.critical * (1 + (d / 89) * 0.8)) };
      hist.push({
        day: dayKey(daysAgo(d)), at: daysAgo(d), sodBySeverity: s, sodOpen: s.low + s.medium + s.high + s.critical,
        sodNew: between(0, 3), sodResolved: between(0, 4), avgRisk: Math.round(now.avgRisk * (1 + (d / 89) * 0.3) * 10) / 10,
        highRisk: Math.round(now.highRisk * (1 + (d / 89) * 0.4)), identities: now.identities - Math.floor(d / 15), nonHuman: now.nonHuman, certCompletion: Math.min(100, 40 + (89 - d) * 0.5),
      });
    }
    await Snapshot.insertMany(hist);

    /* ---------- role mining ---------- */
    await mineRoles({ method: 'attribute', groupBy: ['department'], minSupport: 0.8, minMembers: 3, useUsage: false }, 'seed');
    const cand = await Role.find({ status: 'candidate' }).sort({ confidence: -1 }).limit(4);
    for (const r of cand) {
      r.status = 'active';
      r.name = r.name.replace(' Role', ' Baseline Role');
      await r.save();
    }
    await mineRoles({ method: 'attribute', groupBy: ['department', 'title'], minSupport: 0.75, minMembers: 3, useUsage: true }, 'seed');

    /* ---------- campaigns ---------- */
    const mkCampaign = async (data: any, opts: { daysAgoLaunch: number; duration: number; done: number; revokeRate?: number }) => {
      const c = await Campaign.create({ owner: adminEmail, fallbackReviewer: adminEmail, createdBy: 'seed', durationDays: opts.duration, ...data, status: 'draft' });
      const inst = await launchCampaign(String(c._id), adminEmail);
      const launchedAt = daysAgo(opts.daysAgoLaunch);
      const dueDate = addDays(launchedAt, opts.duration);
      await Campaign.updateOne({ _id: inst._id }, { $set: { launchedAt, dueDate } });
      const items = await CertItem.find({ campaignId: inst._id });
      for (const it of items) {
        it.assignedAt = launchedAt;
        it.dueDate = dueDate;
        if (chance(opts.done)) {
          const revoke = chance(opts.revokeRate ?? (it.sodFlag ? 0.4 : 0.1));
          it.decision = revoke ? 'revoked' : 'approved';
          it.decidedAt = new Date(Math.min(Date.now(), launchedAt.getTime() + between(0, opts.daysAgoLaunch) * DAY));
          it.decidedBy = it.reviewer;
          it.comment = revoke ? pick(['Tidak lagi dibutuhkan', 'Pindah department', 'Konflik SoD', 'Tidak digunakan > 90 hari']) : pick(['Masih dibutuhkan', 'Sesuai job function', '']);
          it.remediation = revoke ? { status: chance(0.6) ? 'done' : 'pending', message: 'Demo', at: it.decidedAt } : { status: 'none' };
        } else if (chance(0.06)) {
          it.reassignHistory.push({ from: it.reviewer, to: adminEmail, by: it.reviewer, reason: 'Bukan atasan langsung', at: daysAgo(between(1, opts.daysAgoLaunch || 1)) });
          it.reviewer = adminEmail;
          it.reviewerLevelName = 'reassigned';
        }
        await it.save();
      }
      return refreshStats(String(inst._id));
    };

    await mkCampaign(
      { name: 'Q3 2026 Quarterly Access Review — Finance', description: 'Review triwulan seluruh akses department Finance (SOX).', scopeType: 'department', scope: { departments: ['Finance'] }, reviewerHierarchy: ['manager', 'manager_of_manager', 'fallback'] },
      { daysAgoLaunch: 60, duration: 21, done: 1 },
    );
    await mkCampaign(
      { name: 'Privileged Access Review — Oktober 2026', description: 'Certification akses privileged oleh application owner.', scopeType: 'privileged', reviewerHierarchy: ['app_owner', 'entitlement_owner', 'fallback'], autoRemediate: true },
      { daysAgoLaunch: 8, duration: 15, done: 0.6 },
    );
    await mkCampaign(
      { name: 'Leaver & Dormant Account Cleanup', description: 'Akun leaver yang masih memiliki akses.', scopeType: 'leaver', reviewerHierarchy: ['manager', 'fallback'], escalation: { enabled: true, afterDays: 3, maxLevel: 2 } },
      { daysAgoLaunch: 17, duration: 14, done: 0.2, revokeRate: 0.85 },
    );
    await mkCampaign(
      { name: 'Mover Access Recertification', description: 'Review akses karyawan yang pindah department.', scopeType: 'mover', reviewerHierarchy: ['manager', 'manager_of_manager', 'fallback'] },
      { daysAgoLaunch: 2, duration: 10, done: 0.1 },
    );
    await mkCampaign(
      { name: 'Non-Human Identity Review', description: 'Service account, bot & API — direview oleh IAM owner.', scopeType: 'non_human', reviewerHierarchy: ['specific', 'fallback'], specificReviewer: adminEmail },
      { daysAgoLaunch: 5, duration: 14, done: 0.3 },
    );
    await mkCampaign(
      { name: 'Long Inactive Accounts (90 hari)', description: 'Dormant accounts dengan akses aktif.', scopeType: 'inactive', scope: { inactiveDays: 90 }, reviewerHierarchy: ['manager', 'fallback'] },
      { daysAgoLaunch: 25, duration: 14, done: 0.45, revokeRate: 0.6 },
    );
    await Campaign.create({
      name: 'Quarterly Engineering Access Review', description: 'Campaign berulang per kuartal untuk Engineering.', scopeType: 'department', scope: { departments: ['Engineering'] },
      reviewerHierarchy: ['manager', 'manager_of_manager', 'fallback'], recurrence: 'quarterly', status: 'scheduled', nextRunAt: addDays(new Date(), 30), durationDays: 14, owner: adminEmail, fallbackReviewer: adminEmail, isTemplate: true, createdBy: 'seed',
    });
    await Campaign.create({
      name: 'Annual SOX High-Risk Certification', description: 'Certification tahunan identitas high & critical risk.', scopeType: 'risk', scope: { riskLevels: ['high', 'critical'], riskTarget: 'identity' },
      reviewerHierarchy: ['manager', 'app_owner', 'fallback'], recurrence: 'annual', status: 'scheduled', nextRunAt: addDays(new Date(), 45), durationDays: 30, owner: adminEmail, fallbackReviewer: adminEmail, isTemplate: true, createdBy: 'seed',
    });

    /* ---------- report schedules ---------- */
    const rep = async (key: string) => (await ReportDef.findOne({ systemKey: key }).lean<any>())?._id;
    const schedules = [
      { name: 'Weekly Executive Summary → Business Owner', reportId: await rep('executive'), frequency: 'weekly', dayOfWeek: 1, time: '08:00', formats: ['pdf'], recipients: [adminEmail], slack: true, slackTarget: 'business_owner' },
      { name: 'Daily Open SoD Violations', reportId: await rep('sod-open'), frequency: 'daily', time: '07:00', formats: ['csv', 'xlsx'], recipients: [adminEmail], slack: false },
      { name: 'Monthly Overdue Certifications', reportId: await rep('cert-overdue'), frequency: 'monthly', dayOfMonth: 1, time: '09:00', formats: ['pdf', 'xlsx'], recipients: [adminEmail], slack: true },
    ];
    for (const s of schedules) if (s.reportId) await ReportSchedule.create({ ...s, enabled: true, nextRunAt: computeNextRun(s), createdBy: 'seed' });
    await AuditLog.create({ actor: 'seed', action: 'demo.seed', target: 'database', details: { identities: created.length, assignments: assignments.size }, at: new Date() });
    return { identities: created.length, applications: appDocs.length, entitlements: entDocs.length, assignments: assignments.size };
  } finally {
    g.__igaMute = false;
  }
}
