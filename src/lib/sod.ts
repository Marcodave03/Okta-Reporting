import { Assignment, Entitlement, Identity, Setting, SodPolicy, SodViolation } from './models';
import { emit } from './notify';
import { computeRiskScores, takeSnapshot } from './risk';
import { escapeHtml } from './util';
import { getConfig } from './settings';

/** Library kebijakan SoD bawaan (predefined). Pola = regex case-insensitive terhadap nama entitlement Okta. */
export const SOD_TEMPLATES = [
  {
    key: 'p2p-vendor-payment',
    name: 'Vendor Master vs Payment Approval',
    category: 'Finance · Procure-to-Pay',
    severity: 'critical',
    description: 'User yang dapat membuat/mengubah vendor tidak boleh menyetujui pembayaran ke vendor tersebut (risiko fraud vendor fiktif).',
    sideA: { label: 'Vendor Create / Maintain', patterns: ['vendor.*(create|maint|master)'] },
    sideB: { label: 'Payment Approval', patterns: ['payment.*approv', 'approv.*payment'] },
    mitigation: 'Pisahkan tugas antar tim AP dan Treasury; review bulanan vendor baru.',
  },
  {
    key: 'p2p-req-po',
    name: 'Purchase Requisition vs PO Approval',
    category: 'Finance · Procure-to-Pay',
    severity: 'high',
    description: 'Pembuat purchase requisition tidak boleh menyetujui purchase order.',
    sideA: { label: 'Requisition Create', patterns: ['requisition.*create', 'create.*requisition'] },
    sideB: { label: 'PO Approve', patterns: ['po.*approv', 'purchase order.*approv'] },
    mitigation: 'Workflow approval berjenjang di sistem procurement.',
  },
  {
    key: 'gl-journal',
    name: 'Journal Entry vs Journal Approval',
    category: 'Finance · Record-to-Report',
    severity: 'high',
    description: 'Pembuat jurnal tidak boleh menyetujui jurnal yang sama.',
    sideA: { label: 'Journal Entry Create', patterns: ['journal.*(entry|create)'] },
    sideB: { label: 'Journal Approve', patterns: ['journal.*approv'] },
    mitigation: 'Dual control untuk jurnal manual di atas threshold.',
  },
  {
    key: 'treasury-bank-payment',
    name: 'Bank Account Maintenance vs Payment Release',
    category: 'Finance · Treasury',
    severity: 'critical',
    description: 'Pengelola rekening bank tidak boleh me-release pembayaran.',
    sideA: { label: 'Bank Account Maintenance', patterns: ['bank account.*maint'] },
    sideB: { label: 'Payment Release', patterns: ['payment.*release'] },
    mitigation: 'Callback verification untuk perubahan rekening.',
  },
  {
    key: 'hr-payroll',
    name: 'Payroll Admin vs HR Master Data',
    category: 'Human Resources',
    severity: 'high',
    description: 'Admin payroll tidak boleh mengubah master data karyawan (gaji, rekening).',
    sideA: { label: 'Payroll Admin', patterns: ['payroll.*admin'] },
    sideB: { label: 'HR Data Edit', patterns: ['hr data.*edit', 'hr.*master'] },
    mitigation: 'Review perubahan data gaji oleh HRBP.',
  },
  {
    key: 'it-dev-prod',
    name: 'Developer vs Production Deploy',
    category: 'IT · Change Management',
    severity: 'high',
    description: 'Developer tidak boleh melakukan deploy langsung ke production tanpa kontrol.',
    sideA: { label: 'Developer / Code Write', patterns: ['developer', 'code.*write'] },
    sideB: { label: 'Production Deploy', patterns: ['prod.*deploy', 'production.*deploy'] },
    mitigation: 'CI/CD dengan approval gate & peer review.',
  },
  {
    key: 'change-submit-approve',
    name: 'Change Request Submit vs Approve',
    category: 'IT · Change Management',
    severity: 'medium',
    description: 'Pengaju change request tidak boleh menyetujui change tersebut.',
    sideA: { label: 'Change Submit', patterns: ['change.*submit'] },
    sideB: { label: 'Change Approve', patterns: ['change.*approv'] },
    mitigation: 'CAB approval untuk perubahan normal.',
  },
  {
    key: 'sec-admin-audit',
    name: 'Security Admin vs Audit Log Admin',
    category: 'IT · Security',
    severity: 'critical',
    description: 'Admin keamanan tidak boleh mengelola audit log (dapat menghapus jejak).',
    sideA: { label: 'Security / Super Admin', patterns: ['security.*admin', 'super.*admin'] },
    sideB: { label: 'Audit Log Admin', patterns: ['audit.*log.*admin', 'siem.*admin'] },
    mitigation: 'Audit log immutable & dikirim ke SIEM terpisah.',
  },
  {
    key: 'iam-provision-approve',
    name: 'User Provisioning vs Access Approval',
    category: 'IT · Identity',
    severity: 'high',
    description: 'Pihak yang melakukan provisioning tidak boleh menyetujui permintaan akses.',
    sideA: { label: 'Provisioning Admin', patterns: ['provisioning.*admin', 'user.*admin'] },
    sideB: { label: 'Access Approver', patterns: ['access.*approv'] },
    mitigation: 'Approval akses oleh manager/app owner.',
  },
  {
    key: 'sales-credit-order',
    name: 'Credit Limit vs Sales Order Entry',
    category: 'Sales · Order-to-Cash',
    severity: 'medium',
    description: 'Pengelola credit limit pelanggan tidak boleh menginput sales order.',
    sideA: { label: 'Credit Limit Manage', patterns: ['credit limit'] },
    sideB: { label: 'Sales Order Entry', patterns: ['sales order.*entry', 'order.*entry'] },
    mitigation: 'Review mingguan perubahan credit limit.',
  },
  ...OKTA_TEMPLATES(),
];

