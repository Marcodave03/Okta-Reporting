import bcrypt from 'bcryptjs';
import { route, ADMIN, HttpError } from '@/lib/api';
import { AppUser } from '@/lib/models';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const PATCH = route(async ({ params, body, user }) => {
  const u = await AppUser.findById(params.id);
  if (!u) throw new HttpError(404, 'User tidak ditemukan');
  if (String(u._id) === user.sub && (body.role && body.role !== 'admin' || body.active === false)) throw new HttpError(400, 'Tidak dapat menurunkan / menonaktifkan akun sendiri');
  if (body.name !== undefined) u.name = body.name;
  if (['admin', 'reviewer', 'auditor'].includes(body.role)) u.role = body.role;
  if (typeof body.active === 'boolean') u.active = body.active;
  if (body.password) {
    if (String(body.password).length < 8) throw new HttpError(400, 'Password minimal 8 karakter');
    u.passwordHash = await bcrypt.hash(body.password, 10);
  }
  await u.save();
  await audit(user.email, 'user.update', u.email, { role: body.role, active: body.active, passwordChanged: !!body.password });
  return { ok: true };
}, ADMIN);

export const DELETE = route(async ({ params, user }) => {
  if (params.id === user.sub) throw new HttpError(400, 'Tidak dapat menghapus akun sendiri');
  const u = await AppUser.findByIdAndDelete(params.id);
  await audit(user.email, 'user.delete', u?.email);
  return { ok: true };
}, ADMIN);
