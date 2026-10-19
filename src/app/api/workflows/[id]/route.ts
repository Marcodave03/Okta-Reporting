import { route, ADMIN, HttpError, pick } from '@/lib/api';
import { WorkflowRule } from '@/lib/models';
import { sendMail } from '@/lib/mailer';
import { postSlack } from '@/lib/slack';
import { WORKFLOW_EVENTS } from '@/lib/notify';
import { render } from '@/lib/util';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const PATCH = route(async ({ params, body, user }) => {
  const set = pick(body, ['name', 'enabled', 'channels', 'slackTarget', 'recipientRoles', 'recipients', 'subject', 'body']);
  if (set.recipients) set.recipients = (set.recipients as string[]).map((r) => r.trim().toLowerCase()).filter(Boolean);
  const r = await WorkflowRule.findByIdAndUpdate(params.id, { $set: set }, { new: true });
  if (!r) throw new HttpError(404, 'Rule tidak ditemukan');
  await audit(user.email, 'workflow.update', r.name, set);
  return r;
}, ADMIN);

/** Kirim test rule ke user saat ini dengan variabel contoh. */
export const POST = route(async ({ params, user }) => {
  const r = await WorkflowRule.findById(params.id).lean<any>();
  if (!r) throw new HttpError(404, 'Rule tidak ditemukan');
  const sample: any = { reviewer: user.email, link: process.env.APP_BASE_URL || 'http://localhost:3000' };
  (WORKFLOW_EVENTS[r.event]?.vars || []).forEach((v) => (sample[v] ??= v === 'count' ? 12 : `<${v}>`));
  const results: any = {};
  if (r.channels?.email) results.email = await sendMail({ to: user.email, subject: `[TEST] ${render(r.subject, sample)}`, html: render(r.body, sample), event: `test:${r.event}` });
  if (r.channels?.slack) results.slack = await postSlack(`[TEST] ${render(r.subject, sample)}`, { target: r.slackTarget, event: `test:${r.event}` });
  return results;
}, ADMIN);