/**
 * Kebijakan SoD untuk entitlement yang benar-benar berasal dari Okta (nama group & "<App> - Access").
 * Template ERP di atas memakai nama hak akses bisnis (vendor, journal, …) yang tidak pernah muncul di Okta,
 * sehingga tanpa template ini SoD scan pada data Okta selalu menghasilkan 0 pelanggaran.
 * `autoInstall: true` → dipasang otomatis saat belum ada policy sama sekali (lihat ensureDefaultSodPolicies).
 */
function OKTA_TEMPLATES() {
  const ADMIN = ['okta admin', 'super ?admin', 'superadmin', 'security[-_ ]admin', '(^|[-_ ])admin(istrator)?s?$', 'privileged access'];
  return [
    {
      key: 'okta-pam-admin-approver',
      name: 'Privileged Access Admin vs Privileged Access Approver',
      category: 'Okta · Privileged Access',
      severity: 'critical',
      description: 'Admin Okta Privileged Access (OPA) tidak boleh sekaligus menjadi approver akses server/aplikasi — dapat menyetujui aksesnya sendiri.',
      sideA: { label: 'OPA / PAM Admin', patterns: ['^opa_admin', '(privileged access|pam).*admin'] },
      sideB: { label: 'OPA / PAM Approver', patterns: ['opa_.*approver', '(pam|privileged).*approv'] },
      mitigation: 'Pisahkan grup admin dan approver OPA; approval oleh pihak independen.',
      autoInstall: true,
    },
    {
      key: 'okta-idadmin-approver',
      name: 'Identity Admin vs Access Approver',
      category: 'Okta · Identity',
      severity: 'high',
      description: 'Admin Okta (Admin Console / Okta Administrators / super admin) tidak boleh menjadi approver akses — dapat memberi dan menyetujui akses sendiri.',
      sideA: { label: 'Okta / Identity Admin', patterns: ['okta admin', 'super ?admin', 'superadmin', 'identity.*admin'] },
      sideB: { label: 'Access Approver', patterns: ['approver'] },
      mitigation: 'Approval akses dilakukan manager/app owner, bukan admin IdP.',
      autoInstall: true,
    },
    {
      key: 'okta-admin-mfa-bypass',
      name: 'Privileged Admin vs MFA Bypass',
      category: 'Okta · Authentication',
      severity: 'critical',
      description: 'Akun dengan hak admin tidak boleh berada di grup pengecualian MFA — kredensial admin yang bocor langsung bisa dipakai.',
      sideA: { label: 'Privileged Admin', patterns: ADMIN },
      sideB: { label: 'MFA Bypass / Exempt', patterns: ['bypass[-_ ]?mfa', 'mfa[-_ ]?(bypass|exempt|exclu)'] },
      mitigation: 'Keluarkan admin dari grup bypass MFA; wajibkan phishing-resistant MFA untuk admin.',
      autoInstall: true,
    },
    {
      key: 'okta-idp-admin-business-app',
      name: 'Okta Admin vs Core Business Application',
      category: 'Okta · Identity',
      severity: 'high',
      description: 'Admin IdP yang juga punya akses ke aplikasi inti bisnis (core banking/T24/switching) dapat memberi dirinya akses tambahan tanpa terdeteksi.',
      sideA: { label: 'Okta Admin', patterns: ['okta admin'] },
      sideB: { label: 'Core Business App', patterns: ['core banking', 't24', 'indigo bank', 'piggy-bank', 'proswitch'] },
      mitigation: 'Gunakan akun admin terpisah (tiering) dan review berkala akses aplikasi inti.',
      autoInstall: true,
    },
    {
      key: 'okta-teller-supervisor',
      name: 'Teller vs Teller Supervisor / Manager',
      category: 'Banking · Operations',
      severity: 'high',
      description: 'Teller (maker) tidak boleh merangkap supervisor/manager teller (checker) — maker-checker dilanggar.',
      sideA: { label: 'Teller (maker)', patterns: ['(^|[-_ ])teller$'] },
      sideB: { label: 'Teller Supervisor / Manager (checker)', patterns: ['teller[-_ ]?(supervisor|manager)'] },
      mitigation: 'Dual control: otorisasi transaksi oleh supervisor yang berbeda.',
      autoInstall: true,
    },
    {
      key: 'okta-finance-owner',
      name: 'Finance User vs Finance Owner / Approver',
      category: 'Finance',
      severity: 'high',
      description: 'User finance (maker) tidak boleh sekaligus owner/approver finance (checker).',
      sideA: { label: 'Finance User', patterns: ['(^|[-_ ])finance$'] },
      sideB: { label: 'Finance Owner / Approver', patterns: ['finance[-_ ]?(owner|approv)'] },
      mitigation: 'Approval transaksi finance oleh owner yang berbeda.',
      autoInstall: true,
    },
    {
      key: 'okta-ops-security-approver',
      name: 'Banking Operations vs Security Approver',
      category: 'Banking · Operations',
      severity: 'high',
      description: 'Staf operasional tidak boleh menjadi approver keamanan atas proses yang dijalankannya sendiri.',
      sideA: { label: 'Banking Operations', patterns: ['banking ops', 'operation'] },
      sideB: { label: 'Security Approver', patterns: ['security[-_ ]?approv'] },
      mitigation: 'Approver keamanan dari fungsi risk/security yang independen.',
      autoInstall: true,
    },
    {
      key: 'okta-thirdparty-privileged',
      name: 'Third-Party / Temporary Account vs Privileged Access',
      category: 'Okta · Privileged Access',
      severity: 'critical',
      description: 'Akun pihak ketiga, kontraktor, atau akses sementara tidak boleh memegang hak admin/privileged.',
      sideA: { label: 'Third-party / Temporary', patterns: ['third[-_ ]?party', 'contractor', 'temp(orary)?[-_ ]?access'] },
      sideB: { label: 'Privileged Admin', patterns: ADMIN },
      mitigation: 'Privileged access untuk pihak ketiga hanya just-in-time via PAM dengan expiry.',
      autoInstall: true,
    },
    {
      key: 'okta-secadmin-monitoring',
      name: 'Security Admin vs Security Monitoring Tools',
      category: 'IT · Security',
      severity: 'medium',
      description: 'Security/super admin yang juga mengelola tools monitoring/audit dapat menghapus jejak aktivitasnya.',
      sideA: { label: 'Security / Super Admin', patterns: ['security[-_ ]admin', 'super ?admin', 'superadmin'] },
      sideB: { label: 'Security Monitoring / Audit', patterns: ['security tools', 'audit', 'siem'] },
      mitigation: 'Log keamanan dikirim ke SIEM yang dikelola tim terpisah.',
      autoInstall: true,
    },
  ];
}

