import { route, HttpError, pick } from '@/lib/api';
import { ReportDef, ReportSchedule } from '@/lib/models';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const PATCH = route(async ({ params, body, user }) => {
  if (user.role === 'auditor') throw new HttpError(403, 'Auditor hanya read-only');
  const r = await ReportDef.findById(params.id);
  if (!r) throw new HttpError(404, 'Report tidak ditemukan');
  Object.assign(r, pick(body, ['name', 'description', 'columns', 'filters', 'sortBy', 'sortDir', 'limit', 'chart', ...(r.isSystem ? [] : ['dataset'])]));
  await r.save();
  await audit(user.email, 'report.update', r.name);
  return r;
});

export const DELETE = route(async ({ params, user }) => {
  const r = await ReportDef.findById(params.id);
  if (!r) throw new HttpError(404, 'Report tidak ditemukan');
  if (r.isSystem) throw new HttpError(400, 'Report sistem tidak dapat dihapus (gunakan Duplicate)');
  if (user.role !== 'admin' && r.createdBy !== user.email) throw new HttpError(403, 'Hanya pembuat/admin');
  await ReportSchedule.deleteMany({ reportId: r._id });
  await r.deleteOne();
  await audit(user.email, 'report.delete', r.name);
  return { ok: true };
});
