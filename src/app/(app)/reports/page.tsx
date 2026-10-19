'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CalendarClock, Copy, Download, Eye, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api, download, useApi } from '@/lib/client';
import { Badge, Button, Card, DataTable, Field, Loading, Modal, PageHeader, useConfirm, toast, toastError } from '@/components/ui';
import { useUser } from '@/components/UserContext';

const EMPTY = { name: '', description: '', dataset: 'identities', columns: [] as string[], filters: [] as any[], sortBy: '', sortDir: 'asc', limit: '' };

export default function ReportsPage() {
  const user = useUser();
  const reports = useApi<any>('/api/reports');
  const meta = useApi<any>('/api/reports/datasets');
  const [edit, setEdit] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [previewTitle, setPreviewTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();
  const ds = useMemo(() => meta.data?.datasets?.find((d: any) => d.key === edit?.dataset), [meta.data, edit?.dataset]);

  const runPreview = async (body: any, title: string) => {
    setBusy(true);
    try {
      setPreview(await api('/api/reports/run', { body: { ...body, previewLimit: 200 } }));
      setPreviewTitle(title);
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const exportAs = (body: any, format: string) => download('/api/reports/export', { ...body, format }).then(() => toast(`Export ${format.toUpperCase()} siap`, 'success')).catch(toastError);
  const save = async () => {
    try {
      const body = { ...edit, limit: edit.limit ? Number(edit.limit) : undefined };
      if (edit._id && !edit.isSystem) await api(`/api/reports/${edit._id}`, { method: 'PATCH', body });
      else if (edit._id && edit.isSystem) await api(`/api/reports/${edit._id}`, { method: 'PATCH', body: { columns: edit.columns, filters: edit.filters, sortBy: edit.sortBy, sortDir: edit.sortDir, limit: body.limit } });
      else await api('/api/reports', { body });
      toast('Report disimpan', 'success');
      setEdit(null);
      reports.reload();
    } catch (e) { toastError(e); }
  };
  const remove = async (r: any) => {
    if (!(await confirm('Hapus report?', `"${r.name}" dan jadwal terkait akan dihapus.`, true))) return;
    try { await api(`/api/reports/${r._id}`, { method: 'DELETE' }); reports.reload(); } catch (e) { toastError(e); }
  };
  const toggleCol = (k: string) => {
    const cols = edit.columns.length ? edit.columns : ds.columns.map((c: any) => c.key);
    setEdit({ ...edit, columns: cols.includes(k) ? cols.filter((c: string) => c !== k) : [...cols, k] });
  };

  return (
    <>
      {dialog}
      <PageHeader
        title="Reports"
        subtitle="Report sistem & custom report builder — preview, export CSV / XLSX / PDF / JSON / HTML, dan jadwalkan pengiriman."
        actions={user.role !== 'auditor' && <Button variant="primary" icon={<Plus size={14} />} onClick={() => setEdit({ ...EMPTY })}>Custom report</Button>}
      />
      <Card flush>
        {reports.loading ? <Loading /> : (
          <DataTable
            rows={reports.data?.items || []}
            columns={[
              { key: 'name', label: 'Report', render: (r: any) => (<div><div className="cell-title">{r.name}</div><div className="cell-sub">{r.description}</div></div>) },
              { key: 'dataset', label: 'Dataset', render: (r: any) => <Badge tone="info">{r.datasetLabel}</Badge> },
              { key: 'type', label: 'Type', render: (r: any) => <Badge tone={r.isSystem ? 'neutral' : 'purple'}>{r.isSystem ? 'system' : 'custom'}</Badge> },
              { key: 'filters', label: 'Filter', render: (r: any) => <span className="small">{(r.filters || []).map((f: any) => `${f.field} ${f.op} ${f.value ?? ''}`).join(' · ') || '—'}</span> },
              { key: 'schedules', label: 'Jadwal', render: (r: any) => (r.schedules ? <Badge tone="success">{r.schedules} aktif</Badge> : '—') },
              {
                key: 'act', label: '', render: (r: any) => (
                  <div className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
                    <Button size="sm" variant="ghost" icon={<Eye size={13} />} title="Preview" onClick={() => runPreview({ reportId: r._id }, r.name)} />
                    {['csv', 'xlsx', 'pdf'].map((f) => <Button key={f} size="sm" variant="ghost" onClick={() => exportAs({ reportId: r._id }, f)}>{f.toUpperCase()}</Button>)}
                    {user.role === 'admin' && <Link className="btn btn-ghost btn-sm btn-icon" title="Jadwalkan" href={`/reports/schedules?reportId=${r._id}`}><CalendarClock size={13} /></Link>}
                    {user.role !== 'auditor' && <Button size="sm" variant="ghost" icon={<Pencil size={13} />} title="Edit / customize" onClick={() => setEdit({ ...EMPTY, ...r, limit: r.limit || '' })} />}
                    {user.role !== 'auditor' && <Button size="sm" variant="ghost" icon={<Copy size={13} />} title="Duplicate" onClick={() => setEdit({ ...EMPTY, ...r, _id: undefined, isSystem: false, name: `${r.name} (copy)`, limit: r.limit || '' })} />}
                    {!r.isSystem && user.role !== 'auditor' && <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => remove(r)} />}
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>

      {preview && (
        <Card className="mt" title={`Preview: ${previewTitle}`} sub={`${preview.total} baris (menampilkan maks. 200)`} flush actions={<Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => setPreview(null)} />}>
          <div className="table-wrap" style={{ maxHeight: 460 }}>
            <table className="table">
              <thead><tr>{preview.columns.map((c: any) => <th key={c.key}>{c.label}</th>)}</tr></thead>
              <tbody>{preview.rows.map((r: any, i: number) => <tr key={i}>{preview.columns.map((c: any) => <td key={c.key}>{String(r[c.key] ?? '')}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={!!edit} title={edit?._id ? `Customize: ${edit.name}` : 'Custom report builder'} onClose={() => setEdit(null)} width={900}
        footer={<>
          <Button icon={<Eye size={14} />} loading={busy} onClick={() => runPreview({ def: { ...edit, limit: edit.limit ? Number(edit.limit) : undefined } }, edit.name || 'Draft')}>Preview</Button>
          {['csv', 'xlsx', 'pdf', 'json', 'html'].map((f) => <Button key={f} size="sm" icon={<Download size={12} />} onClick={() => exportAs({ def: { ...edit, name: edit.name || 'Custom report' } }, f)}>{f.toUpperCase()}</Button>)}
          <span className="spacer" />
          <Button onClick={() => setEdit(null)}>Batal</Button>
          <Button variant="primary" onClick={save} disabled={!edit?.name}>Simpan</Button>
        </>}>
        {edit && ds && (
          <>
            <div className="grid grid-3">
              <Field label="Nama report *"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} disabled={edit.isSystem} /></Field>
              <Field label="Dataset">
                <select className="select" value={edit.dataset} disabled={edit.isSystem} onChange={(e) => setEdit({ ...edit, dataset: e.target.value, columns: [], filters: [], sortBy: '' })}>
                  {meta.data.datasets.map((d: any) => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
              </Field>
              <Field label="Limit baris"><input className="input" type="number" value={edit.limit} onChange={(e) => setEdit({ ...edit, limit: e.target.value })} placeholder="semua" /></Field>
            </div>
            <Field label="Deskripsi"><input className="input" value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} disabled={edit.isSystem} /></Field>
            <Field label="Kolom" hint={ds.description}>
              <div className="chip-list">
                {ds.columns.map((c: any) => {
                  const on = !edit.columns.length || edit.columns.includes(c.key);
                  return <button type="button" key={c.key} className="chip" onClick={() => toggleCol(c.key)} style={{ cursor: 'pointer', background: on ? 'var(--primary-soft)' : undefined, color: on ? 'var(--primary)' : undefined, border: 'none' }}>{on ? '✓ ' : ''}{c.label}</button>;
                })}
              </div>
            </Field>
            <Field label="Filter">
              <div className="stack" style={{ gap: 6 }}>
                {edit.filters.map((f: any, i: number) => (
                  <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
                    <select className="select" value={f.field} onChange={(e) => setEdit({ ...edit, filters: edit.filters.map((x: any, j: number) => (j === i ? { ...x, field: e.target.value } : x)) })}>
                      {ds.columns.map((c: any) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                    <select className="select" value={f.op} onChange={(e) => setEdit({ ...edit, filters: edit.filters.map((x: any, j: number) => (j === i ? { ...x, op: e.target.value } : x)) })}>
                      {meta.data.operators.map((o: any) => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </select>
                    <input className="input" value={f.value ?? ''} onChange={(e) => setEdit({ ...edit, filters: edit.filters.map((x: any, j: number) => (j === i ? { ...x, value: e.target.value } : x)) })} placeholder="nilai" />
                    <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => setEdit({ ...edit, filters: edit.filters.filter((_: any, j: number) => j !== i) })} />
                  </div>
                ))}
                <div><Button size="sm" icon={<Plus size={12} />} onClick={() => setEdit({ ...edit, filters: [...edit.filters, { field: ds.columns[0].key, op: 'eq', value: '' }] })}>Tambah filter</Button></div>
              </div>
            </Field>
            <div className="grid grid-2">
              <Field label="Urutkan berdasarkan">
                <select className="select" value={edit.sortBy || ''} onChange={(e) => setEdit({ ...edit, sortBy: e.target.value })}>
                  <option value="">—</option>
                  {ds.columns.map((c: any) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="Arah">
                <select className="select" value={edit.sortDir} onChange={(e) => setEdit({ ...edit, sortDir: e.target.value })}><option value="asc">Ascending</option><option value="desc">Descending</option></select>
              </Field>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
