'use client';
import Link from 'next/link';
import { useState } from 'react';
import { daysSince, fmtDate, useApi } from '@/lib/client';
import { Badge, Card, DataTable, ErrorBox, Loading, PageHeader, RiskBadge, StatusBadge, Tabs, TypeBadge } from '@/components/ui';
import { OktaEventsTable } from '@/components/OktaEvents';
import { useUser } from '@/components/UserContext';

export default function IdentityDetail({ params }: { params: { id: string } }) {
  const { data, loading, error } = useApi<any>(`/api/identities/${params.id}`);
  const [tab, setTab] = useState('access');
  const canSeeActivity = ['admin', 'auditor'].includes(useUser().role);
  const oktaId = data?.identity?.oktaId;
  const activity = useApi<any>(canSeeActivity && oktaId ? `/api/okta/events?user=${encodeURIComponent(oktaId)}&limit=100` : null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const i = data.identity;
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Identities', href: '/identities' }, { label: i.displayName }]}
        title={<span className="row">{i.displayName} <TypeBadge type={i.identityType} /> <StatusBadge status={i.status} /></span>}
        subtitle={`${i.login} · ${i.title || ''} ${i.department ? '· ' + i.department : ''}`}
      />
      <div className="grid grid-3 mb">
        <div className="card kpi">
          <div className="kpi-label">Risk score</div>
          <div className="kpi-value row">{i.riskScore}<RiskBadge level={i.riskLevel} /></div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Access</div>
          <div className="kpi-value">{data.access.length}</div>
          <div className="kpi-hint">{data.access.filter((a: any) => a.privileged).length} privileged</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Open SoD violations</div>
          <div className="kpi-value" style={{ color: data.violations.some((v: any) => v.status === 'open') ? 'var(--danger)' : undefined }}>{data.violations.filter((v: any) => v.status === 'open').length}</div>
        </div>
      </div>
      <div className="grid split">
        <div className="stack">
          <Card title="Profile">
            <dl className="kv">
              <dt>Email</dt><dd>{i.email}</dd>
              <dt>Okta ID</dt><dd className="mono">{i.oktaId}</dd>
              <dt>Employee type</dt><dd>{i.employeeType || '—'}</dd>
              <dt>Location</dt><dd>{i.location || '—'}</dd>
              <dt>Lifecycle</dt><dd><StatusBadge status={i.lifecycle} /></dd>
              {i.previousDepartment && (<><dt>Pindah dari</dt><dd>{i.previousDepartment} ({fmtDate(i.departmentChangedAt)})</dd></>)}
              <dt>Last login</dt><dd>{i.lastLogin ? `${fmtDate(i.lastLogin)} (${daysSince(i.lastLogin)} hari)` : 'never'}</dd>
              <dt>Created</dt><dd>{fmtDate(i.sourceCreatedAt)}</dd>
              <dt>Source</dt><dd><Badge>{i.source}</Badge></dd>
            </dl>
          </Card>
          <Card title="Reviewer hierarchy" sub="Rantai manager yang dipakai untuk reviewer & eskalasi">
            {data.managerChain.length ? (
              <ol style={{ margin: 0, paddingLeft: 18 }}>
                {data.managerChain.map((m: any, idx: number) => (
                  <li key={m._id} style={{ marginBottom: 6 }}>
                    <Link href={`/identities/${m._id}`}>{m.displayName}</Link> <span className="muted small">— {m.title}</span>
                    <div className="small muted">{idx === 0 ? 'Level 1 · manager' : idx === 1 ? 'Level 2 · manager of manager' : `Level ${idx + 1}`}</div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="muted small">Tidak memiliki manager — reviewer akan jatuh ke fallback.</div>
            )}
            {!!data.directReports.length && <div className="small mt"><b>{data.directReports.length}</b> direct reports</div>}
          </Card>
        </div>
        <Card flush>
          <div style={{ padding: '6px 14px 0' }}>
            <Tabs value={tab} onChange={setTab} tabs={[{ key: 'access', label: 'Access', count: data.access.length }, { key: 'sod', label: 'SoD', count: data.violations.length }, { key: 'certs', label: 'Certifications', count: data.certifications.length }, ...(canSeeActivity ? [{ key: 'activity', label: 'Okta Activity', count: activity.data?.total }] : [])]} />
          </div>
          {tab === 'access' && (
            <DataTable
              rows={data.access}
              columns={[
                { key: 'entitlement', label: 'Entitlement', render: (r: any) => (<div><div className="cell-title">{r.entitlement}</div><div className="cell-sub">{r.application || r.kind}</div></div>) },
                { key: 'riskLevel', label: 'Risk', render: (r: any) => (<span className="row" style={{ gap: 4 }}><RiskBadge level={r.riskLevel} />{r.privileged && <Badge tone="purple">privileged</Badge>}</span>) },
                { key: 'grantedAt', label: 'Granted', render: (r: any) => fmtDate(r.grantedAt) },
                { key: 'lastUsedAt', label: 'Last used', render: (r: any) => { const d = daysSince(r.lastUsedAt); return d === null ? <Badge tone="warning">never</Badge> : d > 90 ? <Badge tone="warning">{d} hari</Badge> : `${d} hari lalu`; } },
              ]}
            />
          )}
          {tab === 'sod' && (
            <DataTable
              rows={data.violations}
              empty={<div className="empty">Tidak ada pelanggaran SoD</div>}
              columns={[
                { key: 'policy', label: 'Policy', render: (r: any) => (<div><div className="cell-title">{r.policyId?.name}</div><div className="cell-sub">{r.policyId?.category}</div></div>) },
                { key: 'conflict', label: 'Konflik', render: (r: any) => (<div className="small">{r.matchedA.map((e: any) => e.name).join(', ')} <b>⇄</b> {r.matchedB.map((e: any) => e.name).join(', ')}</div>) },
                { key: 'severity', label: 'Severity', render: (r: any) => <RiskBadge level={r.severity} /> },
                { key: 'status', label: 'Status', render: (r: any) => <StatusBadge status={r.status} /> },
              ]}
            />
          )}
          {tab === 'certs' && (
            <DataTable
              rows={data.certifications}
              empty={<div className="empty">Belum pernah direview</div>}
              columns={[
                { key: 'campaign', label: 'Campaign', render: (r: any) => <Link href={`/campaigns/${r.campaignId?._id}`}>{r.campaignId?.name}</Link> },
                { key: 'entitlement', label: 'Entitlement', render: (r: any) => r.entitlementId?.name },
                { key: 'reviewer', label: 'Reviewer' },
                { key: 'decision', label: 'Decision', render: (r: any) => <StatusBadge status={r.decision} /> },
                { key: 'decidedAt', label: 'Tanggal', render: (r: any) => fmtDate(r.decidedAt) },
              ]}
            />
          )}
          {tab === 'activity' && (activity.loading && !activity.data ? <Loading /> : <>
            <OktaEventsTable rows={activity.data?.items || []} compact />
            {activity.data?.total > 100 && <div className="small muted" style={{ padding: 14 }}>Menampilkan 100 event terbaru dari {activity.data.total}. Lihat semua di <Link href={`/okta-activity`}>Okta Activity</Link>.</div>}
          </>)}
        </Card>
      </div>
    </>
  );
}
