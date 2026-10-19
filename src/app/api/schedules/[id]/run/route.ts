import { route, ADMIN } from '@/lib/api';
import { executeSchedule } from '@/lib/reports';

export const dynamic = 'force-dynamic';

export const POST = route(async ({ params, user }) => executeSchedule(params.id, `manual:${user.email}`), ADMIN);
