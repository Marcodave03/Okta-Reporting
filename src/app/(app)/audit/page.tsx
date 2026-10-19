'use client';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { download, fmtDateTime, qs, useApi } from '@/lib/client';
import { Button, Card, DataTable, Loading, PageHeader, Pagination, toastError } from '@/components/ui';

export default function AuditPage() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading } = useApi<any>(`/api/audit?${qs({ q, page })}`);
  return (
    <>
      <PageHeader
        title="Audit Log"
        subtitle="Jejak semua aktivitas: login, keputusan review, perubahan policy, sync Okta, export report."
        actions={['csv', 'xlsx', 'pdf'].map((f) => <Button key={f} size="sm" icon={<Download size={13} />} onClick={() => download('/api/reports/export', { def: { name: 'Audit Log', dataset: 'audit' }, format: f }).catch(toastError)}>{f.toUpperCase()}</Button>)}
      />
      <Card flush>
        <div style={{ padding: '14px 14px 0' }}>
          <div className="filters"><input className="input grow" placeholder="Cari actor, action, target…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        </div>
        {loading && !data ? <Loading /> : (
          <>
            <DataTable
              rows={data?.items || []}
              columns={[
                { key: 'at', label: 'Waktu', render: (r: any) => <span className="nowrap">{fmtDateTime(r.at)}</span> },
                { key: 'actor', label: 'Actor' },
                { key: 'action', label: 'Action', render: (r: any) => <code>{r.action}</code> },
                { key: 'target', label: 'Target' },
                { key: 'details', label: 'Detail', render: (r: any) => <span className="mono small truncate" style={{ maxWidth: 380, display: 'inline-block' }} title={JSON.stringify(r.details)}>{r.details && Object.keys(r.details).length ? JSON.stringify(r.details) : ''}</span> },
              ]}
            />
            <Pagination page={page} total={data?.total || 0} limit={50} onChange={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
