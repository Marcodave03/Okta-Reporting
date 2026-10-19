'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { fmtDate, useApi } from '@/lib/client';
import { Badge, Card, DataTable, Loading, PageHeader, Progress, StatusBadge, Tabs } from '@/components/ui';
import { useIsAdmin } from '@/components/UserContext';

export default function CampaignsPage() {
  const router = useRouter();
  const admin = useIsAdmin();
  const { data, loading } = useApi<any>('/api/campaigns');
  const [tab, setTab] = useState('active');
  const items = (data?.items || []).filter((c: any) => (tab === 'all' ? true : tab === 'overdue' ? c.overdue : c.status === tab));
  const count = (s: string) => (data?.items || []).filter((c: any) => (s === 'overdue' ? c.overdue : c.status === s)).length;
  return (
    <>
      <PageHeader
        title="Certification Campaigns"
        subtitle="Access review berbasis department, aplikasi, role, risk, mover, leaver, dormant, privileged, atau non-human — sekali jalan atau terjadwal berulang."
        actions={admin && <Link href="/campaigns/new" className="btn btn-primary"><Plus size={15} /> New campaign</Link>}
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'active', label: 'Active', count: count('active') },
          { key: 'overdue', label: 'Overdue', count: count('overdue') },
          { key: 'scheduled', label: 'Scheduled', count: count('scheduled') },
          { key: 'completed', label: 'Completed', count: count('completed') },
          { key: 'draft', label: 'Draft', count: count('draft') },
          { key: 'all', label: 'All' },
        ]}
      />
      <Card flush>
        {loading ? <Loading /> : (
          <DataTable
            rows={items}
            onRowClick={(r: any) => router.push(`/campaigns/${r._id}`)}
            empty={<div className="empty">Tidak ada campaign di tab ini</div>}
            columns={[
              { key: 'name', label: 'Campaign', render: (r: any) => (<div><div className="cell-title">{r.name}</div><div className="cell-sub">{data.scopeTypes[r.scopeType]}</div></div>) },
              { key: 'status', label: 'Status', render: (r: any) => (<span className="row" style={{ gap: 4 }}><StatusBadge status={r.status} />{r.overdue && <Badge tone="danger">overdue</Badge>}{r.isTemplate && <Badge tone="purple">recurring</Badge>}</span>) },
              { key: 'reviewers', label: 'Reviewer hierarchy', render: (r: any) => <span className="small">{(r.reviewerHierarchy || []).join(' → ')}</span> },
              { key: 'schedule', label: 'Schedule', render: (r: any) => (r.status === 'scheduled' ? (<div className="small">next: <b>{fmtDate(r.nextRunAt)}</b><div className="cell-sub">{r.recurrence !== 'none' ? r.recurrence : 'one-time'}</div></div>) : (<div className="small">{fmtDate(r.launchedAt)} → {fmtDate(r.dueDate)}</div>)) },
              {
                key: 'progress',
                label: 'Progress',
                width: 190,
                render: (r: any) => {
                  const s = r.stats || {};
                  const pct = s.total ? Math.round(((s.total - s.pending) / s.total) * 100) : 0;
                  return r.status === 'scheduled' || r.status === 'draft' ? <span className="muted">—</span> : (
                    <div>
                      <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><Progress value={pct} /><span className="small nowrap">{pct}%</span></div>
                      <div className="cell-sub">{s.total || 0} item · {s.revoked || 0} revoked · {s.pending || 0} pending</div>
                    </div>
                  );
                },
              },
            ]}
          />
        )}
      </Card>
    </>
  );
}
