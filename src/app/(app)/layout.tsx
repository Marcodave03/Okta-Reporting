import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySession } from '@/lib/jwt';
import { Shell } from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!user) redirect('/login');
  return <Shell user={{ sub: user.sub, email: user.email, name: user.name, role: user.role }}>{children}</Shell>;
}
