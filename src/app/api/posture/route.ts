import { route, ADMIN_AUDITOR } from '@/lib/api';
import { getPosture } from '@/lib/posture';

export const dynamic = 'force-dynamic';

/** ?range=24h|7d|30d — Identity Security Posture (SoD per jam + sinyal keamanan Okta System Log). */
export const GET = route(async ({ query }) => getPosture(query.get('range') || '24h'), ADMIN_AUDITOR);
