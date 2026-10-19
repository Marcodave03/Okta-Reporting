import { route, HttpError } from '@/lib/api';
import { AppUser, CertItem } from '@/lib/models';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) => {
  const u = await AppUser.findById(user.sub, { passwordHash: 0 }).lean<any>();
  if (!u) throw new HttpError(401, 'User tidak ditemukan');
  const pendingReviews = await CertItem.countDocuments({ reviewer: u.email, decision: 'pending' });
  return { user: { id: u._id, email: u.email, name: u.name, role: u.role, authSource: u.authSource }, preferences: u.preferences, pendingReviews };
});
