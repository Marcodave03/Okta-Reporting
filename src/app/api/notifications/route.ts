import { route } from '@/lib/api';
import { NotificationLog } from '@/lib/models';

export const dynamic = 'force-dynamic';

export const GET = route(async () => ({ items: await NotificationLog.find({}).sort({ at: -1 }).limit(200).lean() }));
