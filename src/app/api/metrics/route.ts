import { route } from '@/lib/api';
import { allMetrics } from '@/lib/metrics';

export const dynamic = 'force-dynamic';

export const GET = route(async () => allMetrics());
