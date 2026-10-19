import { route } from '@/lib/api';
import { previewPolicy } from '@/lib/sod';

export const dynamic = 'force-dynamic';

export const POST = route(async ({ body }) => previewPolicy(body || {}));
