'use client';
import { useState } from 'react';
import { fmtDateTime } from '@/lib/client';
import { Badge, DataTable, Empty, Modal } from './ui';

export const EVENT_CATEGORIES: Record<string, string> = {
  request: 'Access request',
  group: 'Group membership',
  app_access: 'App assignment',
  lifecycle: 'User lifecycle',
  auth: 'Login & MFA',
  account: 'Akun & profil',
  admin: 'Perubahan admin',
  other: 'Lainnya',
};

const CATEGORY_TONE: Record<string, string> = {
  request: 'purple', group: 'info', app_access: 'primary', lifecycle: 'warning', auth: 'neutral', account: 'neutral', admin: 'danger', other: 'neutral',
};
const OUTCOME_TONE: Record<string, string> = { SUCCESS: 'success', FAILURE: 'danger', DENY: 'danger', ALLOW: 'success', CHALLENGE: 'warning', SKIPPED: 'neutral', UNKNOWN: 'neutral' };

const who = (a: any) => (a ? a.displayName || a.alternateId || a.id : '—');

export function OktaEventsTable({ rows, compact }: { rows: any[]; compact?: boolean }) {
  const [open, setOpen] = useState<any>(null);
  const columns: any[] = [
    { key: 'published', label: 'Waktu', render: (r: any) => <span className="nowrap">{fmtDateTime(r.published)}</span> },
    { key: 'category', label: 'Kategori', render: (r: any) => <Badge tone={CATEGORY_TONE[r.category] || 'neutral'}>{EVENT_CATEGORIES[r.category] || r.category}</Badge> },
    {
      key: 'displayMessage',
      label: 'Aktivitas',
      render: (r: any) => (
        <div>
          <div className="cell-title">{r.displayMessage || r.eventType}</div>
          <div className="cell-sub mono">{r.eventType}</div>
        </div>
      ),
    },
    { key: 'actor', label: 'Actor', render: (r: any) => (<div><div className="cell-title">{who(r.actor)}</div>{r.actor?.alternateId && r.actor.alternateId !== who(r.actor) && <div className="cell-sub">{r.actor.alternateId}</div>}</div>) },
    {
      key: 'targets',
      label: 'Target',
      render: (r: any) => (
        <div className="small">
          {(r.targets || []).map((t: any, i: number) => (
            <div key={i}><span className="muted">{t.type}:</span> {who(t)}</div>
          ))}
        </div>
      ),
    },
    { key: 'outcome', label: 'Hasil', render: (r: any) => r.outcome ? <Badge tone={OUTCOME_TONE[r.outcome] || 'neutral'} title={r.outcomeReason || ''}>{r.outcome.toLowerCase()}</Badge> : '—' },
  ];
  if (!compact) columns.push({ key: 'ipAddress', label: 'IP / Lokasi', render: (r: any) => (<div className="small"><div className="mono">{r.ipAddress || '—'}</div><div className="muted">{r.location}</div></div>) });

  let raw: any = null;
  try { raw = open?.raw ? JSON.parse(open.raw) : null; } catch {}

  return (
    <>
      <DataTable rows={rows} onRowClick={setOpen} empty={<Empty title="Belum ada aktivitas" desc="Tarik log dari Okta untuk mengisi data." />} columns={columns} />
      <Modal open={!!open} title={open?.displayMessage || open?.eventType || 'Event'} onClose={() => setOpen(null)} width={760}>
        {open && (
          <>
            <dl className="kv mb">
              <dt>Waktu</dt><dd>{fmtDateTime(open.published)}</dd>
              <dt>Event type</dt><dd className="mono">{open.eventType}</dd>
              <dt>Actor</dt><dd>{who(open.actor)} {open.actor?.alternateId && <span className="muted">({open.actor.alternateId})</span>}</dd>
              <dt>Hasil</dt><dd>{open.outcome || '—'}{open.outcomeReason ? ` — ${open.outcomeReason}` : ''}</dd>
              <dt>IP / Lokasi</dt><dd>{open.ipAddress || '—'} {open.location && `· ${open.location}`}</dd>
            </dl>
            <pre className="mono small" style={{ maxHeight: 420, overflow: 'auto', background: 'var(--surface-3)', padding: 12, borderRadius: 8, margin: 0 }}>{JSON.stringify(raw, null, 2)}</pre>
          </>
        )}
      </Modal>
    </>
  );
}
