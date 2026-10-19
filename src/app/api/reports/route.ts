import { route, HttpError } from '@/lib/api';
import { ReportDef, ReportSchedule } from '@/lib/models';
import { DATASETS } from '@/lib/reports';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const [items, sched] = await Promise.all([
    ReportDef.find({}).sort({ isSystem: -1, name: 1 }).lean<any[]>(),
    ReportSchedule.aggregate([{ $group: { _id: '$reportId', n: { $sum: 1 } } }]),
  ]);
  const sm = new Map(sched.map((s: any) => [String(s._id), s.n]));
  return { items: items.map((r) => ({ ...r, schedules: sm.get(String(r._id)) || 0, datasetLabel: DATASETS[r.dataset]?.label })) };
});

export const POST = route(async ({ body, user }) => {
  if (user.role === 'auditor') throw new HttpError(403, 'Auditor hanya read-only');
  if (!body?.name || !DATASETS[body?.dataset]) throw new HttpError(400, 'Nama & dataset wajib');
  const r = await ReportDef.create({
    name: body.name,
    description: body.description,
    dataset: body.dataset,
    columns: body.columns || [],
    filters: (body.filters || []).filter((f: any) => f.field && f.op),
    sortBy: body.sortBy,
    sortDir: body.sortDir,
    limit: body.limit || undefined,
    chart: body.chart,
    isSystem: false,
    createdBy: user.email,
  });
  await audit(user.email, 'report.create', r.name);
  return r;
});
