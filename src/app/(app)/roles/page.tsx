'use client';
import { useState } from 'react';
import { Check, Pickaxe, Plus, Trash2, X } from 'lucide-react';
import { api, useApi } from '@/lib/client';
import { Badge, Button, Card, CheckList, DataTable, Field, Loading, Modal, PageHeader, Progress, StatusBadge, Switch, Tabs, toast, toastError } from '@/components/ui';
import { useIsAdmin } from '@/components/UserContext';

const ATTRS = [['department', 'Department'], ['title', 'Job title'], ['location', 'Location'], ['employeeType', 'Employee type']];

export default function RolesPage() {
  const admin = useIsAdmin();
  const [tab, setTab] = useState('candidate');
  const roles = useApi<any>('/api/roles');
  const opt = useApi<any>(tab === 'optimize' ? '/api/roles/optimize' : null, [tab]);
  const ents = useApi<any>('/api/entitlements');
  const [p, setP] = useState({ method: 'attribute', groupBy: ['department', 'title'], minSupport: 0.7, minMembers: 3, similarity: 0.75, useUsage: true, unusedDays: 90 });
  const [mining, setMining] = useState(false);
  const [manual, setManual] = useState<any>(null);

  const mine = async () => {
    setMining(true);
    try {
      const r = await api('/api/roles/mine', { body: p });
      toast(`${r.candidates} kandidat role ditemukan dari ${r.analyzedIdentities} identitas`, 'success');
      setTab('candidate');
      roles.reload();
    } catch (e) { toastError(e); } finally { setMining(false); }
  };
  const update = async (id: string, body: any, msg: string) => {
    try { await api(`/api/roles/${id}`, { method: 'PATCH', body }); toast(msg, 'success'); roles.reload(); opt.reload(); } catch (e) { toastError(e); }
  };
  const remove = async (id: string) => {
    await api(`/api/roles/${id}`, { method: 'DELETE' });
    roles.reload();
    opt.reload();
  };
  const createManual = async () => {
    try { await api('/api/roles', { body: manual }); toast('Role dibuat', 'success'); setManual(null); roles.reload(); } catch (e) { toastError(e); }
  };

  const list = (roles.data?.items || []).filter((r: any) => r.status === tab);
  return (
    <>
      <PageHeader
        title="Role Mining & Optimization"
        subtitle="Automated role discovery dari atribut user + data penggunaan entitlement (Okta System Log), lalu optimasi katalog role."
        actions={admin && <Button icon={<Plus size={14} />} onClick={() => setManual({ name: '', description: '', entitlementIds: [] })}>Manual role</Button>}
      />
      {admin && (
        <Card title="Parameter mining" className="mb" actions={<Button variant="primary" icon={<Pickaxe size={14} />} loading={mining} onClick={mine}>Run role mining</Button>}>
          <div className="grid grid-4">
            <Field label="Metode">
              <select className="select" value={p.method} onChange={(e) => setP({ ...p, method: e.target.value })}>
                <option value="attribute">Attribute-based (top-down)</option>
                <option value="cluster">Entitlement clustering (bottom-up)</option>
              </select>
            </Field>
            {p.method === 'attribute' ? (
              <Field label="Kelompokkan berdasarkan atribut">
                <div className="row">{ATTRS.map(([k, l]) => <label key={k} className="check small"><input type="checkbox" checked={p.groupBy.includes(k)} onChange={(e) => setP({ ...p, groupBy: e.target.checked ? [...p.groupBy, k] : p.groupBy.filter((x) => x !== k) })} />{l}</label>)}</div>
              </Field>
            ) : (
              <Field label={`Jaccard similarity ≥ ${p.similarity}`}><input type="range" min={0.4} max={1} step={0.05} value={p.similarity} onChange={(e) => setP({ ...p, similarity: Number(e.target.value) })} /></Field>
            )}
            <Field label={`Min. support ${Math.round(p.minSupport * 100)}%`} hint="Porsi anggota grup yang harus memiliki entitlement"><input type="range" min={0.4} max={1} step={0.05} value={p.minSupport} onChange={(e) => setP({ ...p, minSupport: Number(e.target.value) })} /></Field>
            <Field label="Min. anggota"><input className="input" type="number" min={2} value={p.minMembers} onChange={(e) => setP({ ...p, minMembers: Number(e.target.value) })} /></Field>
          </div>
          <div className="row mt"><Switch checked={p.useUsage} onChange={(v) => setP({ ...p, useUsage: v })} /> Gunakan usage data — abaikan entitlement yang tidak dipakai &gt; <input className="input" type="number" style={{ width: 70 }} value={p.unusedDays} onChange={(e) => setP({ ...p, unusedDays: Number(e.target.value) })} /> hari</div>
        </Card>
      )}

      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'candidate', label: 'Candidate roles', count: (roles.data?.items || []).filter((r: any) => r.status === 'candidate').length },
        { key: 'active', label: 'Active roles', count: (roles.data?.items || []).filter((r: any) => r.status === 'active').length },
        { key: 'deprecated', label: 'Deprecated' },
        { key: 'optimize', label: 'Optimization' },
      ]} />

      {tab !== 'optimize' && (
        <Card flush>
          {roles.loading ? <Loading /> : (
            <DataTable
              rows={list}
              empty={<div className="empty">Tidak ada role. Jalankan role mining.</div>}
              columns={[
                { key: 'name', label: 'Role', render: (r: any) => (<div><div className="cell-title">{r.name}</div><div className="cell-sub">{r.source} · {r.method || 'manual'}</div></div>) },
                { key: 'ents', label: 'Entitlements', render: (r: any) => (<div className="chip-list" style={{ maxWidth: 420 }}>{r.entitlementIds.map((e: any) => <span key={e._id} className="chip" style={r.unusedEntitlementIds?.some((u: any) => u._id === e._id) ? { background: 'var(--warning-soft)' } : undefined} title={r.unusedEntitlementIds?.some((u: any) => u._id === e._id) ? 'Mayoritas anggota tidak memakai entitlement ini' : ''}>{e.name}</span>)}</div>) },
                { key: 'members', label: 'Members' },
                { key: 'confidence', label: 'Confidence', width: 140, render: (r: any) => (<div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><Progress value={(r.confidence || 0) * 100} /><span className="small">{Math.round((r.confidence || 0) * 100)}%</span></div>) },
                { key: 'status', label: 'Status', render: (r: any) => <StatusBadge status={r.status} /> },
                {
                  key: 'act', label: '', render: (r: any) => admin && (
                    <div className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
                      {r.status === 'candidate' && <Button size="sm" variant="success" icon={<Check size={13} />} title="Approve jadi active role" onClick={() => update(r._id, { status: 'active' }, 'Role diaktifkan')} />}
                      {r.status === 'active' && <Button size="sm" title="Deprecate" icon={<X size={13} />} onClick={() => update(r._id, { status: 'deprecated' }, 'Role di-deprecate')} />}
                      <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => remove(r._id)} />
                    </div>
                  ),
                },
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'optimize' && (opt.loading || !opt.data ? <Loading /> : (
        <div className="stack">
          <div className="grid grid-4">
            <div className="card kpi"><div className="kpi-label">Roles</div><div className="kpi-value">{opt.data.summary.roles}</div><div className="kpi-hint">{opt.data.summary.activeRoles} active · {opt.data.summary.candidateRoles} candidate</div></div>
            <div className="card kpi"><div className="kpi-label">Role coverage</div><div className="kpi-value">{opt.data.summary.roleCoverage}%</div><div className="kpi-hint">assignment tercakup active role</div></div>
            <div className="card kpi"><div className="kpi-label">Access di luar role</div><div className="kpi-value">{opt.data.summary.excessAssignments}</div><div className="kpi-hint">kandidat birthright / exception</div></div>
            <div className="card kpi"><div className="kpi-label">Rekomendasi</div><div className="kpi-value">{opt.data.recommendations.length}</div></div>
          </div>
          <Card title="Rekomendasi optimasi" flush>
            <DataTable
              rows={opt.data.recommendations.map((r: any, i: number) => ({ ...r, _id: String(i) }))}
              empty={<div className="empty">✅ Katalog role sudah optimal</div>}
              columns={[
                { key: 'type', label: 'Tipe', render: (r: any) => <Badge tone={r.type === 'duplicate' ? 'danger' : r.type === 'merge' ? 'warning' : r.type === 'remove_entitlement' ? 'purple' : 'info'}>{r.type.replace('_', ' ')}</Badge> },
                { key: 'roles', label: 'Role', render: (r: any) => r.roles.join(' ↔ ') },
                { key: 'message', label: 'Rekomendasi' },
                {
                  key: 'act', label: '', render: (r: any) => admin && (
                    r.type === 'remove_entitlement' ? <Button size="sm" onClick={() => update(r.roleIds[0], { removeEntitlementId: r.entitlementId }, 'Entitlement dihapus dari role')}>Terapkan</Button>
                      : r.type === 'duplicate' ? <Button size="sm" onClick={() => remove(r.roleIds[1])}>Hapus duplikat</Button>
                        : r.type === 'retire' ? <Button size="sm" onClick={() => update(r.roleIds[0], { status: 'deprecated' }, 'Role di-retire')}>Retire</Button> : null
                  ),
                },
              ]}
            />
          </Card>
        </div>
      ))}

      <Modal open={!!manual} title="Manual role" onClose={() => setManual(null)} footer={<><Button onClick={() => setManual(null)}>Batal</Button><Button variant="primary" onClick={createManual}>Buat role</Button></>}>
        {manual && (
          <>
            <Field label="Nama"><input className="input" value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} /></Field>
            <Field label="Deskripsi"><input className="input" value={manual.description} onChange={(e) => setManual({ ...manual, description: e.target.value })} /></Field>
            <Field label="Entitlements"><CheckList options={(ents.data?.items || []).map((e: any) => ({ value: e._id, label: e.name, sub: e.application }))} value={manual.entitlementIds} onChange={(v) => setManual({ ...manual, entitlementIds: v })} /></Field>
          </>
        )}
      </Modal>
    </>
  );
}