function compile(patterns: string[] = []) {
  return patterns
    .filter(Boolean)
    .map((p) => {
      try {
        return new RegExp(p, 'i');
      } catch {
        const lower = p.toLowerCase();
        return { test: (s: string) => s.toLowerCase().includes(lower) } as any as RegExp;
      }
    });
}

export function resolveSide(side: any, ents: any[]) {
  const ids = new Set<string>((side?.entitlementIds || []).map(String));
  const rx = compile(side?.patterns);
  for (const e of ents) if (rx.some((r) => r.test(e.name || ''))) ids.add(String(e._id));
  return ids;
}

export async function installTemplate(key: string, mode: 'predefined' | 'custom', actor: string) {
  const t = SOD_TEMPLATES.find((x) => x.key === key);
  if (!t) throw new Error('Template not found');
  if (mode === 'predefined') {
    const existing = await SodPolicy.findOne({ templateKey: key, isPredefined: true });
    if (existing) return existing;
  }
  return SodPolicy.create({
    name: mode === 'custom' ? `${t.name} (Custom)` : t.name,
    description: t.description,
    category: t.category,
    severity: t.severity,
    isPredefined: mode === 'predefined',
    templateKey: key,
    sideA: { label: t.sideA.label, patterns: t.sideA.patterns, entitlementIds: [] },
    sideB: { label: t.sideB.label, patterns: t.sideB.patterns, entitlementIds: [] },
    mitigation: t.mitigation,
    enabled: true,
    createdBy: actor,
  });
}

