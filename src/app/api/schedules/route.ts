import { route, ADMIN, HttpError } from '@/lib/api';
import { ReportDef, ReportSchedule } from '@/lib/models';
import { computeNextRun, cronFor } from '@/lib/reports';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const items = await ReportSchedule.find({}).sort({ createdAt: -1 }).populate('reportId', 'name dataset').lean<any[]>();
  return { items: items.map((s) => ({ ...s, cronExpression: cronFor(s) })) };
});

const SCHEDULE_FIELDS = ['name', 'reportId', 'frequency', 'cron', 'time', 'dayOfWeek', 'dayOfMonth', 'formats', 'recipients', 'slack', 'slackTarget', 'enabled'];

export const POST = route(async ({ body, user }) => {
  if (!body?.reportId || !(await ReportDef.exists({ _id: body.reportId }))) throw new HttpError(400, 'Report wajib dipilih');
  if (!body.formats?.length) throw new HttpError(400, 'Pilih minimal 1 format');
  if (!body.recipients?.length && !body.slack) throw new HttpError(400, 'Isi penerima email atau aktifkan Slack');
  const data: any = {};
  for (const k of SCHEDULE_FIELDS) if (body[k] !== undefined) data[k] = body[k];
  data.recipients = (data.recipients || []).map((r: string) => r.trim().toLowerCase()).filter(Boolean);
  const s = await ReportSchedule.create({ ...data, nextRunAt: computeNextRun(data), createdBy: user.email });
  await audit(user.email, 'schedule.create', s.name, { cron: cronFor(s) });
  return s;
}, ADMIN);
