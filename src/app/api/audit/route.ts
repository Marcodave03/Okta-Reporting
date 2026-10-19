import { route, ADMIN_AUDITOR } from '@/lib/api';
import { AuditLog } from '@/lib/models';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ query }) => {
  const f: any = {};
  const q = query.get('q');
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    f.$or = [{ actor: rx }, { action: rx }, { target: rx }];
  }
  const page = Math.max(1, Number(query.get('page') || 1));
  const [items, total] = await Promise.all([AuditLog.find(f).sort({ at: -1 }).skip((page - 1) * 50).limit(50).lean(), AuditLog.countDocuments(f)]);
  return { items, total, page, limit: 50 };
}, ADMIN_AUDITOR);
