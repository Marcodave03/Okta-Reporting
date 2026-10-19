import { Application, Assignment, Campaign, CertItem, Entitlement, Identity, Snapshot, SodPolicy, SodViolation } from './models';
import { daysAgo, dayKey, fmtDate } from './util';

const SEV = ['critical', 'high', 'medium', 'low'];

export async function executiveSummary() {
  const [identities, byType, byStatus, byLifecycle, byRisk, apps, ents, privileged, sodOpen, sodBySev, certAgg, activeCampaigns, overdueItems, dormant, topRisky, snapshots] =
    await Promise.all([
      Identity.countDocuments({}),
      Identity.aggregate([{ $group: { _id: '$identityType', n: { $sum: 1 } } }]),
      Identity.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      Identity.aggregate([{ $group: { _id: '$lifecycle', n: { $sum: 1 } } }]),
      Identity.aggregate([{ $group: { _id: '$riskLevel', n: { $sum: 1 } } }]),
      Application.countDocuments({}),
      Entitlement.countDocuments({}),
      Entitlement.find({ privileged: true }, { _id: 1 }).lean<any[]>().then((e) => Assignment.countDocuments({ entitlementId: { $in: e.map((x) => x._id) } })),
      SodViolation.countDocuments({ status: 'open' }),
      SodViolation.aggregate([{ $match: { status: 'open' } }, { $group: { _id: '$severity', n: { $sum: 1 } } }]),
      CertItem.aggregate([{ $group: { _id: null, total: { $sum: 1 }, done: { $sum: { $cond: [{ $ne: ['$decision', 'pending'] }, 1, 0] } } } }]),
      Campaign.countDocuments({ status: 'active' }),
      CertItem.countDocuments({ decision: 'pending', dueDate: { $lt: new Date() } }),
      Identity.countDocuments({ status: { $ne: 'DEPROVISIONED' }, $or: [{ lastLogin: { $lt: daysAgo(90) } }, { lastLogin: null }] }),
      Identity.find({}, { displayName: 1, login: 1, department: 1, riskScore: 1, riskLevel: 1, identityType: 1, lifecycle: 1 }).sort({ riskScore: -1 }).limit(10).lean<any[]>(),
      Snapshot.find({ at: { $gte: daysAgo(90) } }).sort({ day: 1 }).lean<any[]>(),
    ]);

  const typeMap = Object.fromEntries(byType.map((x: any) => [x._id, x.n]));
  const human = typeMap.human || 0;
  const nonHuman = identities - human;
  const riskMap = Object.fromEntries(byRisk.map((x: any) => [x._id, x.n]));
  const highRisk = (riskMap.high || 0) + (riskMap.critical || 0);
  const certCompletion = certAgg[0]?.total ? Math.round((certAgg[0].done / certAgg[0].total) * 1000) / 10 : 0;
  const avgRisk = (await Identity.aggregate([{ $group: { _id: null, a: { $avg: '$riskScore' } } }]))[0]?.a || 0;
  const orgRisk = Math.round(avgRisk);

  return {
    kpis: [
      { key: 'identities', label: 'Total Identities', value: identities },
      { key: 'human', label: 'Human Identities', value: human },
      { key: 'nonHuman', label: 'Non-Human Identities', value: nonHuman },
      { key: 'highRisk', label: 'High/Critical Risk Identities', value: highRisk },
      { key: 'orgRisk', label: 'Organization Risk Score (0-100)', value: orgRisk },
      { key: 'sodOpen', label: 'Open SoD Violations', value: sodOpen },
      { key: 'certCompletion', label: 'Certification Completion %', value: certCompletion },
      { key: 'overdue', label: 'Overdue Review Items', value: overdueItems },
      { key: 'activeCampaigns', label: 'Active Campaigns', value: activeCampaigns },
      { key: 'privileged', label: 'Privileged Assignments', value: privileged },
      { key: 'dormant', label: 'Dormant Accounts (90d)', value: dormant },
      { key: 'apps', label: 'Applications', value: apps },
      { key: 'entitlements', label: 'Entitlements', value: ents },
    ],
    identityTypes: ['human', 'service', 'bot', 'api'].map((t) => ({ name: t === 'human' ? 'Human' : t === 'api' ? 'API' : t[0].toUpperCase() + t.slice(1), value: typeMap[t] || 0 })),
    humanVsNonHuman: [
      { name: 'Human', value: human },
      { name: 'Non-Human', value: nonHuman },
    ],
    statuses: byStatus.map((x: any) => ({ name: x._id || 'UNKNOWN', value: x.n })),
    lifecycle: ['joiner', 'active', 'mover', 'leaver', 'inactive'].map((l) => ({ name: l, value: byLifecycle.find((x: any) => x._id === l)?.n || 0 })),
    riskDistribution: ['low', 'medium', 'high', 'critical'].map((l) => ({ name: l, value: riskMap[l] || 0 })),
    sodBySeverity: SEV.map((s) => ({ name: s, value: sodBySev.find((x: any) => x._id === s)?.n || 0 })),
    topRisky,
    riskTrend: snapshots.map((s) => ({ day: s.day.slice(5), avgRisk: s.avgRisk, highRisk: s.highRisk, sodOpen: s.sodOpen })),
  };
}

