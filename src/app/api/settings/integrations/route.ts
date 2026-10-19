import { route, ADMIN } from '@/lib/api';
import { getPublicConfig, saveConfig } from '@/lib/settings';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const GET = route(async () => getPublicConfig(), ADMIN);

export const PUT = route(async ({ body, user }) => {
  const patch: any = {};
  for (const k of ['okta', 'smtp', 'slack', 'businessOwners', 'app']) if (body?.[k] !== undefined) patch[k] = body[k];
  if (patch.okta?.orgUrl) patch.okta.orgUrl = String(patch.okta.orgUrl).trim().replace(/\/$/, '');
  if (Array.isArray(patch.businessOwners)) patch.businessOwners = patch.businessOwners.map((e: string) => e.trim().toLowerCase()).filter(Boolean);
  await saveConfig(patch);
  await audit(user.email, 'settings.integrations.update', Object.keys(patch).join(','));
  return getPublicConfig();
}, ADMIN);
