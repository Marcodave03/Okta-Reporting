import { Assignment, Entitlement, Identity, SodPolicy, SodViolation } from './models';
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
];

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

function resolveSide(side: any, ents: any[]) {
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
