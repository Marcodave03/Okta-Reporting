'use client';
import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { api, qs, useApi } from '@/lib/client';
import { Badge, Button, Card, DataTable, Field, Loading, Modal, PageHeader, RiskBadge, StatusBadge, Switch, Tabs, toast, toastError } from '@/components/ui';
import { useIsAdmin } from '@/components/UserContext';

export default function ApplicationsPage() {
  const admin = useIsAdmin();
  const [tab, setTab] = useState('apps');
  const [filter, setFilter] = useState({ q: '', applicationId: '', riskLevel: '', privileged: '' });
  const apps = useApi<any>('/api/applications');
  const ents = useApi<any>(`/api/entitlements?${qs(filter)}`);
  const [edit, setEdit] = useState<{ type: 'app' | 'ent'; row: any } | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!edit) return;
    setSaving(true);
    try {
      const { row, type } = edit;
      await api(`/api/${type === 'app' ? 'applications' : 'entitlements'}/${row._id}`, { method: 'PATCH', body: { owner: row.owner, riskLevel: row.riskLevel, privileged: row.privileged, description: row.description } });
      toast('Tersimpan', 'success');
      setEdit(null);
      type === 'app' ? apps.reload() : ents.reload();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="Applications & Entitlements" subtitle="Aplikasi Okta, group, dan app assignment. Tetapkan owner & tingkat risiko untuk reviewer app_owner / entitlement_owner." />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'apps', label: 'Applications', count: apps.data?.items?.length }, { key: 'ents', label: 'Entitlements', count: ents.data?.items?.length }]} />
      {tab === 'apps' && (
        <Card flush>
          {apps.loading ? <Loading /> : (
            <DataTable
              rows={apps.data?.items || []}
              columns={[
                { key: 'label', label: 'Application', render: (r: any) => (<div><div className="cell-title">{r.label}</div><div className="cell-sub">{r.name} · {r.signOnMode}</div></div>) },
                { key: 'status', label: 'Status', render: (r: any) => <StatusBadge status={r.status} /> },
                { key: 'owner', label: 'Owner', render: (r: any) => r.owner || <span className="muted">— belum diset</span> },
                { key: 'riskLevel', label: 'Risk', render: (r: any) => <RiskBadge level={r.riskLevel} /> },
                { key: 'entitlements', label: 'Entitlements' },
                { key: 'assignments', label: 'Assignments' },
                { key: 'act', label: '', render: (r: any) => admin && <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setEdit({ type: 'app', row: { ...r } })} /> },
              ]}
            />
          )}
        </Card>
      )}
      {tab === 'ents' && (
        <Card flush>
          <div style={{ padding: '14px 14px 0' }}>
            <div className="filters">
              <input className="input grow" placeholder="Cari entitlement…" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
              <select className="select" value={filter.applicationId} onChange={(e) => setFilter({ ...filter, applicationId: e.target.value })}>
                <option value="">Semua aplikasi</option>
                {apps.data?.items?.map((a: any) => <option key={a._id} value={a._id}>{a.label}</option>)}
              </select>
              <select className="select" value={filter.riskLevel} onChange={(e) => setFilter({ ...filter, riskLevel: e.target.value })}>
                <option value="">Risk level</option>
                {['critical', 'high', 'medium', 'low'].map((l) => <option key={l}>{l}</option>)}
              </select>
              <label className="check small"><input type="checkbox" checked={filter.privileged === '1'} onChange={(e) => setFilter({ ...filter, privileged: e.target.checked ? '1' : '' })} /> Privileged saja</label>
            </div>
          </div>
          {ents.loading && !ents.data ? <Loading /> : (
            <DataTable
              rows={ents.data?.items || []}
              columns={[
                { key: 'name', label: 'Entitlement', render: (r: any) => (<div><div className="cell-title">{r.name}</div><div className="cell-sub">{r.application || 'Directory group'}</div></div>) },
                { key: 'kind', label: 'Type', render: (r: any) => <Badge tone={r.kind === 'app' ? 'info' : 'neutral'}>{r.kind}</Badge> },
                { key: 'riskLevel', label: 'Risk', render: (r: any) => (<span className="row" style={{ gap: 4 }}><RiskBadge level={r.riskLevel} />{r.privileged && <Badge tone="purple">privileged</Badge>}</span>) },
                { key: 'owner', label: 'Owner' },
                { key: 'holders', label: 'Holders' },
                { key: 'unused', label: 'Unused 90d', render: (r: any) => (r.unused ? <Badge tone="warning">{r.unused}</Badge> : 0) },
                { key: 'act', label: '', render: (r: any) => admin && <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setEdit({ type: 'ent', row: { ...r } })} /> },
              ]}
            />
          )}
        </Card>
      )}
      <Modal
        open={!!edit}
        title={`Edit ${edit?.type === 'app' ? 'application' : 'entitlement'}: ${edit?.row?.label || edit?.row?.name || ''}`}
        onClose={() => setEdit(null)}
        footer={<><Button onClick={() => setEdit(null)}>Batal</Button><Button variant="primary" loading={saving} onClick={save}>Simpan</Button></>}
      >
        {edit && (
          <>
            <Field label="Owner (email)" hint="Dipakai sebagai reviewer bila hierarki memuat app_owner / entitlement_owner">
              <input className="input" value={edit.row.owner || ''} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, owner: e.target.value } })} />
            </Field>
            <Field label="Risk level">
              <select className="select" value={edit.row.riskLevel} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, riskLevel: e.target.value } })}>
                {['low', 'medium', 'high', 'critical'].map((l) => <option key={l}>{l}</option>)}
              </select>
            </Field>
            {edit.type === 'ent' && (
              <div className="row"><Switch checked={!!edit.row.privileged} onChange={(v) => setEdit({ ...edit, row: { ...edit.row, privileged: v } })} /> Privileged access</div>
            )}
            <Field label="Deskripsi">
              <textarea className="textarea" value={edit.row.description || ''} onChange={(e) => setEdit({ ...edit, row: { ...edit.row, description: e.target.value } })} />
            </Field>
          </>
        )}
      </Modal>
    </>
  );
}
