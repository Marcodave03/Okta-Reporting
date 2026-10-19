import { route, HttpError } from '@/lib/api';
import { decide } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';

export const POST = route(async ({ body, user }) => {
  if (user.role === 'auditor') throw new HttpError(403, 'Auditor hanya read-only');
  const ids: string[] = Array.isArray(body?.itemIds) ? body.itemIds : [];
  if (!ids.length) throw new HttpError(400, 'Pilih minimal 1 item');
  if (!['approved', 'revoked', 'pending'].includes(body.decision)) throw new HttpError(400, 'Keputusan tidak valid');
  if (body.decision === 'revoked' && !String(body.comment || '').trim()) throw new HttpError(400, 'Komentar wajib diisi untuk revoke');
  return decide(user, ids, body.decision, String(body.comment || ''));
});
