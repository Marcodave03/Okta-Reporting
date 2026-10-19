import { route, ADMIN, HttpError } from '@/lib/api';
import { ReportSchedule } from '@/lib/models';
import { computeNextRun } from '@/lib/reports';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const FIELDS = ['name', 'frequency', 'cron', 'time', 'dayOfWeek', 'dayOfMonth', 'formats', 'recipients', 'slack', 'slackTarget', 'enabled'];

export const PATCH = route(async ({ params, body, user }) => {
  const s = await ReportSchedule.findById(params.id);
  if (!s) throw new HttpError(404, 'Schedule tidak ditemukan');
  for (const k of FIELDS) if (body?.[k] !== undefined) (s as any)[k] = body[k];
  s.nextRunAt = computeNextRun(s);
  await s.save();
  await audit(user.email, 'schedule.update', s.name, body);
  return s;
}, ADMIN);

export const DELETE = route(async ({ params, user }) => {
  const s = await ReportSchedule.findByIdAndDelete(params.id);
  await audit(user.email, 'schedule.delete', s?.name);
  return { ok: true };
}, ADMIN);
