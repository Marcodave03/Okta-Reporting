import { route, HttpError } from '@/lib/api';
import { Assignment, CertItem, Identity, SodViolation } from '@/lib/models';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ params }) => {
  const identity = await Identity.findById(params.id).lean<any>();
  if (!identity) throw new HttpError(404, 'Identity tidak ditemukan');

  // rantai manager (hierarki reviewer)
  const chain: any[] = [];
  let cur = identity;
  const seen = new Set<string>();
  while (cur?.managerId && !seen.has(String(cur.managerId)) && chain.length < 10) {
    seen.add(String(cur.managerId));
    cur = await Identity.findById(cur.managerId, { displayName: 1, title: 1, email: 1, managerId: 1 }).lean<any>();
    if (cur) chain.push(cur);
  }

  const [reports, access, violations, certs] = await Promise.all([
    Identity.find({ managerId: identity._id }, { displayName: 1, title: 1, identityType: 1, riskLevel: 1 }).lean(),
    Assignment.find({ identityId: identity._id })
      .populate({ path: 'entitlementId', select: 'name kind riskLevel privileged applicationId', populate: { path: 'applicationId', select: 'label' } })
      .lean<any[]>(),
    SodViolation.find({ identityId: identity._id }).populate('policyId', 'name severity category').populate('matchedA', 'name').populate('matchedB', 'name').lean(),
    CertItem.find({ identityId: identity._id }).sort({ createdAt: -1 }).limit(50).populate('campaignId', 'name status').populate('entitlementId', 'name').lean(),
  ]);
  return {
    identity,
    managerChain: chain,
    directReports: reports,
    access: access.map((a) => ({
      _id: a._id,
      entitlement: a.entitlementId?.name,
      entitlementId: a.entitlementId?._id,
      kind: a.entitlementId?.kind,
      application: a.entitlementId?.applicationId?.label,
      riskLevel: a.entitlementId?.riskLevel,
      privileged: a.entitlementId?.privileged,
      grantedAt: a.grantedAt,
      lastUsedAt: a.lastUsedAt,
    })),
    violations,
    certifications: certs,
  };
});
