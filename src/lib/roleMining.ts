import { Assignment, Entitlement, Identity, Role } from './models';
import { daysAgo } from './util';

export type MiningOptions = {
  method: 'attribute' | 'cluster';
  groupBy: string[]; // atribut user: department, title, location, employeeType
  minSupport: number; // 0..1 — porsi anggota grup yang memiliki entitlement
  minMembers: number;
  similarity: number; // threshold Jaccard untuk metode cluster
  useUsage: boolean; // abaikan entitlement yang tidak dipakai > unusedDays
  unusedDays: number;
};

const DEFAULTS: MiningOptions = { method: 'attribute', groupBy: ['department', 'title'], minSupport: 0.7, minMembers: 3, similarity: 0.75, useUsage: true, unusedDays: 90 };

const jaccard = (a: Set<string>, b: Set<string>) => {
  let inter = 0;
  a.forEach((x) => b.has(x) && inter++);
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
};

async function loadMatrix(opts: MiningOptions) {
  const identities = await Identity.find({ identityType: 'human', status: { $nin: ['DEPROVISIONED', 'SUSPENDED'] } }).lean<any[]>();
  const idSet = new Set(identities.map((i) => String(i._id)));
  const assigns = await Assignment.find({ identityId: { $in: identities.map((i) => i._id) } }).lean<any[]>();
  const cutoff = daysAgo(opts.unusedDays);
  const held = new Map<string, Set<string>>();
  const used = new Map<string, Set<string>>(); // entitlement yang dipakai (usage data)
  for (const a of assigns) {
    const k = String(a.identityId);
    if (!idSet.has(k)) continue;
    if (!held.has(k)) held.set(k, new Set());
    held.get(k)!.add(String(a.entitlementId));
    if (!a.lastUsedAt || a.lastUsedAt >= cutoff) {
      if (!used.has(k)) used.set(k, new Set());
      used.get(k)!.add(String(a.entitlementId));
    }
  }
  return { identities, held, used };
}

/**
 * Role discovery & mining.
 * - attribute: kelompokkan user berdasar atribut (department/title/...), ambil entitlement
 *   yang dimiliki ≥ minSupport anggota -> kandidat role.
 * - cluster: greedy clustering Jaccard similarity atas set entitlement (usage-aware), irisan = role.
 */
