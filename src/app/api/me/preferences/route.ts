import { route } from '@/lib/api';
import { AppUser } from '@/lib/models';

export const dynamic = 'force-dynamic';

export const PUT = route(async ({ user, body }) => {
  const set: any = {};
  for (const k of ['theme', 'font', 'design']) if (typeof body?.[k] === 'string') set[`preferences.${k}`] = body[k];
  await AppUser.updateOne({ _id: user.sub }, { $set: set });
  return { ok: true };
});
