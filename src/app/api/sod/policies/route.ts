import { route, ADMIN, HttpError } from '@/lib/api';
import { SodPolicy, SodViolation } from '@/lib/models';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const [policies, counts] = await Promise.all([
    SodPolicy.find({}).sort({ isPredefined: -1, severity: 1, name: 1 }).populate('sideA.entitlementIds', 'name').populate('sideB.entitlementIds', 'name').lean(),
    SodViolation.aggregate([{ $match: { status: 'open' } }, { $group: { _id: '$policyId', n: { $sum: 1 } } }]),
  ]);
  const cm = new Map(counts.map((c: any) => [String(c._id), c.n]));
  return { items: policies.map((p: any) => ({ ...p, openViolations: cm.get(String(p._id)) || 0 })) };
});

export const POST = route(async ({ body, user }) => {
  if (!body?.name) throw new HttpError(400, 'Nama policy wajib');
  const side = (s: any) => ({ label: s?.label || '', entitlementIds: s?.entitlementIds || [], patterns: (s?.patterns || []).filter(Boolean) });
  const a = side(body.sideA), b = side(body.sideB);
  if (!(a.entitlementIds.length || a.patterns.length) || !(b.entitlementIds.length || b.patterns.length)) throw new HttpError(400, 'Sisi A dan B harus memiliki minimal 1 entitlement atau pola');
  const p = await SodPolicy.create({
    name: body.name,
    description: body.description,
    category: body.category || 'Custom',
    severity: body.severity || 'high',
    mitigation: body.mitigation,
    owner: body.owner,
    enabled: body.enabled !== false,
    isPredefined: false,
    sideA: a,
    sideB: b,
    createdBy: user.email,
  });
  await audit(user.email, 'sod.policy.create', p.name);
  return p;
}, ADMIN);
