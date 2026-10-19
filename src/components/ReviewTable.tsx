'use client';
import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, Check, UserRoundCog, X } from 'lucide-react';
import { api, daysSince, fmtDate, qs, useApi } from '@/lib/client';
import { Badge, Button, DataTable, Field, Loading, Modal, Pagination, RiskBadge, StatusBadge, TypeBadge, toast, toastError } from './ui';

export function ReviewTable({ campaignId, reviewer, showCampaign, showReviewer, onChanged, readOnly }: { campaignId?: string; reviewer?: string; showCampaign?: boolean; showReviewer?: boolean; onChanged?: () => void; readOnly?: boolean }) {
  const [decision, setDecision] = useState('pending');
  const [q, setQ] = useState('');
  const [sod, setSod] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [dlg, setDlg] = useState<null | { kind: 'approved' | 'revoked' | 'reassign'; ids: string[] }>(null);
  const [comment, setComment] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const url = `/api/certifications/items?${qs({ campaignId, reviewer, decision, q, sod: sod ? '1' : '', page, limit: 50, activeOnly: !campaignId ? '1' : '' })}`;
  const { data, loading, reload } = useApi<any>(url);

  const open = (kind: 'approved' | 'revoked' | 'reassign', ids: string[]) => {
    setComment('');
    setTo('');
    setDlg({ kind, ids });
  };
  const quickApprove = async (ids: string[]) => {
    try {
      await api('/api/certifications/decide', { body: { itemIds: ids, decision: 'approved', comment: '' } });
      toast(`${ids.length} item di-approve`, 'success');
      setSelected([]);
      reload();
      onChanged?.();
    } catch (e) {
      toastError(e);
    }
  };
  const submit = async () => {
    if (!dlg) return;
    setBusy(true);
    try {
      if (dlg.kind === 'reassign') await api('/api/certifications/reassign', { body: { itemIds: dlg.ids, to, reason: comment } });
      else await api('/api/certifications/decide', { body: { itemIds: dlg.ids, decision: dlg.kind, comment } });
      toast(dlg.kind === 'reassign' ? `${dlg.ids.length} item dialihkan ke ${to}` : `${dlg.ids.length} item ${dlg.kind}`, 'success');
      setDlg(null);
      setSelected([]);
      reload();
      onChanged?.();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const items = data?.items || [];
  const canAct = (r: any) => !readOnly && r.campaignId?.status === 'active';

  return (
    <>
      <div style={{ padding: '14px 14px 0' }}>
        <div className="filters">
          <select className="select" value={decision} onChange={(e) => { setDecision(e.target.value); setPage(1); setSelected([]); }}>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="revoked">Revoked</option>
            <option value="">Semua keputusan</option>
          </select>
          <input className="input grow" placeholder="Cari identity…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <label className="check small"><input type="checkbox" checked={sod} onChange={(e) => setSod(e.target.checked)} /> Hanya konflik SoD</label>
          <span className="spacer" />
          {!readOnly && selected.length > 0 && (
            <div className="row" style={{ gap: 6 }}>
              <span className="small muted">{selected.length} dipilih</span>
              <Button size="sm" variant="success" icon={<Check size={13} />} onClick={() => quickApprove(selected)}>Approve</Button>
              <Button size="sm" variant="danger" icon={<X size={13} />} onClick={() => open('revoked', selected)}>Revoke</Button>
              <Button size="sm" icon={<UserRoundCog size={13} />} onClick={() => open('reassign', selected)}>Reassign</Button>
            </div>
          )}
        </div>
      </div>
      {loading && !data ? (
        <Loading />
      ) : (
        <>
          <DataTable
            rows={items}
            selectable={!readOnly && decision === 'pending'}
            selected={selected}
            onSelect={setSelected}
            empty={<div className="empty"><h4>{decision === 'pending' ? '🎉 Tidak ada review pending' : 'Tidak ada item'}</h4></div>}
            columns={[
              {
                key: 'identity',
                label: 'Identity',
                render: (r: any) => (
                  <div>
                    <Link href={`/identities/${r.identityId?._id}`} className="cell-title">{r.identityId?.displayName}</Link>
                    <div className="cell-sub row" style={{ gap: 4 }}>
                      {r.identityId?.department} {r.identityId?.identityType !== 'human' && <TypeBadge type={r.identityId?.identityType} />}
                      {['leaver', 'mover', 'inactive'].includes(r.identityId?.lifecycle) && <StatusBadge status={r.identityId?.lifecycle} />}
                    </div>
                  </div>
                ),
              },
              {
                key: 'entitlement',
                label: 'Access',
                render: (r: any) => (
                  <div>
                    <div className="cell-title">{r.entitlementId?.name}</div>
                    <div className="cell-sub">{r.applicationId?.label || r.entitlementId?.kind}</div>
                  </div>
                ),
              },
              {
                key: 'risk',
                label: 'Risk insight',
                render: (r: any) => {
                  const d = daysSince(r.lastUsedAt);
                  return (
                    <div className="row" style={{ gap: 4 }}>
                      <RiskBadge level={r.riskLevel} />
                      {r.sodFlag && <Badge tone="danger" title="Akses ini bagian dari pelanggaran SoD terbuka"><AlertTriangle size={11} /> SoD</Badge>}
                      {r.entitlementId?.privileged && <Badge tone="purple">privileged</Badge>}
                      {d === null ? <Badge tone="warning">never used</Badge> : d > 90 ? <Badge tone="warning">unused {d}d</Badge> : null}
                    </div>
                  );
                },
              },
              ...(showCampaign ? [{ key: 'campaign', label: 'Campaign', render: (r: any) => (<div><Link href={`/campaigns/${r.campaignId?._id}`}>{r.campaignId?.name}</Link><div className="cell-sub">due {fmtDate(r.dueDate)}</div></div>) }] : []),
              ...(showReviewer ? [{ key: 'reviewer', label: 'Reviewer', render: (r: any) => (<div><div>{r.reviewer}</div><div className="cell-sub">{r.reviewerLevelName}{r.reassignHistory?.length ? ` · ${r.reassignHistory.length}× dialihkan` : ''}</div></div>) }] : []),
              {
                key: 'decision',
                label: 'Decision',
                render: (r: any) => (
                  <div>
                    <StatusBadge status={r.decision} />
                    {r.comment && <div className="cell-sub truncate" style={{ maxWidth: 180 }} title={r.comment}>“{r.comment}”</div>}
                    {r.decision === 'revoked' && r.remediation?.status && <div className="cell-sub" title={r.remediation.message}>remediasi: {r.remediation.status}</div>}
                  </div>
                ),
              },
              {
                key: 'act',
                label: '',
                render: (r: any) =>
                  canAct(r) && (
                    <div className="row nowrap" style={{ gap: 4, flexWrap: 'nowrap' }}>
                      {r.decision !== 'approved' && <Button size="sm" variant="success" icon={<Check size={13} />} title="Approve" onClick={() => quickApprove([r._id])} />}
                      {r.decision !== 'revoked' && <Button size="sm" variant="danger" icon={<X size={13} />} title="Revoke" onClick={() => open('revoked', [r._id])} />}
                      {r.decision === 'pending' && r.campaignId?.allowReassign !== false && <Button size="sm" icon={<UserRoundCog size={13} />} title="Reassign" onClick={() => open('reassign', [r._id])} />}
                    </div>
                  ),
              },
            ]}
          />
          <Pagination page={page} total={data?.total || 0} limit={50} onChange={setPage} />
        </>
      )}
      <Modal
        open={!!dlg}
        title={dlg?.kind === 'reassign' ? `Reassign ${dlg.ids.length} item` : `Revoke ${dlg?.ids.length} akses`}
        onClose={() => setDlg(null)}
        footer={
          <>
            <Button onClick={() => setDlg(null)}>Batal</Button>
            <Button variant={dlg?.kind === 'revoked' ? 'danger' : 'primary'} loading={busy} onClick={submit} disabled={dlg?.kind === 'revoked' ? !comment.trim() : !to.trim()}>
              {dlg?.kind === 'reassign' ? 'Reassign' : 'Revoke akses'}
            </Button>
          </>
        }
      >
        {dlg?.kind === 'reassign' && (
          <Field label="Reviewer tujuan (email)" hint="Reviewer baru akan menerima notifikasi email. Self-review otomatis ditolak.">
            <input className="input" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="nama@company.com" autoFocus />
          </Field>
        )}
        {dlg?.kind === 'revoked' && <div className="callout warning small">Akses yang di-revoke akan diremediasi (dicabut di Okta bila auto-remediation aktif) dan admin akan dinotifikasi.</div>}
        <Field label={dlg?.kind === 'revoked' ? 'Alasan revoke (wajib)' : 'Alasan reassign'}>
          <textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={dlg?.kind === 'revoked' ? 'mis. tidak dibutuhkan lagi / konflik SoD' : 'mis. bukan atasan langsung'} />
        </Field>
      </Modal>
    </>
  );
}
