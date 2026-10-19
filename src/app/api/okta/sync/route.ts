import { route, ADMIN, HttpError } from '@/lib/api';
import { getSyncState, syncFromOkta } from '@/lib/okta';
import { getSetting } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export const GET = route(async () => ({ state: getSyncState(), last: await getSetting('okta.lastSync', null) }));

/** Mulai sinkronisasi di background; status dipantau via GET. */
export const POST = route(async ({ user }) => {
  if (getSyncState().running) throw new HttpError(409, 'Sinkronisasi sedang berjalan');
  syncFromOkta(user.email).catch((e) => console.error('[okta] sync failed:', e.message));
  await new Promise((r) => setTimeout(r, 300));
  return { started: true, state: getSyncState() };
}, ADMIN);
