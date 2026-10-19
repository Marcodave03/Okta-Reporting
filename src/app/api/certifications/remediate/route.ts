import { route, ADMIN } from '@/lib/api';
import { CertItem } from '@/lib/models';
import { remediate } from '@/lib/campaigns';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** Jalankan ulang remediasi untuk item revoked berstatus pending/failed. */
export const POST = route(async ({ body, user }) => {
  const f: any = { decision: 'revoked', 'remediation.status': { $in: ['pending', 'failed'] } };
  if (body?.itemIds?.length) f._id = { $in: body.itemIds };
  if (body?.campaignId) f.campaignId = body.campaignId;
  const items = await CertItem.find(f);
  const result = { done: 0, pending: 0, failed: 0 };
  for (const it of items) {
    it.remediation = await remediate(it);
    (result as any)[it.remediation.status] = ((result as any)[it.remediation.status] || 0) + 1;
    await it.save();
  }
  await audit(user.email, 'certification.remediate', `${items.length} item`, result);
  return { processed: items.length, ...result };
}, ADMIN);
