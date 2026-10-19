import { route, ADMIN, HttpError } from '@/lib/api';
import { Campaign, CertItem } from '@/lib/models';
import { launchCampaign, refreshStats, sendReminders } from '@/lib/campaigns';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const POST = route(async ({ params, body, user }) => {
  const id = params.id;
  switch (body?.action) {
    case 'launch':
      return launchCampaign(id, user.email);
    case 'remind':
      return sendReminders(id);
    case 'refresh':
      return refreshStats(id);
    case 'cancel': {
      const c = await Campaign.findByIdAndUpdate(id, { $set: { status: 'cancelled' } }, { new: true });
      await audit(user.email, 'campaign.cancel', c?.name);
      return c;
    }
    case 'complete': {
      // tutup paksa: item pending tetap pending (tercatat di laporan)
      const c = await Campaign.findByIdAndUpdate(id, { $set: { status: 'completed', completedAt: new Date() } }, { new: true });
      await audit(user.email, 'campaign.force-complete', c?.name, { pending: await CertItem.countDocuments({ campaignId: id, decision: 'pending' }) });
      return c;
    }
    default:
      throw new HttpError(400, 'Aksi tidak dikenal');
  }
}, ADMIN);