export async function certificationMetrics() {
  const now = new Date();
  const campaigns = await Campaign.find({ isTemplate: { $ne: true }, status: { $in: ['active', 'completed'] } }).sort({ launchedAt: -1 }).limit(30).lean<any[]>();
  const [decisions, reviewerAgg, trendAgg, scheduled] = await Promise.all([
    CertItem.aggregate([{ $group: { _id: '$decision', n: { $sum: 1 } } }]),
    CertItem.aggregate([
      { $match: { campaignId: { $in: campaigns.filter((c) => c.status === 'active').map((c) => c._id) } } },
      {
        $group: {
          _id: '$reviewer',
          total: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$decision', 'pending'] }, 1, 0] } },
          overdue: { $sum: { $cond: [{ $and: [{ $eq: ['$decision', 'pending'] }, { $lt: ['$dueDate', now] }] }, 1, 0] } },
        },
      },
      { $sort: { pending: -1 } },
      { $limit: 15 },
    ]),
    CertItem.aggregate([
      { $match: { decidedAt: { $gte: daysAgo(30) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$decidedAt' } }, approved: { $sum: { $cond: [{ $eq: ['$decision', 'approved'] }, 1, 0] } }, revoked: { $sum: { $cond: [{ $eq: ['$decision', 'revoked'] }, 1, 0] } } } },
      { $sort: { _id: 1 } },
    ]),
    Campaign.find({ status: 'scheduled' }, { name: 1, nextRunAt: 1, recurrence: 1, scopeType: 1 }).sort({ nextRunAt: 1 }).limit(10).lean<any[]>(),
  ]);
  const d = Object.fromEntries(decisions.map((x: any) => [x._id, x.n]));
  const total = (d.pending || 0) + (d.approved || 0) + (d.revoked || 0);
  const pct = (c: any) => (c.stats?.total ? Math.round(((c.stats.total - c.stats.pending) / c.stats.total) * 100) : 100);
  const active = campaigns.filter((c) => c.status === 'active');
  const overdueCampaigns = active.filter((c) => c.dueDate && c.dueDate < now);
  const trendMap = new Map(trendAgg.map((t: any) => [t._id, t]));
  const trend = Array.from({ length: 30 }, (_, i) => {
    const k = dayKey(daysAgo(29 - i));
    const t: any = trendMap.get(k);
    return { day: k.slice(5), approved: t?.approved || 0, revoked: t?.revoked || 0 };
  });
  return {
    kpis: [
      { key: 'activeCampaigns', label: 'Active Campaigns', value: active.length },
      { key: 'certCompletion', label: 'Overall Completion %', value: total ? Math.round(((total - (d.pending || 0)) / total) * 1000) / 10 : 0 },
      { key: 'pending', label: 'Pending Reviews', value: d.pending || 0 },
      { key: 'overdueItems', label: 'Overdue Items', value: active.filter((c) => c.dueDate < now).reduce((a, c) => a + (c.stats?.pending || 0), 0) },
      { key: 'overdueCampaigns', label: 'Overdue Campaigns', value: overdueCampaigns.length },
      { key: 'revokeRate', label: 'Revoke Rate %', value: total - (d.pending || 0) ? Math.round(((d.revoked || 0) / (total - (d.pending || 0))) * 1000) / 10 : 0 },
    ],
    decisions: [
      { name: 'Approved', value: d.approved || 0 },
      { name: 'Revoked', value: d.revoked || 0 },
      { name: 'Pending', value: d.pending || 0 },
    ],
    campaignProgress: campaigns.slice(0, 12).map((c) => ({
      id: c._id,
      name: c.name.length > 28 ? c.name.slice(0, 27) + '…' : c.name,
      fullName: c.name,
      status: c.status,
      completion: pct(c),
      pending: c.stats?.pending || 0,
      approved: c.stats?.approved || 0,
      revoked: c.stats?.revoked || 0,
      dueDate: fmtDate(c.dueDate),
      overdue: c.status === 'active' && c.dueDate < now,
    })),
    overdueCampaigns: overdueCampaigns.map((c) => ({ id: c._id, name: c.name, dueDate: fmtDate(c.dueDate), daysOverdue: Math.ceil((now.getTime() - new Date(c.dueDate).getTime()) / 86400000), pending: c.stats?.pending || 0, completion: pct(c) })),
    reviewerWorkload: reviewerAgg.map((r: any) => ({ reviewer: r._id, total: r.total, pending: r.pending, overdue: r.overdue, completion: r.total ? Math.round(((r.total - r.pending) / r.total) * 100) : 100 })),
    decisionTrend: trend,
    upcoming: scheduled.map((s) => ({ id: s._id, name: s.name, nextRunAt: fmtDate(s.nextRunAt), recurrence: s.recurrence, scopeType: s.scopeType })),
  };
}

export async function sodMetrics() {
  const [policies, viol, snapshots, identities] = await Promise.all([
    SodPolicy.find({}, { name: 1, severity: 1, enabled: 1 }).lean<any[]>(),
    SodViolation.find({}).lean<any[]>(),
    Snapshot.find({ at: { $gte: daysAgo(90) } }).sort({ day: 1 }).lean<any[]>(),
    Identity.find({}, { displayName: 1, department: 1, riskScore: 1, riskLevel: 1 }).lean<any[]>(),
  ]);
  const im = new Map(identities.map((i) => [String(i._id), i]));
  const pm = new Map(policies.map((p) => [String(p._id), p]));
  const open = viol.filter((v) => v.status === 'open');
  const byPolicy: Record<string, number> = {};
  const byDept: Record<string, number> = {};
  const perIdentity: Record<string, number> = {};
  open.forEach((v) => {
    const p = pm.get(String(v.policyId))?.name || 'Unknown';
    byPolicy[p] = (byPolicy[p] || 0) + 1;
    const d = im.get(String(v.identityId))?.department || '—';
    byDept[d] = (byDept[d] || 0) + 1;
    perIdentity[String(v.identityId)] = (perIdentity[String(v.identityId)] || 0) + 1;
  });
  const histogram = Array.from({ length: 10 }, (_, i) => ({ range: `${i * 10}-${i * 10 + 9}`, count: 0 }));
  identities.forEach((i) => histogram[Math.min(9, Math.floor((i.riskScore || 0) / 10))].count++);
  return {
    kpis: [
      { key: 'sodOpen', label: 'Open Violations', value: open.length },
      { key: 'sodCritical', label: 'Critical', value: open.filter((v) => v.severity === 'critical').length },
      { key: 'sodHigh', label: 'High', value: open.filter((v) => v.severity === 'high').length },
      { key: 'sodMitigated', label: 'Mitigated / Accepted', value: viol.filter((v) => ['mitigated', 'accepted'].includes(v.status)).length },
      { key: 'sodResolved', label: 'Remediated (30d)', value: viol.filter((v) => v.status === 'remediated' && v.resolvedAt > daysAgo(30)).length },
      { key: 'policies', label: 'Active Policies', value: policies.filter((p) => p.enabled).length },
    ],
    sodTrend: snapshots.map((s) => ({ day: s.day.slice(5), open: s.sodOpen, critical: s.sodBySeverity?.critical || 0, high: s.sodBySeverity?.high || 0, medium: s.sodBySeverity?.medium || 0, low: s.sodBySeverity?.low || 0, newV: s.sodNew || 0, resolved: s.sodResolved || 0 })),
    sodBySeverity: SEV.map((s) => ({ name: s, value: open.filter((v) => v.severity === s).length })),
    sodByStatus: ['open', 'mitigated', 'accepted', 'remediated'].map((s) => ({ name: s, value: viol.filter((v) => v.status === s).length })),
    sodByPolicy: Object.entries(byPolicy).map(([name, value]) => ({ name: name.length > 30 ? name.slice(0, 29) + '…' : name, value })).sort((a, b) => b.value - a.value),
    sodByDepartment: Object.entries(byDept).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    riskHistogram: histogram,
    topViolators: Object.entries(perIdentity)
      .map(([id, n]) => ({ id, name: im.get(id)?.displayName, department: im.get(id)?.department, violations: n, riskScore: im.get(id)?.riskScore, riskLevel: im.get(id)?.riskLevel }))
      .sort((a, b) => b.violations - a.violations || (b.riskScore || 0) - (a.riskScore || 0))
      .slice(0, 10),
  };
}

export async function allMetrics() {
  const [exec, cert, sod] = await Promise.all([executiveSummary(), certificationMetrics(), sodMetrics()]);
  const kpis: Record<string, any> = {};
  [...exec.kpis, ...cert.kpis, ...sod.kpis].forEach((k) => (kpis[k.key] = k));
  return { ...exec, ...cert, ...sod, sodBySeverity: sod.sodBySeverity, kpiMap: kpis, generatedAt: new Date() };
}
