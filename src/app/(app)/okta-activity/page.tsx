'use client';
import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { api, download, fmtDateTime, qs, useApi } from '@/lib/client';
import { Button, Card, ErrorBox, Loading, PageHeader, Pagination, toast, toastError } from '@/components/ui';
import { EVENT_CATEGORIES, OktaEventsTable } from '@/components/OktaEvents';
import { useIsAdmin } from '@/components/UserContext';

export default function OktaActivityPage() {
  const isAdmin = useIsAdmin();
  const [f, setF] = useState({ q: '', category: '', outcome: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const set = (k: string, v: string) => { setF({ ...f, [k]: v }); setPage(1); };
  const { data, loading, error, reload } = useApi<any>(`/api/okta/events?${qs({ ...f, page })}`);
  const running = !!data?.state?.running;

  // selama penarikan berjalan, refresh tiap 3 detik
  useEffect(() => {
    if (!running) return;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [running, reload]);

  const pull = async () => {
    try {
      await api('/api/okta/events', { method: 'POST' });
      toast('Menarik log dari Okta…', 'success');
      reload();
    } catch (e) { toastError(e); }
  };

  // export memakai dataset report 'okta_events' dengan filter yang sedang aktif
  const exportAs = (format: string) => {
    const filters = [
      f.category && { field: 'category', op: 'eq', value: EVENT_CATEGORIES[f.category] },
      f.outcome && { field: 'outcome', op: 'eq', value: f.outcome },
      f.from && { field: 'published', op: 'gt', value: `${f.from}T00:00:00` },
      f.to && { field: 'published', op: 'lt', value: `${f.to}T23:59:59` },
      f.q && { field: 'displayMessage', op: 'contains', value: f.q },
    ].filter(Boolean);
    download('/api/reports/export', { def: { name: 'Okta Activity', dataset: 'okta_events', filters }, format }).catch(toastError);
  };

  const cats = data?.categories || {};
  return (
    <>
      <PageHeader
        title="Okta Activity"
        subtitle="Semua event System Log Okta: access request, perubahan group & app, lifecycle user, login/MFA, dan perubahan admin. Disimpan permanen (Okta sendiri hanya menyimpan ±90 hari)."
        actions={<>
          {['csv', 'xlsx', 'pdf'].map((fmt) => <Button key={fmt} size="sm" icon={<Download size={13} />} onClick={() => exportAs(fmt)}>{fmt.toUpperCase()}</Button>)}
          {isAdmin && <Button size="sm" variant="primary" icon={<RefreshCw size={13} className={running ? 'spin' : ''} />} onClick={pull} disabled={running}>{running ? `Menarik… (${data?.state?.fetched || 0})` : 'Tarik log dari Okta'}</Button>}
        </>}
      />
      {data?.state?.error && !running && <div className="callout danger small mb">Penarikan terakhir gagal: {data.state.error}</div>}
      {data?.last && <div className="small muted mb">Terakhir ditarik: {fmtDateTime(data.last.at)} — {data.last.fetched} event baru diproses. Otomatis ikut setiap Okta sync.</div>}
      <Card flush>
        <div style={{ padding: '14px 14px 0' }}>
          <div className="filters">
            <input className="input grow" placeholder="Cari user, aktivitas, event type, IP…" value={f.q} onChange={(e) => set('q', e.target.value)} />
            <select className="select" value={f.category} onChange={(e) => set('category', e.target.value)}>
              <option value="">Semua kategori</option>
              {Object.entries(EVENT_CATEGORIES).map(([k, label]) => <option key={k} value={k}>{label}{cats[k] ? ` (${cats[k]})` : ''}</option>)}
            </select>
            <select className="select" value={f.outcome} onChange={(e) => set('outcome', e.target.value)}>
              <option value="">Semua hasil</option>
              {['SUCCESS', 'FAILURE', 'DENY', 'ALLOW', 'CHALLENGE', 'SKIPPED'].map((o) => <option key={o} value={o}>{o.toLowerCase()}</option>)}
            </select>
            <input className="input" type="date" value={f.from} onChange={(e) => set('from', e.target.value)} title="Dari tanggal" />
            <input className="input" type="date" value={f.to} onChange={(e) => set('to', e.target.value)} title="Sampai tanggal" />
          </div>
        </div>
        {error ? <ErrorBox error={error} /> : loading && !data ? <Loading /> : (
          <>
            <OktaEventsTable rows={data?.items || []} />
            <Pagination page={page} total={data?.total || 0} limit={50} onChange={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
