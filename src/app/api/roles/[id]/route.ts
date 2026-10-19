import { route, ADMIN, HttpError, pick } from '@/lib/api';
import { Role } from '@/lib/models';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const PATCH = route(async ({ params, body, user }) => {
  const r = await Role.findById(params.id);
  if (!r) throw new HttpError(404, 'Role tidak ditemukan');
  Object.assign(r, pick(body, ['name', 'description', 'status']));
  if (body?.removeEntitlementId) r.entitlementIds = r.entitlementIds.filter((e: any) => String(e) !== String(body.removeEntitlementId));
  await r.save();
  await audit(user.email, 'role.update', r.name, body);
  return r;
}, ADMIN);

export const DELETE = route(async ({ params, user }) => {
  const r = await Role.findByIdAndDelete(params.id);
  await audit(user.email, 'role.delete', r?.name);
  return { ok: true };
}, ADMIN);
