import bcrypt from 'bcryptjs';
import { route, ADMIN, HttpError } from '@/lib/api';
import { AppUser } from '@/lib/models';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const GET = route(async () => ({ items: await AppUser.find({}, { passwordHash: 0 }).sort({ createdAt: 1 }).lean() }), ADMIN);

export const POST = route(async ({ body, user }) => {
  const email = String(body?.email || '').trim().toLowerCase();
  if (!/^\S+@\S+$/.test(email)) throw new HttpError(400, 'Email tidak valid');
  if (await AppUser.exists({ email })) throw new HttpError(409, 'User sudah ada');
  if (body.password && String(body.password).length < 8) throw new HttpError(400, 'Password minimal 8 karakter');
  const u = await AppUser.create({
    email,
    name: body.name || email,
    role: ['admin', 'reviewer', 'auditor'].includes(body.role) ? body.role : 'reviewer',
    passwordHash: body.password ? await bcrypt.hash(body.password, 10) : undefined,
    authSource: body.password ? 'local' : 'okta',
  });
  await audit(user.email, 'user.create', email, { role: u.role });
  return { _id: u._id, email: u.email };
}, ADMIN);
