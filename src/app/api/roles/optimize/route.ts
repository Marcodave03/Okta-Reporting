import { route } from '@/lib/api';
import { optimizeRoles } from '@/lib/roleMining';

export const dynamic = 'force-dynamic';

export const GET = route(async ({ query }) => optimizeRoles(Number(query.get('unusedDays')) || 90));
