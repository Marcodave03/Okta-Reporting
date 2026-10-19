import { route } from '@/lib/api';
import { Application, Assignment, Entitlement } from '@/lib/models';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const [apps, ents, counts] = await Promise.all([
    Application.find({}).sort({ label: 1 }).lean<any[]>(),
    Entitlement.find({}, { applicationId: 1 }).lean<any[]>(),
    Assignment.aggregate([{ $group: { _id: '$entitlementId', n: { $sum: 1 } } }]),
  ]);
  const cm = new Map(counts.map((c: any) => [String(c._id), c.n]));
  return {
    items: apps.map((a) => {
      const mine = ents.filter((e) => String(e.applicationId) === String(a._id));
      return { ...a, entitlements: mine.length, assignments: mine.reduce((s, e) => s + (cm.get(String(e._id)) || 0), 0) };
    }),
  };
});
