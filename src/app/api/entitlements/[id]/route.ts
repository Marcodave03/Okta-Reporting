import { route, ADMIN, pick } from '@/lib/api';
import { Entitlement } from '@/lib/models';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const PATCH = route(async ({ params, body, user }) => {
  const set = pick(body, ['owner', 'riskLevel', 'privileged', 'description']);
  const ent = await Entitlement.findByIdAndUpdate(params.id, { $set: set }, { new: true });
  await audit(user.email, 'entitlement.update', ent?.name, set);
  return ent;
}, ADMIN);
