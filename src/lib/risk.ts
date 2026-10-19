import { Assignment, CertItem, Entitlement, Identity, Snapshot, SodViolation } from './models';
import { dayKey } from './util';

const ENT_WEIGHT: Record<string, number> = { low: 1, medium: 4, high: 10, critical: 18 };
const SOD_WEIGHT: Record<string, number> = { low: 5, medium: 10, high: 20, critical: 30 };

export function levelFor(score: number) {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

/**
 * Risk score identitas (0-100) = bobot entitlement + bobot pelanggaran SoD
 * + faktor lifecycle (leaver/mover/inactive) + faktor non-human + privileged access.
 */
export async function computeRiskScores() {
  const [identities, ents, assigns, viols] = await Promise.all([
    Identity.find({}, { _id: 1, identityType: 1, lifecycle: 1, status: 1 }).lean<any[]>(),
    Entitlement.find({}, { _id: 1, riskLevel: 1, privileged: 1 }).lean<any[]>(),
    Assignment.find({}, { identityId: 1, entitlementId: 1 }).lean<any[]>(),
    SodViolation.find({ status: 'open' }, { identityId: 1, severity: 1 }).lean<any[]>(),
  ]);
  const entMap = new Map(ents.map((e) => [String(e._id), e]));
  const entScore = new Map<string, number>();
  const privCount = new Map<string, number>();
  for (const a of assigns) {
    const e = entMap.get(String(a.entitlementId));
    if (!e) continue;
    const k = String(a.identityId);
    entScore.set(k, (entScore.get(k) || 0) + (ENT_WEIGHT[e.riskLevel] || 1));
    if (e.privileged) privCount.set(k, (privCount.get(k) || 0) + 1);
  }
  const sodScore = new Map<string, number>();
  for (const v of viols) {
    const k = String(v.identityId);
    sodScore.set(k, (sodScore.get(k) || 0) + (SOD_WEIGHT[v.severity] || 5));
  }

  const ops = identities.map((i) => {
    const k = String(i._id);
    const access = entScore.get(k) || 0;
    const priv = privCount.get(k) || 0;
    let score = Math.min(access, 40) + Math.min(sodScore.get(k) || 0, 40);
    if (i.identityType !== 'human') score += 8 + Math.min(priv * 4, 12);
    if (i.lifecycle === 'leaver' && access > 0) score += 30;
    if (i.lifecycle === 'inactive' && priv > 0) score += 15;
    if (i.lifecycle === 'mover') score += 8;
    score = Math.max(0, Math.min(100, Math.round(score)));
    return { updateOne: { filter: { _id: i._id }, update: { $set: { riskScore: score, riskLevel: levelFor(score) } } } };
  });
  if (ops.length) await Identity.bulkWrite(ops);
  return { updated: ops.length };
}

/** Simpan snapshot harian untuk grafik tren (SoD, risk, certification). */
export async function takeSnapshot(extra: { sodNew?: number; sodResolved?: number } = {}) {
  const [bySev, agg, identities, nonHuman, certAgg] = await Promise.all([
    SodViolation.aggregate([{ $match: { status: 'open' } }, { $group: { _id: '$severity', n: { $sum: 1 } } }]),
    Identity.aggregate([{ $group: { _id: null, avg: { $avg: '$riskScore' }, high: { $sum: { $cond: [{ $gte: ['$riskScore', 50] }, 1, 0] } } } }]),
    Identity.countDocuments({}),
    Identity.countDocuments({ identityType: { $ne: 'human' } }),
    CertItem.aggregate([{ $group: { _id: null, total: { $sum: 1 }, done: { $sum: { $cond: [{ $ne: ['$decision', 'pending'] }, 1, 0] } } } }]),
  ]);
  const sev: any = { low: 0, medium: 0, high: 0, critical: 0 };
  bySev.forEach((s: any) => (sev[s._id] = s.n));
  const sodOpen = Object.values(sev).reduce((a: number, b: any) => a + b, 0);
  const key = dayKey();
  const existing = await Snapshot.findOne({ day: key }).lean<any>();
  const doc = {
    day: key,
    at: new Date(),
    sodOpen,
    sodBySeverity: sev,
    sodNew: (existing?.sodNew || 0) + (extra.sodNew || 0),
    sodResolved: (existing?.sodResolved || 0) + (extra.sodResolved || 0),
    avgRisk: Math.round((agg[0]?.avg || 0) * 10) / 10,
    highRisk: agg[0]?.high || 0,
    identities,
    nonHuman,
    certCompletion: certAgg[0]?.total ? Math.round((certAgg[0].done / certAgg[0].total) * 1000) / 10 : 0,
  };
  await Snapshot.updateOne({ day: key }, { $set: doc }, { upsert: true });
  return doc;
}