/**
 * Pasang template `autoInstall` sekali saja bila belum ada SoD policy sama sekali.
 * Tanpa policy, runSodScan tidak punya aturan untuk dievaluasi → dashboard SoD selalu 0.
 * Ditandai di Setting agar policy yang sengaja dihapus admin tidak dipasang ulang.
 */
export async function ensureDefaultSodPolicies() {
  if (await Setting.exists({ key: 'sod.defaultsInstalled' })) return 0;
  let installed = 0;
  if ((await SodPolicy.countDocuments({})) === 0) {
    for (const t of SOD_TEMPLATES) {
      if (!(t as any).autoInstall) continue;
      await installTemplate(t.key, 'predefined', 'system');
      installed++;
    }
  }
  await Setting.updateOne({ key: 'sod.defaultsInstalled' }, { $set: { value: { at: new Date(), installed } } }, { upsert: true });
  if (installed) console.log(`[sod] ${installed} default Okta SoD policies installed`);
  return installed;
}

/** Preview entitlement yang cocok dengan sisi A/B sebuah policy. */
export async function previewPolicy(policy: any) {
  const ents = await Entitlement.find({}, { name: 1 }).lean<any[]>();
  const a = resolveSide(policy.sideA, ents);
  const b = resolveSide(policy.sideB, ents);
  const name = new Map(ents.map((e) => [String(e._id), e.name]));
  return { sideA: [...a].map((id) => ({ _id: id, name: name.get(id) })), sideB: [...b].map((id) => ({ _id: id, name: name.get(id) })) };
}

/**
 * SoD engine: identitas melanggar policy bila memiliki ≥1 entitlement di sisi A
 * DAN ≥1 entitlement (berbeda) di sisi B.
 */
