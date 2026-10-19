'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BellRing, Download, Play, Trash2, Wrench, XCircle } from 'lucide-react';
import { api, download, fmtDate, fmtDateTime, useApi } from '@/lib/client';
import { Badge, Button, Card, ErrorBox, Loading, PageHeader, Progress, StatusBadge, useConfirm, toast, toastError } from '@/components/ui';
import { ReviewTable } from '@/components/ReviewTable';
import { useUser } from '@/components/UserContext';

export default function CampaignDetail({ params }: { params: { id: string } }) {
  const router = useRouter();
  const user = useUser();
  const admin = user.role === 'admin';
  const { data, loading, error, reload } = useApi<any>(`/api/campaigns/${params.id}`);
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState('');
  const [tableKey, setTableKey] = useState(0);

  const act = async (action: string, msg: string) => {
    setBusy(action);
    try {
      const r = await api(`/api/campaigns/${params.id}/action`, { body: { action } });
      toast(action === 'remind' ? `Pengingat dikirim ke ${r.reviewers} reviewer` : msg, 'success');
      if (action === 'launch' && r._id && r._id !== params.id) router.push(`/campaigns/${r._id}`);
      reload();
      setTableKey((k) => k + 1);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy('');
    }
  };
  const remove = async () => {
    if (!(await confirm('Hapus campaign?', 'Campaign beserta seluruh item review akan dihapus permanen.', true))) return;
    await api(`/api/campaigns/${params.id}`, { method: 'DELETE' });
    router.push('/campaigns');
  };
  const remediate = async () => {
    try {
      const r = await api('/api/certifications/remediate', { body: { campaignId: params.id } });
      toast(`Remediasi: ${r.done || 0} selesai, ${r.pending || 0} pending, ${r.failed || 0} gagal`, 'success');
      setTableKey((k) => k + 1);
    } catch (e) {
      toastError(e);
    }
  };
  const exportItems = (format: string) =>
    download('/api/reports/export', { def: { name: `Certification - ${data.campaign.name}`, dataset: 'certifications', filters: [{ field: 'campaign', op: 'eq', value: data.campaign.name }] }, format }).catch(toastError);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const c = data.campaign;
  const s = c.stats || {};
  const pct = s.total ? Math.round(((s.total - s.pending) / s.total) * 100) : 0;

  return (
    <>
      {dialog}
      <PageHeader
        crumbs={[{ label: 'Campaigns', href: '/campaigns' }, { label: c.name }]}
        title={<span className="row">{c.name} <StatusBadge status={c.status} />{c.overdue && <Badge tone="danger">overdue</Badge>}{c.isTemplate && <Badge tone="purple">recurring · {c.recurrence}</Badge>}</span>}
        subtitle={c.description}
        actions={
          <>
            {['csv', 'xlsx', 'pdf'].map((f) => <Button key={f} size="sm" icon={<Download size={13} />} onClick={() => exportItems(f)}>{f.toUpperCase()}</Button>)}
            {admin && ['draft', 'scheduled'].includes(c.status) && <Button variant="primary" icon={<Play size={14} />} loading={busy === 'launch'} onClick={() => act('launch', 'Campaign diluncurkan')}>Launch now</Button>}
            {admin && c.status === 'active' && (
              <>
                <Button icon={<BellRing size={14} />} loading={busy === 'remind'} onClick={() => act('remind', '')}>Send reminder</Button>
                <Button icon={<Wrench size={14} />} onClick={remediate}>Retry remediation</Button>
                <Button icon={<XCircle size={14} />} onClick={async () => (await confirm('Tutup campaign?', 'Item pending akan tetap tercatat pending di laporan.')) && act('complete', 'Campaign ditutup')}>Close</Button>
              </>
            )}
            {admin && ['scheduled', 'draft', 'active'].includes(c.status) && <Button variant="ghost" onClick={() => act('cancel', 'Campaign dibatalkan')}>Cancel</Button>}
            {admin && <Button variant="ghost" icon={<Trash2 size={14} />} onClick={remove} />}
          </>
        }
      />

      <div className="grid grid-4 mb">
        <div className="card kpi"><div className="kpi-label">Progress</div><div className="kpi-value">{pct}%</div><Progress value={pct} /></div>
        <div className="card kpi"><div className="kpi-label">Pending</div><div className="kpi-value" style={{ color: c.overdue && s.pending ? 'var(--danger)' : undefined }}>{s.pending ?? 0}</div><div className="kpi-hint">dari {s.total ?? 0} item</div></div>
        <div className="card kpi"><div className="kpi-label">Approved / Revoked</div><div className="kpi-value">{s.approved ?? 0} / {s.revoked ?? 0}</div><div className="kpi-hint">{s.reassigned ?? 0} item di-reassign</div></div>
        <div className="card kpi"><div className="kpi-label">{c.status === 'scheduled' ? 'Next run' : 'Due date'}</div><div className="kpi-value" style={{ fontSize: 22 }}>{fmtDate(c.status === 'scheduled' ? c.nextRunAt : c.dueDate)}</div><div className="kpi-hint">launched {fmtDateTime(c.launchedAt)}</div></div>
      </div>

      <div className="grid split mb">
        <Card title="Konfigurasi">
          <dl className="kv">
            <dt>Scope</dt><dd><Badge tone="info">{c.scopeType}</Badge> {c.scope?.departments?.join(', ')}</dd>
            <dt>Reviewer hierarchy</dt><dd>{c.reviewerHierarchy.map((l: string, i: number) => <div key={l}>L{i + 1}: {l}{l === 'specific' ? ` (${c.specificReviewer})` : ''}</div>)}</dd>
            <dt>Fallback</dt><dd>{c.fallbackReviewer || 'admin'}</dd>
            <dt>Eskalasi</dt><dd>{c.escalation?.enabled ? `setelah ${c.escalation.afterDays} hari, maks ${c.escalation.maxLevel}×` : 'nonaktif'}</dd>
            <dt>Reassignment</dt><dd>{c.allowReassign ? 'diizinkan' : 'tidak'}</dd>
            <dt>Auto-remediation</dt><dd>{c.autoRemediate ? 'ya (Okta)' : 'manual'}</dd>
            <dt>Owner</dt><dd>{c.owner}</dd>
          </dl>
        </Card>
        <Card title="Reviewer progress" flush>
          <div className="table-wrap" style={{ maxHeight: 300 }}>
            <table className="table">
              <thead><tr><th>Reviewer</th><th>Total</th><th>Pending</th><th>Approved</th><th>Revoked</th><th style={{ width: 160 }}>Done</th></tr></thead>
              <tbody>
                {data.reviewers.map((r: any) => {
                  const p = r.total ? Math.round(((r.total - r.pending) / r.total) * 100) : 0;
                  return (
                    <tr key={r._id}><td>{r._id}</td><td>{r.total}</td><td>{r.pending}</td><td>{r.approved}</td><td>{r.revoked}</td><td><div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><Progress value={p} /><span className="small">{p}%</span></div></td></tr>
                  );
                })}
                {!data.reviewers.length && <tr><td colSpan={6} className="muted">Belum ada item</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {data.instances?.length > 0 && (
        <Card title="Riwayat instance (recurring)" className="mb" flush>
          <table className="table"><tbody>{data.instances.map((i: any) => <tr key={i._id} className="clickable" onClick={() => router.push(`/campaigns/${i._id}`)}><td>{i.name}</td><td><StatusBadge status={i.status} /></td><td>{fmtDate(i.launchedAt)}</td><td>{i.stats?.total} item</td></tr>)}</tbody></table>
        </Card>
      )}

      {c.status !== 'scheduled' && c.status !== 'draft' && (
        <Card title="Review items" flush>
          <ReviewTable key={tableKey} campaignId={params.id} showReviewer readOnly={!admin} onChanged={reload} />
        </Card>
      )}
    </>
  );
}
