import { route, ADMIN } from '@/lib/api';
import { previewCampaign, sanitizeCampaign } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';

export const POST = route(async ({ body }) => previewCampaign({ ...sanitizeCampaign({ ...body, name: body?.name || 'preview' }) }), ADMIN);
