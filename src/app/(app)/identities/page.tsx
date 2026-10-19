'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download } from 'lucide-react';
import { download, fmtDate, qs, useApi, daysSince } from '@/lib/client';
import { Button, Card, DataTable, ErrorBox, Loading, PageHeader, Pagination, RiskBadge, StatusBadge, TypeBadge, toastError } from '@/components/ui';

function IdentitiesInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [f, setF] = useState({
    q: sp.get('q') || '',
    type: sp.get('type') || '',
    status: sp.get('status') || '',
    lifecycle: sp.get('lifecycle') || '',
    riskLevel: sp.get('riskLevel') || '',
    department: sp.get('department') || '',
    dormant: sp.get('dormant') || '',
  });
  const [page, setPage] = useState(1);
  const { data, loading, error } = useApi<any>(`/api/identities?${qs({ ...f, page, limit: 25 })}`, []);
  const set = (k: string, v: string) => {
    setF({ ...f, [k]: v });
    setPage(1);
  };

  const exportAll = (format: string) =>
    download('/api/reports/export', {
      def: {
        name: 'Identities',
        dataset: 'identities',
        sortBy: 'riskScore',
        sortDir: 'desc',
        filters: [
          f.type === 'non_human' ? { field: 'category', op: 'eq', value: 'Non-Human' } : f.type ? { field: 'identityType', op: 'eq', value: f.type } : null,
          f.department && { field: 'department', op: 'eq', value: f.department },
          f.lifecycle && { field: 'lifecycle', op: 'eq', value: f.lifecycle },
          f.riskLevel && { field: 'riskLevel', op: 'eq', value: f.riskLevel },
          f.status && { field: 'status', op: 'eq', value: f.status },
        ].filter(Boolean),
      },
      format,
    }).catch(toastError);

  return (
    <>
      <PageHeader
        title="Identities"
        subtitle="Semua identitas dari Okta — human & non-human (service account, bot, API) dengan risk score."
        actions={['csv', 'xlsx', 'pdf'].map((x) => (
          <Button key={x} size="sm" icon={<Download size={13} />} onClick={() => exportAll(x)}>{x.toUpperCase()}</Button>
        ))}
      />
      <Card flush>
        <div style={{ padding: '14px 14px 0' }}>
          <div className="filters">
            <input className="input grow" placeholder="Cari nama, login, email, title…" value={f.q} onChange={(e) => set('q', e.target.value)} />
            <select className="select" value={f.type} onChange={(e) => set('type', e.target.value)}>
              <option value="">Semua tipe</option>
              <option value="human">Human</option>
              <option value="non_human">Non-human (semua)</option>
              <option value="service">Service account</option>
              <option value="bot">Bot</option>
              <option value="api">API</option>
            </select>
            <select className="select" value={f.department} onChange={(e) => set('department', e.target.value)}>
              <option value="">Semua department</option>
              {data?.departments?.map((d: string) => <option key={d}>{d}</option>)}
            </select>
            <select className="select" value={f.lifecycle} onChange={(e) => set('lifecycle', e.target.value)}>
              <option value="">Lifecycle</option>
              {['joiner', 'active', 'mover', 'leaver', 'inactive'].map((l) => <option key={l}>{l}</option>)}
            </select>
            <select className="select" value={f.riskLevel} onChange={(e) => set('riskLevel', e.target.value)}>
              <option value="">Risk level</option>
              {['critical', 'high', 'medium', 'low'].map((l) => <option key={l}>{l}</option>)}
            </select>
            <select className="select" value={f.status} onChange={(e) => set('status', e.target.value)}>
              <option value="">Okta status</option>
              {['ACTIVE', 'SUSPENDED', 'DEPROVISIONED', 'STAGED', 'PROVISIONED', 'LOCKED_OUT'].map((l) => <option key={l}>{l}</option>)}
            </select>
            <label className="check small"><input type="checkbox" checked={f.dormant === '1'} onChange={(e) => set('dormant', e.target.checked ? '1' : '')} /> Dormant 90d</label>
          </div>
        </div>
        {error && <div style={{ padding: 14 }}><ErrorBox error={error} /></div>}
        {loading && !data ? (
          <Loading />
        ) : (
          <>
            <DataTable
              rows={data?.items || []}
              onRowClick={(r: any) => router.push(`/identities/${r._id}`)}
              columns={[
                { key: 'displayName', label: 'Identity', render: (r: any) => (<div><div className="cell-title">{r.displayName}</div><div className="cell-sub">{r.login}</div></div>) },
                { key: 'identityType', label: 'Type', render: (r: any) => <TypeBadge type={r.identityType} /> },
                { key: 'department', label: 'Department', render: (r: any) => (<div>{r.department || '—'}<div className="cell-sub">{r.title}</div></div>) },
                { key: 'manager', label: 'Manager / Owner' },
                { key: 'status', label: 'Status', render: (r: any) => <StatusBadge status={r.status} /> },
                { key: 'lifecycle', label: 'Lifecycle', render: (r: any) => <StatusBadge status={r.lifecycle} /> },
                { key: 'entitlementCount', label: 'Access' },
                { key: 'lastLogin', label: 'Last login', render: (r: any) => (<span title={fmtDate(r.lastLogin)}>{r.lastLogin ? `${daysSince(r.lastLogin)} hari lalu` : 'never'}</span>) },
                { key: 'riskScore', label: 'Risk', render: (r: any) => (<span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><b>{r.riskScore}</b><RiskBadge level={r.riskLevel} /></span>) },
              ]}
            />
            <Pagination page={page} total={data?.total || 0} limit={25} onChange={setPage} />
          </>
        )}
      </Card>
    </>
  );
}

export default function IdentitiesPage() {
  return (
    <Suspense>
      <IdentitiesInner />
    </Suspense>
  );
}
