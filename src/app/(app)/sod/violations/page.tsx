'use client';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Download } from 'lucide-react';
import { api, download, fmtDate, qs, useApi } from '@/lib/client';
import { Badge, Button, Card, DataTable, Field, Loading, Modal, PageHeader, RiskBadge, StatusBadge, TypeBadge, toast, toastError } from '@/components/ui';
import { useIsAdmin } from '@/components/UserContext';

function ViolationsInner() {
  const admin = useIsAdmin();
  const sp = useSearchParams();
  const [f, setF] = useState({ status: sp.get('status') ?? 'open', severity: sp.get('severity') || '', q: '' });
  const { data, loading, reload } = useApi<any>(`/api/sod/violations?${qs(f)}`);
  const [dlg, setDlg] = useState<any>(null);

  const submit = async () => {
    try {
      await api(`/api/sod/violations/${dlg.v._id}`, { method: 'PATCH', body: { status: dlg.status, note: dlg.note } });
      toast('Status pelanggaran diperbarui', 'success');
      setDlg(null);
      reload();
    } catch (e) { toastError(e); }
  };
  const exp = (format: string) => download('/api/reports/export', { def: { name: 'SoD Violations', dataset: 'sod_violations', filters: [f.status && { field: 'status', op: 'eq', value: f.status }, f.severity && { field: 'severity', op: 'eq', value: f.severity }].filter(Boolean) }, format }).catch(toastError);

  return (
    <>
      <PageHeader title="SoD Violations" subtitle="Identitas yang memegang kombinasi akses yang bertentangan. Mitigasi, terima risiko, atau revoke lewat campaign." actions={['csv', 'xlsx', 'pdf'].map((x) => <Button key={x} size="sm" icon={<Download size={13} />} onClick={() => exp(x)}>{x.toUpperCase()}</Button>)} />
      <Card flush>
        <div style={{ padding: '14px 14px 0' }}>
          <div className="filters">
            <input className="input grow" placeholder="Cari identity / department…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
            <select className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="">Semua status</option>
              {['open', 'mitigated', 'accepted', 'remediated'].map((s) => <option key={s}>{s}</option>)}
            </select>
            <select className="select" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>
              <option value="">Semua severity</option>
              {['critical', 'high', 'medium', 'low'].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
        {loading && !data ? <Loading /> : (
          <DataTable
            rows={data?.items || []}
            empty={<div className="empty">✅ Tidak ada pelanggaran dengan filter ini</div>}
            columns={[
              { key: 'identity', label: 'Identity', render: (v: any) => (<div><Link className="cell-title" href={`/identities/${v.identityId?._id}`}>{v.identityId?.displayName}</Link><div className="cell-sub row" style={{ gap: 4 }}>{v.identityId?.department}{v.identityId?.identityType !== 'human' && <TypeBadge type={v.identityId?.identityType} />}</div></div>) },
              { key: 'policy', label: 'Policy', render: (v: any) => (<div><div>{v.policyId?.name}</div><div className="cell-sub">{v.policyId?.category}</div></div>) },
              { key: 'conflict', label: 'Konflik akses', render: (v: any) => (<div className="small" style={{ maxWidth: 340 }}><span>{v.matchedA.map((e: any) => e.name).join(', ')}</span> <b style={{ color: 'var(--danger)' }}>⇄</b> <span>{v.matchedB.map((e: any) => e.name).join(', ')}</span></div>) },
              { key: 'severity', label: 'Severity', render: (v: any) => <RiskBadge level={v.severity} /> },
              { key: 'risk', label: 'Risk score', render: (v: any) => <b>{v.identityId?.riskScore}</b> },
              { key: 'status', label: 'Status', render: (v: any) => (<div><StatusBadge status={v.status} />{v.note && <div className="cell-sub truncate" style={{ maxWidth: 160 }} title={v.note}>{v.note}</div>}</div>) },
              { key: 'detectedAt', label: 'Detected', render: (v: any) => fmtDate(v.detectedAt) },
              {
                key: 'act', label: '', render: (v: any) => admin && v.status !== 'remediated' && (
                  <select className="select" style={{ width: 120, height: 28 }} value="" onChange={(e) => e.target.value && setDlg({ v, status: e.target.value, note: v.note || '' })}>
                    <option value="">Aksi…</option>
                    {v.status !== 'mitigated' && <option value="mitigated">Mitigate</option>}
                    {v.status !== 'accepted' && <option value="accepted">Accept risk</option>}
                    {v.status !== 'open' && <option value="open">Re-open</option>}
                    <option value="remediated">Mark remediated</option>
                  </select>
                ),
              },
            ]}
          />
        )}
      </Card>
      <Modal open={!!dlg} title={`Ubah status → ${dlg?.status}`} onClose={() => setDlg(null)} footer={<><Button onClick={() => setDlg(null)}>Batal</Button><Button variant="primary" onClick={submit}>Simpan</Button></>}>
        {dlg && (
          <>
            <div className="small"><b>{dlg.v.identityId?.displayName}</b> — {dlg.v.policyId?.name}</div>
            {dlg.v.policyId?.mitigation && <div className="callout info small">Saran mitigasi: {dlg.v.policyId.mitigation}</div>}
            <Field label={['mitigated', 'accepted'].includes(dlg.status) ? 'Justifikasi / compensating control (wajib)' : 'Catatan'}>
              <textarea className="textarea" value={dlg.note} onChange={(e) => setDlg({ ...dlg, note: e.target.value })} />
            </Field>
            {dlg.status === 'remediated' && <div className="small muted">Catatan: SoD scan berikutnya akan membuka kembali pelanggaran bila akses konflik masih ada.</div>}
          </>
        )}
      </Modal>
    </>
  );
}

export default function ViolationsPage() {
  return <Suspense><ViolationsInner /></Suspense>;
}
