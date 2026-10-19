import { route, HttpError } from '@/lib/api';
import { reassign } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';

export const POST = route(async ({ body, user }) => {
  if (user.role === 'auditor') throw new HttpError(403, 'Auditor hanya read-only');
  const ids: string[] = Array.isArray(body?.itemIds) ? body.itemIds : [];
  if (!ids.length) throw new HttpError(400, 'Pilih minimal 1 item');
  return reassign(user, ids, body.to, body.reason);
});
