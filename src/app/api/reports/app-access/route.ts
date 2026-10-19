import { route, ADMIN_AUDITOR } from '@/lib/api';
import { Identity } from '@/lib/models';
import { userAppAccess } from '@/lib/appAccess';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ query }) => {
  const identityId = query.get('identityId');
  if (!identityId) {
    const q = query.get('q')?.trim();
    const filter: any = q
      ? { $or: [{ displayName: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { login: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { email: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }] }
      : {};
    const users = await Identity.find(filter).sort({ displayName: 1 }).limit(30).lean<any[]>();
    return { users: users.map((user) => ({ _id: user._id, displayName: user.displayName, login: user.login, email: user.email, status: user.status })) };
  }

  return (await userAppAccess(identityId)) || { identity: null, applications: [], groups: [] };
}, ADMIN_AUDITOR);
