import { route, ADMIN, HttpError } from '@/lib/api';
import { Assignment, Identity, Role } from '@/lib/models';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const roles = await Role.find({}).sort({ status: 1, confidence: -1 }).populate('entitlementIds', 'name riskLevel').populate('unusedEntitlementIds', 'name').lean<any[]>();
  return { items: roles.map((r) => ({ ...r, members: r.memberIds?.length || 0, memberIds: undefined })) };
});

/** Buat role manual; anggota dihitung otomatis (identitas yang memiliki seluruh entitlement). */
export const POST = route(async ({ body, user }) => {
  if (!body?.name || !body?.entitlementIds?.length) throw new HttpError(400, 'Nama dan minimal 1 entitlement wajib');
  const assigns = await Assignment.find({ entitlementId: { $in: body.entitlementIds } }, { identityId: 1, entitlementId: 1 }).lean<any[]>();
  const held = new Map<string, Set<string>>();
  assigns.forEach((a) => {
    const k = String(a.identityId);
    if (!held.has(k)) held.set(k, new Set());
    held.get(k)!.add(String(a.entitlementId));
  });
  const members = [...held.entries()].filter(([, s]) => body.entitlementIds.every((e: string) => s.has(String(e)))).map(([k]) => k);
  const valid = await Identity.find({ _id: { $in: members } }, { _id: 1 }).lean<any[]>();
  const r = await Role.create({ name: body.name, description: body.description, entitlementIds: body.entitlementIds, memberIds: valid.map((v) => v._id), status: 'active', source: 'manual', confidence: 1 });
  await audit(user.email, 'role.create', r.name);
  return r;
}, ADMIN);
