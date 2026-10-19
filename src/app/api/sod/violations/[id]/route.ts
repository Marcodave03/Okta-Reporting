import { route, ADMIN, HttpError } from '@/lib/api';
import { SodViolation } from '@/lib/models';
import { computeRiskScores } from '@/lib/risk';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const PATCH = route(async ({ params, body, user }) => {
  if (!['open', 'mitigated', 'accepted', 'remediated'].includes(body?.status)) throw new HttpError(400, 'Status tidak valid');
  if (['mitigated', 'accepted'].includes(body.status) && !String(body.note || '').trim()) throw new HttpError(400, 'Catatan / justifikasi wajib diisi');
  const v = await SodViolation.findByIdAndUpdate(
    params.id,
    { $set: { status: body.status, note: body.note, resolvedBy: user.email, resolvedAt: body.status === 'open' ? null : new Date() } },
    { new: true },
  );
  if (!v) throw new HttpError(404, 'Violation tidak ditemukan');
  await computeRiskScores();
  await audit(user.email, `sod.violation.${body.status}`, String(v._id), { note: body.note });
  return v;
}, ADMIN);