export async function mineRoles(input: Partial<MiningOptions> = {}, actor = 'system') {
  const opts = { ...DEFAULTS, ...input };
  const { identities, held, used } = await loadMatrix(opts);
  const source = opts.useUsage ? used : held;
  const entNames = new Map((await Entitlement.find({}, { name: 1 }).lean<any[]>()).map((e) => [String(e._id), e.name]));
  const candidates: any[] = [];

  if (opts.method === 'attribute') {
    const groups = new Map<string, any[]>();
    for (const i of identities) {
      const key = opts.groupBy.map((f) => i[f] || '—').join(' · ');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(i);
    }
    for (const [key, members] of groups) {
      if (members.length < opts.minMembers) continue;
      const freq = new Map<string, number>();
      members.forEach((m) => source.get(String(m._id))?.forEach((e) => freq.set(e, (freq.get(e) || 0) + 1)));
      const ents = [...freq.entries()].filter(([, n]) => n / members.length >= opts.minSupport);
      if (ents.length < 2) continue;
      const confidence = ents.reduce((a, [, n]) => a + n / members.length, 0) / ents.length;
      const totalHeld = members.reduce((a, m) => a + (held.get(String(m._id))?.size || 0), 0);
      const covered = members.reduce((a, m) => a + ents.filter(([e]) => held.get(String(m._id))?.has(e)).length, 0);
      candidates.push({
        name: `${key} Role`,
        criteria: Object.fromEntries(opts.groupBy.map((f, idx) => [f, key.split(' · ')[idx]])),
        entitlementIds: ents.map(([e]) => e),
        confidence,
        coverage: totalHeld ? covered / totalHeld : 0,
      });
    }
  } else {
    const ids = identities.map((i) => String(i._id)).filter((k) => (source.get(k)?.size || 0) >= 2);
    const assigned = new Set<string>();
    let n = 1;
    for (const seed of ids) {
      if (assigned.has(seed)) continue;
      const seedSet = source.get(seed)!;
      const cluster = ids.filter((k) => !assigned.has(k) && jaccard(seedSet, source.get(k)!) >= opts.similarity);
      if (cluster.length < opts.minMembers) continue;
      cluster.forEach((k) => assigned.add(k));
      const freq = new Map<string, number>();
      cluster.forEach((k) => source.get(k)!.forEach((e) => freq.set(e, (freq.get(e) || 0) + 1)));
      const ents = [...freq.entries()].filter(([, c]) => c / cluster.length >= opts.minSupport);
      if (ents.length < 2) continue;
      const depts = new Map<string, number>();
      cluster.forEach((k) => {
        const d = identities.find((i) => String(i._id) === k)?.department || '—';
        depts.set(d, (depts.get(d) || 0) + 1);
      });
      const topDept = [...depts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      candidates.push({
        name: `Cluster ${n++} · ${topDept}`,
        criteria: { cluster: true, dominantDepartment: topDept },
        entitlementIds: ents.map(([e]) => e),
        confidence: ents.reduce((a, [, c]) => a + c / cluster.length, 0) / ents.length,
        coverage: 0,
      });
    }
  }

  // anggota = identitas yang memiliki seluruh entitlement role
  await Role.deleteMany({ status: 'candidate', source: 'mined' });
  const existingActive = await Role.find({ status: 'active' }).lean<any[]>();
  const activeKeys = new Set(existingActive.map((r) => r.entitlementIds.map(String).sort().join(',')));
  const created: any[] = [];
  for (const c of candidates) {
    const key = [...c.entitlementIds].sort().join(',');
    if (activeKeys.has(key)) continue;
    const members = identities.filter((i) => c.entitlementIds.every((e: string) => held.get(String(i._id))?.has(e)));
    const unused = c.entitlementIds.filter((e: string) => {
      const users = members.filter((m) => held.get(String(m._id))?.has(e));
      const usedBy = users.filter((m) => used.get(String(m._id))?.has(e)).length;
      return users.length && usedBy / users.length < 0.5;
    });
    created.push(
      await Role.create({
        ...c,
        description: `Ditemukan via ${opts.method === 'attribute' ? 'attribute-based mining' : 'entitlement clustering'}: ${c.entitlementIds
          .slice(0, 4)
          .map((e: string) => entNames.get(e))
          .join(', ')}${c.entitlementIds.length > 4 ? '…' : ''}`,
        status: 'candidate',
        source: 'mined',
        method: opts.method,
        memberIds: members.map((m) => m._id),
        confidence: Math.round(c.confidence * 100) / 100,
        coverage: Math.round(c.coverage * 100) / 100,
        unusedEntitlementIds: unused,
      }),
    );
  }
  return { options: opts, candidates: created.length, analyzedIdentities: identities.length };
}

/** Role optimization: rekomendasi merge, konsolidasi, hapus entitlement tidak terpakai, retire. */
export async function optimizeRoles(unusedDays = 90) {
  const roles = await Role.find({ status: { $in: ['active', 'candidate'] } }).lean<any[]>();
  const ents = new Map((await Entitlement.find({}, { name: 1 }).lean<any[]>()).map((e) => [String(e._id), e.name]));
  const recs: any[] = [];
  const sets = roles.map((r) => ({ r, s: new Set<string>(r.entitlementIds.map(String)) }));

  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i], b = sets[j];
      const sim = jaccard(a.s, b.s);
      if (sim >= 0.8 && sim < 1) {
        recs.push({ type: 'merge', severity: 'medium', roles: [a.r.name, b.r.name], roleIds: [a.r._id, b.r._id], message: `Overlap ${Math.round(sim * 100)}% — pertimbangkan merge menjadi satu role.` });
      } else if (sim === 1) {
        recs.push({ type: 'duplicate', severity: 'high', roles: [a.r.name, b.r.name], roleIds: [a.r._id, b.r._id], message: 'Role identik (entitlement sama persis) — hapus salah satu.' });
      } else if ([...a.s].every((x) => b.s.has(x)) || [...b.s].every((x) => a.s.has(x))) {
        const [small, big] = a.s.size < b.s.size ? [a, b] : [b, a];
        recs.push({ type: 'hierarchy', severity: 'low', roles: [small.r.name, big.r.name], roleIds: [small.r._id, big.r._id], message: `"${small.r.name}" adalah subset dari "${big.r.name}" — jadikan parent/child role.` });
      }
    }
  }

  const cutoff = daysAgo(unusedDays);
  for (const { r } of sets) {
    if ((r.memberIds?.length || 0) < 2) recs.push({ type: 'retire', severity: 'low', roles: [r.name], roleIds: [r._id], message: `Hanya ${r.memberIds?.length || 0} anggota — pertimbangkan retire / gabungkan.` });
    const assigns = await Assignment.find({ identityId: { $in: r.memberIds || [] }, entitlementId: { $in: r.entitlementIds } }, { entitlementId: 1, lastUsedAt: 1 }).lean<any[]>();
    const byEnt = new Map<string, { total: number; unused: number }>();
    assigns.forEach((a) => {
      const k = String(a.entitlementId);
      const s = byEnt.get(k) || { total: 0, unused: 0 };
      s.total++;
      if (a.lastUsedAt && a.lastUsedAt < cutoff) s.unused++;
      byEnt.set(k, s);
    });
    for (const [e, s] of byEnt) {
      if (s.total >= 2 && s.unused / s.total >= 0.6)
        recs.push({ type: 'remove_entitlement', severity: 'medium', roles: [r.name], roleIds: [r._id], entitlement: ents.get(e), entitlementId: e, message: `${Math.round((s.unused / s.total) * 100)}% anggota tidak memakai "${ents.get(e)}" dalam ${unusedDays} hari — hapus dari role.` });
    }
  }

  // akses di luar role (outlier / excess access)
  const activeRoles = roles.filter((r) => r.status === 'active');
  const roleEnts = new Set(activeRoles.flatMap((r) => r.entitlementIds.map(String)));
  const totalAssign = await Assignment.countDocuments({});
  const inRole = roleEnts.size ? await Assignment.countDocuments({ entitlementId: { $in: [...roleEnts] } }) : 0;
  return {
    recommendations: recs,
    summary: {
      roles: roles.length,
      activeRoles: activeRoles.length,
      candidateRoles: roles.length - activeRoles.length,
      roleCoverage: totalAssign ? Math.round((inRole / totalAssign) * 1000) / 10 : 0,
      excessAssignments: totalAssign - inRole,
    },
  };
}
