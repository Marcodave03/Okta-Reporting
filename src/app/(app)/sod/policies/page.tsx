'use client';
import { useState } from 'react';
import { Copy, Download, Pencil, Play, Plus, Search, Trash2 } from 'lucide-react';
import { api, useApi } from '@/lib/client';
import { Badge, Button, Card, CheckList, DataTable, Field, Loading, Modal, PageHeader, RiskBadge, Switch, Tabs, TagInput, useConfirm, toast, toastError } from '@/components/ui';
import { useIsAdmin } from '@/components/UserContext';

const EMPTY = { name: '', description: '', category: 'Custom', severity: 'high', mitigation: '', sideA: { label: '', entitlementIds: [], patterns: [] }, sideB: { label: '', entitlementIds: [], patterns: [] } };

export default function SodPoliciesPage() {
  const admin = useIsAdmin();
  const [tab, setTab] = useState('policies');
  const policies = useApi<any>('/api/sod/policies');
  const templates = useApi<any>('/api/sod/templates');
  const ents = useApi<any>('/api/entitlements');
  const [edit, setEdit] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [scanning, setScanning] = useState(false);
  const { confirm, dialog } = useConfirm();

  const reloadAll = () => { policies.reload(); templates.reload(); };
  const scan = async () => {
    setScanning(true);
    try {
      const r = await api('/api/sod/scan', { method: 'POST' });
      toast(`Scan selesai: ${r.violationsFound} pelanggaran (${r.newViolations} baru, ${r.autoResolved} auto-resolved)`, 'success');
      policies.reload();
    } catch (e) { toastError(e); } finally { setScanning(false); }
  };
  const install = async (key: string, mode: 'predefined' | 'custom') => {
    try {
      const p = await api('/api/sod/templates', { body: { key, mode } });
      toast(mode === 'custom' ? 'Template di-clone menjadi custom policy — silakan edit' : 'Predefined policy diaktifkan', 'success');
      reloadAll();
      if (mode === 'custom') openEdit(p);
    } catch (e) { toastError(e); }
  };
  const openEdit = (p: any) => {
    setPreview(null);
    setEdit({
      ...p,
      sideA: { label: p.sideA?.label || '', patterns: p.sideA?.patterns || [], entitlementIds: (p.sideA?.entitlementIds || []).map((e: any) => e._id || e) },
      sideB: { label: p.sideB?.label || '', patterns: p.sideB?.patterns || [], entitlementIds: (p.sideB?.entitlementIds || []).map((e: any) => e._id || e) },
    });
  };
  const save = async () => {
    try {
      if (edit._id) await api(`/api/sod/policies/${edit._id}`, { method: 'PATCH', body: edit });
      else await api('/api/sod/policies', { body: edit });
      toast('Policy disimpan — jalankan scan untuk memperbarui pelanggaran', 'success');
      setEdit(null);
      reloadAll();
    } catch (e) { toastError(e); }
  };
  const toggle = async (p: any, enabled: boolean) => {
    try { await api(`/api/sod/policies/${p._id}`, { method: 'PATCH', body: { enabled } }); policies.reload(); } catch (e) { toastError(e); }
  };
  const remove = async (p: any) => {
    if (!(await confirm('Hapus policy?', `"${p.name}" dan seluruh pelanggarannya akan dihapus.`, true))) return;
    await api(`/api/sod/policies/${p._id}`, { method: 'DELETE' });
    reloadAll();
  };
  const runPreview = async () => {
    try { setPreview(await api('/api/sod/preview', { body: { sideA: edit.sideA, sideB: edit.sideB } })); } catch (e) { toastError(e); }
  };
  const entOptions = (ents.data?.items || []).map((e: any) => ({ value: e._id, label: e.name, sub: e.application }));

  return (
    <>
      {dialog}
      <PageHeader
        title="Separation of Duties Policies"
        subtitle="Mulai dari library predefined, lalu clone & sesuaikan menjadi custom SoD policy untuk organisasi Anda."
        actions={admin && <><Button icon={<Play size={14} />} loading={scanning} onClick={scan}>Run SoD scan</Button><Button variant="primary" icon={<Plus size={14} />} onClick={() => openEdit(EMPTY)}>Custom policy</Button></>}
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'policies', label: 'Active policies', count: policies.data?.items?.length }, { key: 'library', label: 'Predefined library', count: templates.data?.items?.length }]} />

      {tab === 'policies' && (
        <Card flush>
          {policies.loading ? <Loading /> : (
            <DataTable
              rows={policies.data?.items || []}
              empty={<div className="empty"><h4>Belum ada policy</h4>Install dari tab Predefined library.</div>}
              columns={[
                { key: 'name', label: 'Policy', render: (p: any) => (<div><div className="cell-title">{p.name}</div><div className="cell-sub">{p.category}</div></div>) },
                { key: 'type', label: 'Type', render: (p: any) => <Badge tone={p.isPredefined ? 'info' : 'purple'}>{p.isPredefined ? 'predefined' : 'custom'}</Badge> },
                { key: 'rule', label: 'Rule (A ⇄ B)', render: (p: any) => (<div className="small"><b>{p.sideA?.label || 'A'}</b> ⇄ <b>{p.sideB?.label || 'B'}</b><div className="cell-sub">{[...(p.sideA?.patterns || []), ...(p.sideA?.entitlementIds || []).map((e: any) => e.name)].slice(0, 2).join(', ')} ⇄ {[...(p.sideB?.patterns || []), ...(p.sideB?.entitlementIds || []).map((e: any) => e.name)].slice(0, 2).join(', ')}</div></div>) },
                { key: 'severity', label: 'Severity', render: (p: any) => <RiskBadge level={p.severity} /> },
                { key: 'openViolations', label: 'Open', render: (p: any) => (p.openViolations ? <Badge tone="danger">{p.openViolations}</Badge> : 0) },
                { key: 'enabled', label: 'Enabled', render: (p: any) => <Switch checked={p.enabled} onChange={(v) => toggle(p, v)} disabled={!admin} /> },
                {
                  key: 'act', label: '', render: (p: any) => admin && (
                    <div className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
                      {p.isPredefined ? <Button size="sm" variant="ghost" icon={<Copy size={13} />} title="Clone ke custom" onClick={() => install(p.templateKey, 'custom')} /> : <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => openEdit(p)} />}
                      <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => remove(p)} />
                    </div>
                  ),
                },
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'library' && (
        <div className="grid grid-2">
          {(templates.data?.items || []).map((t: any) => (
            <Card key={t.key} title={t.name} sub={t.category} actions={<RiskBadge level={t.severity} />}>
              <p style={{ marginTop: 0 }}>{t.description}</p>
              <div className="small"><b>{t.sideA.label}</b> <span className="mono">/{t.sideA.patterns.join('|')}/</span></div>
              <div className="small">⇄ <b>{t.sideB.label}</b> <span className="mono">/{t.sideB.patterns.join('|')}/</span></div>
              <div className="small muted" style={{ marginTop: 6 }}>Mitigasi: {t.mitigation}</div>
              {admin && (
                <div className="row mt">
                  {t.installed ? <Badge tone="success">✓ terpasang</Badge> : <Button size="sm" variant="primary" icon={<Download size={13} />} onClick={() => install(t.key, 'predefined')}>Install</Button>}
                  <Button size="sm" icon={<Copy size={13} />} onClick={() => install(t.key, 'custom')}>Clone ke custom</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!edit} title={edit?._id ? `Edit policy: ${edit?.name}` : 'Custom SoD policy'} onClose={() => setEdit(null)} width={880}
        footer={<><Button icon={<Search size={14} />} onClick={runPreview}>Preview matching</Button><span className="spacer" /><Button onClick={() => setEdit(null)}>Batal</Button><Button variant="primary" onClick={save} disabled={!edit?.name}>Simpan</Button></>}>
        {edit && (
          <>
            <div className="grid grid-3">
              <Field label="Nama *"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Kategori"><input className="input" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></Field>
              <Field label="Severity">
                <select className="select" value={edit.severity} onChange={(e) => setEdit({ ...edit, severity: e.target.value })}>{['low', 'medium', 'high', 'critical'].map((s) => <option key={s}>{s}</option>)}</select>
              </Field>
            </div>
            <Field label="Deskripsi"><textarea className="textarea" style={{ minHeight: 60 }} value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <div className="grid grid-2">
              {(['sideA', 'sideB'] as const).map((side) => (
                <Card key={side} title={side === 'sideA' ? 'Sisi A (fungsi 1)' : 'Sisi B (fungsi konflik)'}>
                  <div className="stack" style={{ gap: 10 }}>
                    <Field label="Label"><input className="input" value={edit[side].label} onChange={(e) => setEdit({ ...edit, [side]: { ...edit[side], label: e.target.value } })} /></Field>
                    <Field label="Pola nama entitlement (regex)" hint="mis. payment.*approv — cocok otomatis dengan group Okta baru"><TagInput value={edit[side].patterns} onChange={(v) => setEdit({ ...edit, [side]: { ...edit[side], patterns: v } })} /></Field>
                    <Field label="Atau pilih entitlement spesifik"><CheckList options={entOptions} value={edit[side].entitlementIds} onChange={(v) => setEdit({ ...edit, [side]: { ...edit[side], entitlementIds: v } })} height={170} /></Field>
                    {preview && <div className="small"><b>{preview[side].length} entitlement cocok:</b> {preview[side].map((e: any) => e.name).join(', ') || '—'}</div>}
                  </div>
                </Card>
              ))}
            </div>
            <Field label="Mitigasi / compensating control"><input className="input" value={edit.mitigation || ''} onChange={(e) => setEdit({ ...edit, mitigation: e.target.value })} /></Field>
          </>
        )}
      </Modal>
    </>
  );
}
