import { route, ADMIN, HttpError } from '@/lib/api';
import { SodPolicy, SodViolation } from '@/lib/models';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const PATCH = route(async ({ params, body, user }) => {
  const p = await SodPolicy.findById(params.id);
  if (!p) throw new HttpError(404, 'Policy tidak ditemukan');
  // predefined policy: hanya enable/disable & severity. Untuk ubah rule -> clone ke custom.
  const allowed = p.isPredefined ? ['enabled', 'severity', 'owner'] : ['name', 'description', 'category', 'severity', 'enabled', 'mitigation', 'owner', 'sideA', 'sideB'];
  for (const k of allowed) if (body?.[k] !== undefined) (p as any)[k] = body[k];
  await p.save();
  if (body?.enabled === false) await SodViolation.updateMany({ policyId: p._id, status: 'open' }, { $set: { status: 'remediated', resolvedAt: new Date(), resolvedBy: 'policy-disabled' } });
  await audit(user.email, 'sod.policy.update', p.name, body);
  return p;
}, ADMIN);

export const DELETE = route(async ({ params, user }) => {
  const p = await SodPolicy.findByIdAndDelete(params.id);
  await SodViolation.deleteMany({ policyId: params.id });
  await audit(user.email, 'sod.policy.delete', p?.name);
  return { ok: true };
}, ADMIN);
