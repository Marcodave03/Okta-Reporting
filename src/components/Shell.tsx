'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import {
  Activity, AppWindow, BarChart3, Bell, CalendarClock, ChevronDown, ClipboardCheck, FileBarChart, GitFork, History,
  Inbox, LayoutDashboard, LogOut, Menu, Network, Palette, RefreshCw, Scale, Search, Settings, ShieldAlert, ShieldCheck,
  Users, Workflow, LayoutGrid,
} from 'lucide-react';
import { Toaster, toast, toastError } from './ui';
import { api } from '@/lib/client';
import { useTheme } from './ThemeProvider';
import type { SessionUser } from '@/lib/jwt';
import { UserCtx } from './UserContext';

type NavItem = { href: string; label: string; icon: any; roles?: string[]; badge?: 'reviews' };
const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Dashboards',
    items: [
      { href: '/dashboard', label: 'Executive Overview', icon: LayoutDashboard },
      { href: '/dashboard/certifications', label: 'Certification Status', icon: ClipboardCheck },
      { href: '/dashboard/sod', label: 'SoD & Risk', icon: ShieldAlert },
      { href: '/dashboard/custom', label: 'My Dashboard', icon: LayoutGrid },
    ],
  },
  {
    section: 'Directory',
    items: [
      { href: '/identities', label: 'Identities', icon: Users },
      { href: '/hierarchy', label: 'Org Hierarchy', icon: Network },
      { href: '/applications', label: 'Apps & Entitlements', icon: AppWindow },
    ],
  },
  {
    section: 'Governance',
    items: [
      { href: '/reviews', label: 'My Reviews', icon: Inbox, badge: 'reviews' },
      { href: '/campaigns', label: 'Certification Campaigns', icon: ShieldCheck, roles: ['admin', 'auditor'] },
      { href: '/sod/policies', label: 'SoD Policies', icon: Scale, roles: ['admin', 'auditor'] },
      { href: '/sod/violations', label: 'SoD Violations', icon: Activity, roles: ['admin', 'auditor'] },
      { href: '/roles', label: 'Role Mining', icon: GitFork, roles: ['admin', 'auditor'] },
    ],
  },
  {
    section: 'Reporting',
    items: [
      { href: '/reports', label: 'Reports', icon: FileBarChart },
      { href: '/reports/app-access', label: 'App Access Activity', icon: AppWindow, roles: ['admin', 'auditor'] },
      { href: '/reports/schedules', label: 'Report Schedules', icon: CalendarClock, roles: ['admin'] },
      { href: '/workflows', label: 'Workflows & Alerts', icon: Workflow, roles: ['admin'] },
      { href: '/okta-activity', label: 'Okta Activity', icon: History, roles: ['admin', 'auditor'] },
      { href: '/audit', label: 'Audit Log', icon: BarChart3, roles: ['admin', 'auditor'] },
    ],
  },
  {
    section: 'Settings',
    items: [
      { href: '/settings', label: 'Settings & Theme', icon: Palette },
    ],
  },
];

export function Shell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { setPrefs } = useTheme();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    api('/api/me')
      .then((r) => {
        setPending(r.pendingReviews || 0);
        if (r.preferences) setPrefs(r.preferences, false); // preferensi tersimpan di server (lintas perangkat)
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) => (href === '/dashboard' ? pathname === '/dashboard' : href === '/reports' ? pathname === '/reports' : pathname === href || pathname.startsWith(href + '/'));

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  const sync = async () => {
    setSyncing(true);
    try {
      await api('/api/okta/sync', { method: 'POST' });
      toast('Sinkronisasi Okta dimulai — pantau di Settings › Integrations', 'success');
    } catch (e) {
      toastError(e);
    } finally {
      setSyncing(false);
    }
  };

  const initials = (user.name || user.email).split(/[\s.@]/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');

  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <Link href="/dashboard" className="brand" style={{ textDecoration: 'none' }}>
          <span className="brand-logo" />
          <span className="brand-text">
            Identity Governance
            <small>Okta integrated · IGA</small>
          </span>
        </Link>
        <nav className="nav">
          {NAV.map((sec) => {
            const items = sec.items.filter((i) => !i.roles || i.roles.includes(user.role));
            if (!items.length) return null;
            return (
              <div key={sec.section}>
                <div className="nav-section">{sec.section}</div>
                <div className="nav-section-sep" />
                {items.map((i) => (
                  <Link key={i.href} href={i.href} className={`nav-item ${isActive(i.href) ? 'active' : ''}`} title={i.label}>
                    <i.icon size={18} />
                    <span className="nav-label">{i.label}</span>
                    {i.badge === 'reviews' && pending > 0 && <span className="nav-badge">{pending}</span>}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon mobile-toggle" onClick={() => setOpen(!open)} aria-label="Menu">
            <Menu size={18} />
          </button>
          <form
            className="search"
            onSubmit={(e) => {
              e.preventDefault();
              router.push(`/identities?q=${encodeURIComponent(q)}`);
            }}
          >
            <Search size={15} />
            <input className="input" placeholder="Cari identity, login, email…" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <div className="topbar-right">
            {user.role === 'admin' && (
              <button className="btn btn-secondary btn-sm" onClick={sync} disabled={syncing} title="Sinkronisasi users, groups & apps dari Okta">
                <RefreshCw size={14} className={syncing ? 'spin' : ''} /> Sync Okta
              </button>
            )}
            <Link href="/reviews" className="btn btn-ghost btn-icon" title="Pending reviews" style={{ position: 'relative' }}>
              <Bell size={18} />
              {pending > 0 && <span className="nav-badge" style={{ position: 'absolute', top: 0, right: -4, display: 'inline' }}>{pending}</span>}
            </Link>
            <div className="user-menu">
              <button className="btn btn-ghost" onClick={() => setMenu(!menu)} style={{ paddingLeft: 6 }}>
                <span className="avatar">{initials}</span>
                <span style={{ textAlign: 'left', lineHeight: 1.2 }} className="hide-sm">
                  <span style={{ display: 'block', fontSize: 13 }}>{user.name}</span>
                  <span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>{user.role}</span>
                </span>
                <ChevronDown size={14} />
              </button>
              {menu && (
                <div className="menu" onMouseLeave={() => setMenu(false)}>
                  <div style={{ padding: '8px 10px' }}>
                    <div style={{ fontWeight: 600 }}>{user.name}</div>
                    <div className="small muted">{user.email}</div>
                  </div>
                  <Link href="/settings" className="menu-item" onClick={() => setMenu(false)}>
                    <Settings size={15} /> Settings & Theme
                  </Link>
                  <button className="menu-item" onClick={logout}>
                    <LogOut size={15} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="content">
          <UserCtx.Provider value={user}>{children}</UserCtx.Provider>
        </main>
      </div>
      <Toaster />
    </div>
  );
}
