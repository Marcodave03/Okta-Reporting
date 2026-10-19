import { route, HttpError } from '@/lib/api';
import { DashboardLayout } from '@/lib/models';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, query }) => {
  const key = query.get('key');
  if (!key) throw new HttpError(400, 'key wajib');
  return { layout: await DashboardLayout.findOne({ userEmail: user.email, dashboardKey: key }).lean() };
});

export const PUT = route(async ({ user, body }) => {
  if (!body?.key || !Array.isArray(body.widgets)) throw new HttpError(400, 'key & widgets wajib');
  const widgets = body.widgets.map((w: any) => ({ key: String(w.key), visible: !!w.visible, size: Math.min(4, Math.max(1, Number(w.size) || 1)), title: w.title ? String(w.title).slice(0, 80) : undefined }));
  await DashboardLayout.updateOne({ userEmail: user.email, dashboardKey: body.key }, { $set: { widgets } }, { upsert: true });
  return { ok: true };
});

export const DELETE = route(async ({ user, query }) => {
  await DashboardLayout.deleteOne({ userEmail: user.email, dashboardKey: query.get('key') });
  return { ok: true };
});