export async function runSodScan(opts: { notify?: boolean } = { notify: true }) {
  const [policies, ents, assigns] = await Promise.all([
    SodPolicy.find({ enabled: true }).lean<any[]>(),
    Entitlement.find({}, { name: 1 }).lean<any[]>(),
    Assignment.find({}, { identityId: 1, entitlementId: 1 }).lean<any[]>(),
  ]);
  const byIdentity = new Map<string, Set<string>>();
  for (const a of assigns) {
    const k = String(a.identityId);
    if (!byIdentity.has(k)) byIdentity.set(k, new Set());
    byIdentity.get(k)!.add(String(a.entitlementId));
  }

  const now = new Date();
  const found = new Set<string>();
  const newOnes: any[] = [];
  for (const p of policies) {
    const A = resolveSide(p.sideA, ents);
    const B = resolveSide(p.sideB, ents);
    if (!A.size || !B.size) continue;
    for (const [identityId, held] of byIdentity) {
      const mA = [...held].filter((e) => A.has(e));
      const mB = [...held].filter((e) => B.has(e));
      if (!mA.length || !mB.length) continue;
      if (mA.length === 1 && mB.length === 1 && mA[0] === mB[0]) continue;
      found.add(`${p._id}:${identityId}`);
      const res = await SodViolation.findOneAndUpdate(
        { policyId: p._id, identityId },
        {
          $set: { matchedA: mA, matchedB: mB, severity: p.severity },
          $setOnInsert: { status: 'open', detectedAt: now },
        },
        { upsert: true, new: true, includeResultMetadata: true },
      );
      const doc: any = (res as any).value;
      const isNew = !(res as any).lastErrorObject?.updatedExisting;
      // pelanggaran yang sebelumnya "remediated" namun muncul lagi -> buka kembali
      if (!isNew && doc?.status === 'remediated') {
        await SodViolation.updateOne({ _id: doc._id }, { $set: { status: 'open', detectedAt: now, resolvedAt: null } });
      }
      if (isNew || doc?.status === 'remediated') newOnes.push({ policy: p, identityId });
    }
  }

  // Pelanggaran terbuka yang tidak lagi terdeteksi -> auto remediated
  const open = await SodViolation.find({ status: { $in: ['open', 'mitigated', 'accepted'] } }, { policyId: 1, identityId: 1 }).lean<any[]>();
  const resolvedIds = open.filter((v) => !found.has(`${v.policyId}:${v.identityId}`)).map((v) => v._id);
  if (resolvedIds.length) {
    await SodViolation.updateMany({ _id: { $in: resolvedIds } }, { $set: { status: 'remediated', resolvedAt: now, resolvedBy: 'sod-engine' } });
  }

  await computeRiskScores();
  await takeSnapshot({ sodNew: newOnes.length, sodResolved: resolvedIds.length });

  if (opts.notify !== false && newOnes.length) {
    const ids = newOnes.slice(0, 15).map((n) => n.identityId);
    const people = await Identity.find({ _id: { $in: ids } }, { displayName: 1, login: 1 }).lean<any[]>();
    const pm = new Map(people.map((p) => [String(p._id), p.displayName || p.login]));
    const rows = newOnes
      .slice(0, 15)
      .map((n) => `<li><b>${escapeHtml(pm.get(String(n.identityId)))}</b> — ${escapeHtml(n.policy.name)} (${n.policy.severity})</li>`)
      .join('');
    const cfg = await getConfig();
    await emit('sod.violation.detected', {
      vars: {
        count: newOnes.length,
        critical: newOnes.filter((n) => n.policy.severity === 'critical').length,
        high: newOnes.filter((n) => n.policy.severity === 'high').length,
        details: `<ul>${rows}</ul>`,
        link: `${cfg.app.baseUrl}/sod/violations`,
      },
    });
  }
  return { policies: policies.length, violationsFound: found.size, newViolations: newOnes.length, autoResolved: resolvedIds.length };
}
