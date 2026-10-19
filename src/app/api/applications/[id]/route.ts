import { route, ADMIN, pick } from '@/lib/api';
import { Application } from '@/lib/models';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const PATCH = route(async ({ params, body, user }) => {
  const set = pick(body, ['owner', 'riskLevel', 'description']);
  const app = await Application.findByIdAndUpdate(params.id, { $set: set }, { new: true });
  await audit(user.email, 'application.update', app?.label, set);
  return app;
}, ADMIN);
