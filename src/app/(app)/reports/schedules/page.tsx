'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { api, fmtDateTime, useApi } from '@/lib/client';
import { Badge, Button, Card, DataTable, Field, Loading, Modal, PageHeader, StatusBadge, Switch, TagInput, useConfirm, toast, toastError } from '@/components/ui';

const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const EMPTY = { name: '', reportId: '', frequency: 'weekly', time: '08:00', dayOfWeek: 1, dayOfMonth: 1, cron: '', formats: ['pdf'], recipients: [] as string[], slack: false, slackTarget: 'default', enabled: true };

function SchedulesInner() {
  const sp = useSearchParams();
  const schedules = useApi<any>('/api/schedules');
  const reports = useApi<any>('/api/reports');
  const runs = useApi<any>('/api/schedules/runs');
  const [edit, setEdit] = useState<any>(null);
  const [running, setRunning] = useState('');
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    const rid = sp.get('reportId');
    if (rid && reports.data) {
      const r = reports.data.items.find((x: any) => x._id === rid);
      setEdit({ ...EMPTY, reportId: rid, name: r ? `${r.name} — terjadwal` : '' });
    }
  }, [sp, reports.data]);

  const save = async () => {
    try {
      if (edit._id) await api(`/api/schedules/${edit._id}`, { method: 'PATCH', body: edit });
      else await api('/api/schedules', { body: edit });
      toast('Jadwal disimpan', 'success');
      setEdit(null);
      schedules.reload();
    } catch (e) { toastError(e); }
  };
  const run = async (s: any) => {
    setRunning(s._id);
    try {
      const r = await api(`/api/schedules/${s._id}/run`, { method: 'POST' });
      r.status === 'success' ? toast(`Terkirim: ${r.rows} baris → ${r.deliveredTo.join(', ')}`, 'success') : toast(`Gagal: ${r.error}`, 'error');
      schedules.reload();
      runs.reload();
    } catch (e) { toastError(e); } finally { setRunning(''); }
  };
  const patch = async (s: any, body: any) => { try { await api(`/api/schedules/${s._id}`, { method: 'PATCH', body }); schedules.reload(); } catch (e) { toastError(e); } };
  const remove = async (s: any) => { if (await confirm('Hapus jadwal?', s.name, true)) { await api(`/api/schedules/${s._id}`, { method: 'DELETE' }); schedules.reload(); } };
  const describe = (s: any) => {
    switch (s.frequency) {
      case 'hourly': return 'Setiap jam';
      case 'daily': return `Harian ${s.time}`;
      case 'weekly': return `Mingguan, ${DAYS[s.dayOfWeek]} ${s.time}`;
      case 'monthly': return `Bulanan tgl ${s.dayOfMonth} ${s.time}`;
      case 'quarterly': return `Kuartalan tgl ${s.dayOfMonth} ${s.time}`;
      default: return `cron: ${s.cron}`;
    }
  };

  return (
    <>
      {dialog}
      <PageHeader title="Report Schedules" subtitle="Kirim report otomatis via email (lampiran multi-format) dan/atau Slack — termasuk channel Business Owner." actions={<Button variant="primary" icon={<Plus size={14} />} onClick={() => setEdit({ ...EMPTY })}>New schedule</Button>} />
      <Card flush className="mb">
        {schedules.loading ? <Loading /> : (
          <DataTable
            rows={schedules.data?.items || []}
            empty={<div className="empty">Belum ada jadwal</div>}
            columns={[
              { key: 'name', label: 'Schedule', render: (s: any) => (<div><div className="cell-title">{s.name}</div><div className="cell-sub">{s.reportId?.name}</div></div>) },
              { key: 'freq', label: 'Frekuensi', render: (s: any) => (<div className="small">{describe(s)}<div className="cell-sub mono">{s.cronExpression}</div></div>) },
              { key: 'formats', label: 'Format', render: (s: any) => <div className="row" style={{ gap: 3 }}>{s.formats.map((f: string) => <Badge key={f}>{f}</Badge>)}</div> },
              { key: 'deliver', label: 'Delivery', render: (s: any) => (<div className="small">{s.recipients.length ? `${s.recipients.length} email` : ''}{s.slack && <Badge tone="purple">Slack{s.slackTarget === 'business_owner' ? ' · Business Owner' : ''}</Badge>}</div>) },
              { key: 'next', label: 'Next / last run', render: (s: any) => (<div className="small">{fmtDateTime(s.nextRunAt)}<div className="cell-sub">{s.lastRunAt ? `${fmtDateTime(s.lastRunAt)} · ${s.lastStatus}` : 'belum pernah'}</div></div>) },
              { key: 'enabled', label: 'Aktif', render: (s: any) => <Switch checked={s.enabled} onChange={(v) => patch(s, { enabled: v })} /> },
              {
                key: 'act', label: '', render: (s: any) => (
                  <div className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
                    <Button size="sm" icon={<Play size={13} />} loading={running === s._id} onClick={() => run(s)}>Run now</Button>
                    <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setEdit({ ...EMPTY, ...s, reportId: s.reportId?._id })} />
                    <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => remove(s)} />
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>
      <Card title="Riwayat eksekusi" flush>
        <DataTable
          rows={runs.data?.items || []}
          empty={<div className="empty">Belum ada eksekusi</div>}
          columns={[
            { key: 'ranAt', label: 'Waktu', render: (r: any) => fmtDateTime(r.ranAt) },
            { key: 'reportName', label: 'Report' },
            { key: 'trigger', label: 'Trigger' },
            { key: 'rows', label: 'Rows' },
            { key: 'formats', label: 'Format', render: (r: any) => r.formats?.join(', ') },
            { key: 'deliveredTo', label: 'Dikirim ke', render: (r: any) => <span className="small">{r.deliveredTo?.join(', ') || '—'}</span> },
            { key: 'status', label: 'Status', render: (r: any) => (<div><StatusBadge status={r.status} />{r.error && <div className="cell-sub" style={{ color: 'var(--danger)' }}>{r.error}</div>}</div>) },
          ]}
        />
      </Card>

      <Modal open={!!edit} title={edit?._id ? 'Edit schedule' : 'New schedule'} onClose={() => setEdit(null)} width={680} footer={<><Button onClick={() => setEdit(null)}>Batal</Button><Button variant="primary" onClick={save}>Simpan</Button></>}>
        {edit && (
          <>
            <div className="grid grid-2">
              <Field label="Nama"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Report">
                <select className="select" value={edit.reportId} onChange={(e) => setEdit({ ...edit, reportId: e.target.value })} disabled={!!edit._id}>
                  <option value="">— pilih report —</option>
                  {reports.data?.items?.map((r: any) => <option key={r._id} value={r._id}>{r.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-3">
              <Field label="Frekuensi">
                <select className="select" value={edit.frequency} onChange={(e) => setEdit({ ...edit, frequency: e.target.value })}>
                  {['hourly', 'daily', 'weekly', 'monthly', 'quarterly', 'custom'].map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </Field>
              {edit.frequency === 'custom' ? (
                <Field label="Cron expression" hint="menit jam tgl bulan hari, mis. 0 7 * * 1-5"><input className="input mono" value={edit.cron} onChange={(e) => setEdit({ ...edit, cron: e.target.value })} /></Field>
              ) : edit.frequency !== 'hourly' && (
                <Field label="Jam"><input className="input" type="time" value={edit.time} onChange={(e) => setEdit({ ...edit, time: e.target.value })} /></Field>
              )}
              {edit.frequency === 'weekly' && (
                <Field label="Hari"><select className="select" value={edit.dayOfWeek} onChange={(e) => setEdit({ ...edit, dayOfWeek: Number(e.target.value) })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></Field>
              )}
              {['monthly', 'quarterly'].includes(edit.frequency) && (
                <Field label="Tanggal"><input className="input" type="number" min={1} max={28} value={edit.dayOfMonth} onChange={(e) => setEdit({ ...edit, dayOfMonth: Number(e.target.value) })} /></Field>
              )}
            </div>
            <Field label="Format lampiran">
              <div className="row">{['pdf', 'xlsx', 'csv', 'json', 'html'].map((f) => <label key={f} className="check"><input type="checkbox" checked={edit.formats.includes(f)} onChange={(e) => setEdit({ ...edit, formats: e.target.checked ? [...edit.formats, f] : edit.formats.filter((x: string) => x !== f) })} /> {f.toUpperCase()}</label>)}</div>
            </Field>
            <Field label="Penerima email"><TagInput value={edit.recipients} onChange={(v) => setEdit({ ...edit, recipients: v })} placeholder="email lalu Enter" /></Field>
            <div className="row">
              <Switch checked={edit.slack} onChange={(v) => setEdit({ ...edit, slack: v })} /> Kirim ringkasan ke Slack
              {edit.slack && (
                <select className="select" style={{ width: 'auto' }} value={edit.slackTarget} onChange={(e) => setEdit({ ...edit, slackTarget: e.target.value })}>
                  <option value="default">Channel default</option>
                  <option value="business_owner">Channel Business Owner</option>
                </select>
              )}
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

export default function SchedulesPage() {
  return <Suspense><SchedulesInner /></Suspense>;
}
