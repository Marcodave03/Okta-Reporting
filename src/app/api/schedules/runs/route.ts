import { route } from '@/lib/api';
import { ReportRun } from '@/lib/models';

export const dynamic = 'force-dynamic';

export const GET = route(async () => ({ items: await ReportRun.find({}).sort({ ranAt: -1 }).limit(100).lean() }));
