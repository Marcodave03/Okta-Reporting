'use client';
import { useState } from 'react';
import { Mail, MessageSquare, Pencil, Send } from 'lucide-react';
import { api, fmtDateTime, useApi } from '@/lib/client';
import { Badge, Button, Card, DataTable, Field, Loading, Modal, PageHeader, StatusBadge, Switch, Tabs, TagInput, toast, toastError } from '@/components/ui';

const ROLES: [string, string][] = [['reviewers', 'Reviewer terkait (personal)'], ['owner', 'Campaign owner'], ['admins', 'Semua admin'], ['business_owners', 'Business Owners']];

export default function WorkflowsPage() {
  const [tab, setTab] = useState('rules');
  const rules = useApi<any>('/api/workflows');
  const logs = useApi<any>(tab === 'log' ? '/api/notifications' : null, [tab]);
  const [edit, setEdit] = useState<any>(null);

  const patch = async (r: any, body: any) => { try { await api(`/api/workflows/${r._id}`, { method: 'PATCH', body }); rules.reload(); } catch (e) { toastError(e); } };
  const save = async () => {
    try {
      await api(`/api/workflows/${edit._id}`, { method: 'PATCH', body: edit });
      toast('Workflow disimpan', 'success');
      setEdit(null);
      rules.reload();
    } catch (e) { toastError(e); }
  };
  const test = async (r: any) => {
    try {
      const res = await api(`/api/workflows/${r._id}`, { method: 'POST' });
      const parts = Object.entries(res).map(([k, v]: any) => `${k}: ${v.ok ? 'terkirim' : v.error}`);
      toast(`Test — ${parts.join(' · ') || 'tidak ada channel aktif'}`, Object.values(res).every((v: any) => v.ok) ? 'success' : 'error');
    } catch (e) { toastError(e); }
  };
  const events = rules.data?.events || {};

  return (
    <>
      <PageHeader title="Workflows & Alerts" subtitle="Workflow reporting email & Slack otomatis berbasis event: campaign, overdue, eskalasi, revoke, SoD, Okta sync, dan report." />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'rules', label: 'Workflow rules', count: rules.data?.items?.length }, { key: 'log', label: 'Notification log' }]} />
      {tab === 'rules' && (
        <Card flush>
          {rules.loading ? <Loading /> : (
            <DataTable
              rows={rules.data?.items || []}
              columns={[
                { key: 'name', label: 'Workflow', render: (r: any) => (<div><div className="cell-title">{r.name}</div><div className="cell-sub">trigger: <code>{r.event}</code> — {events[r.event]?.label}</div></div>) },
                { key: 'channels', label: 'Channel', render: (r: any) => (<div className="row" style={{ gap: 4 }}>{r.channels?.email && <Badge tone="info"><Mail size={11} /> Email</Badge>}{r.channels?.slack && <Badge tone="purple"><MessageSquare size={11} /> Slack{r.slackTarget === 'business_owner' ? ' · BO' : ''}</Badge>}</div>) },
                { key: 'to', label: 'Penerima', render: (r: any) => <span className="small">{[...(r.recipientRoles || []), ...(r.recipients || [])].join(', ') || '—'}</span> },
                { key: 'enabled', label: 'Aktif', render: (r: any) => <Switch checked={r.enabled} onChange={(v) => patch(r, { enabled: v })} /> },
                { key: 'act', label: '', render: (r: any) => (<div className="row" style={{ gap: 2, flexWrap: 'nowrap' }}><Button size="sm" icon={<Send size={13} />} onClick={() => test(r)}>Test</Button><Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setEdit({ ...r })} /></div>) },
              ]}
            />
          )}
        </Card>
      )}
      {tab === 'log' && (
        <Card flush>
          {logs.loading ? <Loading /> : (
            <DataTable
              rows={logs.data?.items || []}
              empty={<div className="empty">Belum ada notifikasi</div>}
              columns={[
                { key: 'at', label: 'Waktu', render: (r: any) => fmtDateTime(r.at) },
                { key: 'channel', label: 'Channel', render: (r: any) => <Badge>{r.channel}</Badge> },
                { key: 'event', label: 'Event', render: (r: any) => <code>{r.event}</code> },
                { key: 'to', label: 'To', render: (r: any) => <span className="small truncate" style={{ maxWidth: 240, display: 'inline-block' }}>{r.to}</span> },
                { key: 'subject', label: 'Subject' },
                { key: 'status', label: 'Status', render: (r: any) => (<div><StatusBadge status={r.status} />{r.error && <div className="cell-sub">{r.error}</div>}</div>) },
              ]}
            />
          )}
        </Card>
      )}
      <Modal open={!!edit} title={`Edit workflow: ${edit?.name}`} onClose={() => setEdit(null)} width={760} footer={<><Button onClick={() => setEdit(null)}>Batal</Button><Button variant="primary" onClick={save}>Simpan</Button></>}>
        {edit && (
          <>
            <Field label="Nama"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <div className="row">
              <label className="check"><input type="checkbox" checked={!!edit.channels?.email} onChange={(e) => setEdit({ ...edit, channels: { ...edit.channels, email: e.target.checked } })} /> Email</label>
              <label className="check"><input type="checkbox" checked={!!edit.channels?.slack} onChange={(e) => setEdit({ ...edit, channels: { ...edit.channels, slack: e.target.checked } })} /> Slack</label>
              {edit.channels?.slack && (
                <select className="select" style={{ width: 'auto' }} value={edit.slackTarget || 'default'} onChange={(e) => setEdit({ ...edit, slackTarget: e.target.value })}>
                  <option value="default">Channel default</option>
                  <option value="business_owner">Channel Business Owner</option>
                </select>
              )}
            </div>
            <Field label="Penerima dinamis">
              <div className="row">{ROLES.map(([k, l]) => <label key={k} className="check small"><input type="checkbox" checked={(edit.recipientRoles || []).includes(k)} onChange={(e) => setEdit({ ...edit, recipientRoles: e.target.checked ? [...(edit.recipientRoles || []), k] : edit.recipientRoles.filter((x: string) => x !== k) })} /> {l}</label>)}</div>
            </Field>
            <Field label="Penerima tambahan (email)"><TagInput value={edit.recipients || []} onChange={(v) => setEdit({ ...edit, recipients: v })} /></Field>
            <Field label="Subject"><input className="input" value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} /></Field>
            <Field label="Body (HTML)" hint={<>Variabel: {(events[edit.event]?.vars || []).map((v: string) => <code key={v} style={{ marginRight: 4 }}>{`{{${v}}}`}</code>)}</>}>
              <textarea className="textarea mono" style={{ minHeight: 140 }} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
            </Field>
          </>
        )}
      </Modal>
    </>
  );
}
