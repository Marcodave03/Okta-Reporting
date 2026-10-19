'use client';
import Link from 'next/link';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Eye, EyeOff, Plus, RotateCcw, Save, Send, Settings2, Table2, X, CalendarClock } from 'lucide-react';
import { api, download, useApi } from '@/lib/client';
import { Badge, Button, Card, DataTable, ErrorBox, Loading, PageHeader, Progress, RiskBadge, TypeBadge, toast, toastError } from './ui';
import { Bars, Donut, Lines, StackedArea, useColors } from './charts';

type M = any;
type C = ReturnType<typeof useColors>;
type WidgetDef = { title: string; size: number; kind: 'kpi' | 'chart' | 'table'; href?: string; render: (m: M, c: C) => ReactNode; table?: (m: M) => { cols: string[]; rows: any[][] } };

const kpi = (key: string, title: string, href?: string, opts: { suffix?: string; tone?: (v: number) => string; hint?: (m: M) => string } = {}): WidgetDef => ({
  title,
  size: 1,
  kind: 'kpi',
  href,
  render: (m) => {
    const v = m.kpiMap?.[key]?.value ?? 0;
    return (
      <div className="kpi" style={{ padding: 0 }}>
        <div className="kpi-value" style={{ color: opts.tone ? `var(--${opts.tone(v)})` : undefined }}>
          {typeof v === 'number' ? v.toLocaleString('id-ID') : v}
          {opts.suffix}
        </div>
        {opts.hint && <div className="kpi-hint">{opts.hint(m)}</div>}
      </div>
    );
  },
});
const tbl = (rows: any[], cols: [string, string][]) => ({ cols: cols.map((c) => c[1]), rows: rows.map((r) => cols.map((c) => r[c[0]])) });
const sevSeries = (c: C) => [
  { key: 'critical', label: 'Critical', color: c.status.critical },
  { key: 'high', label: 'High', color: c.status.high },
  { key: 'medium', label: 'Medium', color: c.status.medium },
  { key: 'low', label: 'Low', color: c.status.low },
];

export const WIDGETS: Record<string, WidgetDef> = {
  /* ---------- KPI ---------- */
  kpi_identities: kpi('identities', 'Total Identities', '/identities', { hint: (m) => `${m.kpiMap?.human?.value ?? 0} human · ${m.kpiMap?.nonHuman?.value ?? 0} non-human` }),
  kpi_human: kpi('human', 'Human Identities', '/identities?type=human'),
  kpi_nonhuman: kpi('nonHuman', 'Non-Human Identities', '/identities?type=non_human', { hint: () => 'service account · bot · API' }),
  kpi_highrisk: kpi('highRisk', 'High / Critical Risk', '/identities?riskLevel=high', { tone: (v) => (v > 0 ? 'danger' : 'success') }),
  kpi_orgrisk: kpi('orgRisk', 'Org Risk Score', undefined, { suffix: '/100', tone: (v) => (v >= 50 ? 'danger' : v >= 25 ? 'warning' : 'success'), hint: () => 'rata-rata risk score identitas' }),
  kpi_sodopen: kpi('sodOpen', 'Open SoD Violations', '/sod/violations', { tone: (v) => (v > 0 ? 'danger' : 'success') }),
  kpi_certcompletion: kpi('certCompletion', 'Certification Completion', '/dashboard/certifications', { suffix: '%' }),
  kpi_overdue: kpi('overdue', 'Overdue Review Items', '/campaigns', { tone: (v) => (v > 0 ? 'warning' : 'success') }),
  kpi_activecampaigns: kpi('activeCampaigns', 'Active Campaigns', '/campaigns'),
  kpi_privileged: kpi('privileged', 'Privileged Assignments', '/applications'),
  kpi_dormant: kpi('dormant', 'Dormant Accounts (90d)', '/identities?dormant=1', { tone: (v) => (v > 0 ? 'warning' : 'success') }),
  kpi_pending: kpi('pending', 'Pending Reviews', '/reviews'),
  kpi_overdueitems: kpi('overdueItems', 'Overdue Items', '/campaigns', { tone: (v) => (v > 0 ? 'danger' : 'success') }),
  kpi_overduecampaigns: kpi('overdueCampaigns', 'Overdue Campaigns', '/campaigns', { tone: (v) => (v > 0 ? 'danger' : 'success') }),
  kpi_revokerate: kpi('revokeRate', 'Revoke Rate', undefined, { suffix: '%' }),
  kpi_sodcritical: kpi('sodCritical', 'Critical Violations', '/sod/violations?severity=critical', { tone: (v) => (v > 0 ? 'danger' : 'success') }),
  kpi_sodhigh: kpi('sodHigh', 'High Violations', '/sod/violations?severity=high'),
  kpi_sodmitigated: kpi('sodMitigated', 'Mitigated / Accepted', '/sod/violations?status=mitigated'),
  kpi_sodresolved: kpi('sodResolved', 'Remediated (30d)', '/sod/violations?status=remediated', { tone: () => 'success' }),
  kpi_policies: kpi('policies', 'Active SoD Policies', '/sod/policies'),

  /* ---------- Identity & risk ---------- */
  human_vs_nonhuman: {
    title: 'Human vs Non-Human',
    size: 1,
    kind: 'chart',
    render: (m) => <Donut data={m.humanVsNonHuman} center={{ value: m.kpiMap?.identities?.value, label: 'identities' }} />,
    table: (m) => tbl(m.humanVsNonHuman, [['name', 'Kategori'], ['value', 'Jumlah']]),
  },
  identity_types: {
    title: 'Identity Types',
    size: 1,
    kind: 'chart',
    render: (m) => <Donut data={m.identityTypes} />,
    table: (m) => tbl(m.identityTypes, [['name', 'Tipe'], ['value', 'Jumlah']]),
  },
  identity_status: {
    title: 'Okta Status',
    size: 1,
    kind: 'chart',
    render: (m) => <Donut data={m.statuses} />,
    table: (m) => tbl(m.statuses, [['name', 'Status'], ['value', 'Jumlah']]),
  },
  risk_distribution: {
    title: 'Risk Distribution',
    size: 2,
    kind: 'chart',
    render: (m, c) => <Bars data={m.riskDistribution} series={[{ key: 'value', label: 'Identities' }]} colorFor={(r) => c.status[r.name]} height={220} />,
    table: (m) => tbl(m.riskDistribution, [['name', 'Risk level'], ['value', 'Identities']]),
  },
  lifecycle: {
    title: 'Lifecycle (Joiner / Mover / Leaver)',
    size: 2,
    kind: 'chart',
    render: (m) => <Bars data={m.lifecycle} series={[{ key: 'value', label: 'Identities' }]} height={220} />,
    table: (m) => tbl(m.lifecycle, [['name', 'Lifecycle'], ['value', 'Identities']]),
  },
  risk_trend: {
    title: 'Average Risk Score — 90 hari',
    size: 2,
    kind: 'chart',
    render: (m) => <Lines data={m.riskTrend} series={[{ key: 'avgRisk', label: 'Avg risk score' }]} height={220} />,
    table: (m) => tbl(m.riskTrend, [['day', 'Tanggal'], ['avgRisk', 'Avg risk'], ['highRisk', 'High risk identities']]),
  },
  high_risk_trend: {
    title: 'High-Risk Identities — 90 hari',
    size: 2,
    kind: 'chart',
    render: (m, c) => <Lines data={m.riskTrend} series={[{ key: 'highRisk', label: 'High/critical identities', color: c.status.high }]} height={220} />,
    table: (m) => tbl(m.riskTrend, [['day', 'Tanggal'], ['highRisk', 'High risk identities']]),
  },
  top_risky: {
    title: 'Top 10 Risky Identities',
    size: 2,
    kind: 'table',
    render: (m) => (
      <DataTable
        rows={m.topRisky}
        columns={[
          { key: 'displayName', label: 'Identity', render: (r: any) => <Link href={`/identities/${r._id}`}>{r.displayName}</Link> },
          { key: 'department', label: 'Dept' },
          { key: 'identityType', label: 'Type', render: (r: any) => <TypeBadge type={r.identityType} /> },
          { key: 'riskScore', label: 'Score', render: (r: any) => <b>{r.riskScore}</b> },
          { key: 'riskLevel', label: 'Level', render: (r: any) => <RiskBadge level={r.riskLevel} /> },
        ]}
      />
    ),
  },

  /* ---------- Certification ---------- */
  campaign_progress: {
    title: 'Campaign Completion',
    size: 2,
    kind: 'table',
    render: (m) => (
      <DataTable
        rows={m.campaignProgress}
        rowKey={(r: any) => String(r.id)}
        columns={[
          { key: 'name', label: 'Campaign', render: (r: any) => <Link href={`/campaigns/${r.id}`} title={r.fullName}>{r.name}</Link> },
          { key: 'status', label: 'Status', render: (r: any) => (r.overdue ? <Badge tone="danger">overdue</Badge> : <Badge tone={r.status === 'completed' ? 'success' : 'info'}>{r.status}</Badge>) },
          { key: 'completion', label: 'Progress', width: 160, render: (r: any) => (<div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><Progress value={r.completion} /><span className="small nowrap">{r.completion}%</span></div>) },
          { key: 'pending', label: 'Pending' },
          { key: 'dueDate', label: 'Due' },
        ]}
      />
    ),
  },
  decisions: {
    title: 'Review Decisions',
    size: 1,
    kind: 'chart',
    render: (m, c) => <Donut data={m.decisions} colorFor={(n) => c.status[n.toLowerCase()]} center={{ value: `${m.kpiMap?.certCompletion?.value ?? 0}%`, label: 'complete' }} />,
    table: (m) => tbl(m.decisions, [['name', 'Keputusan'], ['value', 'Item']]),
  },
  decision_trend: {
    title: 'Decisions per Day — 30 hari',
    size: 2,
    kind: 'chart',
    render: (m, c) => (
      <Bars data={m.decisionTrend} x="day" stacked series={[{ key: 'approved', label: 'Approved', color: c.status.approved }, { key: 'revoked', label: 'Revoked', color: c.status.revoked }]} height={220} />
    ),
    table: (m) => tbl(m.decisionTrend, [['day', 'Tanggal'], ['approved', 'Approved'], ['revoked', 'Revoked']]),
  },
  overdue_campaigns: {
    title: 'Overdue Certifications',
    size: 2,
    kind: 'table',
    render: (m) =>
      m.overdueCampaigns.length ? (
        <DataTable
          rows={m.overdueCampaigns}
          rowKey={(r: any) => String(r.id)}
          columns={[
            { key: 'name', label: 'Campaign', render: (r: any) => <Link href={`/campaigns/${r.id}`}>{r.name}</Link> },
            { key: 'daysOverdue', label: 'Overdue', render: (r: any) => <Badge tone="danger">{r.daysOverdue} hari</Badge> },
            { key: 'pending', label: 'Pending' },
            { key: 'completion', label: 'Done', render: (r: any) => `${r.completion}%` },
          ]}
        />
      ) : (
        <div className="empty">✅ Tidak ada campaign overdue</div>
      ),
  },
  reviewer_workload: {
    title: 'Reviewer Workload (active campaigns)',
    size: 2,
    kind: 'table',
    render: (m) => (
      <DataTable
        rows={m.reviewerWorkload}
        rowKey={(r: any) => r.reviewer}
        columns={[
          { key: 'reviewer', label: 'Reviewer' },
          { key: 'pending', label: 'Pending' },
          { key: 'overdue', label: 'Overdue', render: (r: any) => (r.overdue ? <Badge tone="danger">{r.overdue}</Badge> : 0) },
          { key: 'completion', label: 'Done', width: 140, render: (r: any) => (<div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><Progress value={r.completion} /><span className="small">{r.completion}%</span></div>) },
        ]}
      />
    ),
  },
  upcoming_campaigns: {
    title: 'Scheduled Campaigns',
    size: 2,
    kind: 'table',
    render: (m) => (
      <DataTable
        rows={m.upcoming}
        rowKey={(r: any) => String(r.id)}
        empty={<div className="empty">Belum ada campaign terjadwal</div>}
        columns={[
          { key: 'name', label: 'Campaign', render: (r: any) => <Link href={`/campaigns/${r.id}`}>{r.name}</Link> },
          { key: 'scopeType', label: 'Scope', render: (r: any) => <Badge>{r.scopeType}</Badge> },
          { key: 'recurrence', label: 'Recurrence' },
          { key: 'nextRunAt', label: 'Next run' },
        ]}
      />
    ),
  },

  /* ---------- SoD ---------- */
  sod_trend: {
    title: 'SoD Violation Trend — 90 hari',
    size: 3,
    kind: 'chart',
    render: (m, c) => <StackedArea data={m.sodTrend} series={sevSeries(c)} />,
    table: (m) => tbl(m.sodTrend, [['day', 'Tanggal'], ['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low'], ['open', 'Total open']]),
  },
  sod_by_severity: {
    title: 'Open Violations by Severity',
    size: 1,
    kind: 'chart',
    render: (m, c) => <Donut data={m.sodBySeverity} colorFor={(n) => c.status[n]} center={{ value: m.kpiMap?.sodOpen?.value, label: 'open' }} />,
    table: (m) => tbl(m.sodBySeverity, [['name', 'Severity'], ['value', 'Open']]),
  },
  sod_by_status: {
    title: 'Violations by Status',
    size: 1,
    kind: 'chart',
    render: (m, c) => <Donut data={m.sodByStatus} colorFor={(n) => c.status[n]} />,
    table: (m) => tbl(m.sodByStatus, [['name', 'Status'], ['value', 'Jumlah']]),
  },
  sod_by_policy: {
    title: 'Open Violations by Policy',
    size: 2,
    kind: 'chart',
    render: (m) => <Bars data={m.sodByPolicy} horizontal series={[{ key: 'value', label: 'Open violations' }]} />,
    table: (m) => tbl(m.sodByPolicy, [['name', 'Policy'], ['value', 'Open']]),
  },
  sod_by_department: {
    title: 'Open Violations by Department',
    size: 2,
    kind: 'chart',
    render: (m) => <Bars data={m.sodByDepartment} series={[{ key: 'value', label: 'Open violations' }]} height={240} />,
    table: (m) => tbl(m.sodByDepartment, [['name', 'Department'], ['value', 'Open']]),
  },
  risk_histogram: {
    title: 'Risk Score Distribution (0-100)',
    size: 2,
    kind: 'chart',
    render: (m) => <Bars data={m.riskHistogram} x="range" series={[{ key: 'count', label: 'Identities' }]} height={240} />,
    table: (m) => tbl(m.riskHistogram, [['range', 'Score'], ['count', 'Identities']]),
  },
  top_violators: {
    title: 'Top Violators (risk scoring)',
    size: 2,
    kind: 'table',
    render: (m) => (
      <DataTable
        rows={m.topViolators}
        rowKey={(r: any) => r.id}
        columns={[
          { key: 'name', label: 'Identity', render: (r: any) => <Link href={`/identities/${r.id}`}>{r.name}</Link> },
          { key: 'department', label: 'Dept' },
          { key: 'violations', label: 'Violations', render: (r: any) => <Badge tone="danger">{r.violations}</Badge> },
          { key: 'riskScore', label: 'Risk', render: (r: any) => (<span className="row" style={{ gap: 6 }}><b>{r.riskScore}</b><RiskBadge level={r.riskLevel} /></span>) },
        ]}
      />
    ),
  },
};

export const DASHBOARDS: Record<string, { title: string; subtitle: string; defaults: string[]; export?: { dataset: string; name: string } }> = {
  executive: {
    title: 'Executive Overview',
    subtitle: 'Postur risiko identitas tingkat tinggi — human & non-human, SoD, dan certification.',
    defaults: ['kpi_identities', 'kpi_nonhuman', 'kpi_highrisk', 'kpi_orgrisk', 'kpi_sodopen', 'kpi_certcompletion', 'kpi_overdue', 'kpi_dormant', 'human_vs_nonhuman', 'identity_types', 'risk_distribution', 'risk_trend', 'sod_by_severity', 'decisions', 'top_risky', 'lifecycle'],
    export: { dataset: 'executive_summary', name: 'Executive Summary' },
  },
  certification: {
    title: 'Certification Status',
    subtitle: 'Status campaign, item overdue, dan completion rate access review.',
    defaults: ['kpi_activecampaigns', 'kpi_certcompletion', 'kpi_pending', 'kpi_overdueitems', 'campaign_progress', 'decisions', 'kpi_overduecampaigns', 'decision_trend', 'overdue_campaigns', 'reviewer_workload', 'upcoming_campaigns', 'kpi_revokerate'],
    export: { dataset: 'campaigns', name: 'Campaign Status' },
  },
  sod: {
    title: 'SoD & Risk',
    subtitle: 'Tren pelanggaran Separation of Duties, risk scoring, dan pelanggar teratas.',
    defaults: ['kpi_sodopen', 'kpi_sodcritical', 'kpi_sodhigh', 'kpi_sodresolved', 'sod_trend', 'sod_by_severity', 'sod_by_policy', 'sod_by_department', 'risk_histogram', 'top_violators', 'sod_by_status', 'kpi_policies'],
    export: { dataset: 'sod_violations', name: 'SoD Violations' },
  },
  custom: {
    title: 'My Dashboard',
    subtitle: 'Dashboard pribadi — tambahkan widget apa pun dari katalog.',
    defaults: ['kpi_identities', 'kpi_sodopen', 'kpi_certcompletion', 'kpi_highrisk', 'risk_trend', 'sod_trend'],
  },
};

type WState = { key: string; visible: boolean; size: number; title?: string };

function mergeLayout(dashKey: string, saved?: WState[] | null): WState[] {
  const defs = DASHBOARDS[dashKey].defaults;
  const base: WState[] = defs.map((k) => ({ key: k, visible: true, size: WIDGETS[k].size }));
  if (!saved?.length) return base;
  const known = saved.filter((w) => WIDGETS[w.key]);
  const missing = dashKey === 'custom' ? [] : base.filter((b) => !known.some((k) => k.key === b.key)).map((b) => ({ ...b, visible: false }));
  return [...known, ...missing];
}

function WidgetCard({ def, title, m, c }: { def: WidgetDef; title: string; m: M; c: C }) {
  const [asTable, setAsTable] = useState(false);
  if (def.kind === 'kpi') {
    const body = (
      <div className="card kpi">
        <div className="kpi-label">{title}</div>
        {def.render(m, c)}
      </div>
    );
    return def.href ? <Link href={def.href} className="kpi-link">{body}</Link> : body;
  }
  const t = asTable && def.table ? def.table(m) : null;
  return (
    <Card
      title={title}
      flush={def.kind === 'table' || !!t}
      actions={def.table && <Button size="sm" variant="ghost" icon={<Table2 size={14} />} title={asTable ? 'Tampilkan chart' : 'Tampilkan tabel'} onClick={() => setAsTable(!asTable)} />}
    >
      {t ? (
        <div className="table-wrap" style={{ maxHeight: 300 }}>
          <table className="table">
            <thead><tr>{t.cols.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{t.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        def.render(m, c)
      )}
    </Card>
  );
}

export function DashboardView({ dashKey, role }: { dashKey: keyof typeof DASHBOARDS; role?: string }) {
  const meta = DASHBOARDS[dashKey];
  const c = useColors();
  const metrics = useApi<M>('/api/metrics');
  const layoutRes = useApi<{ layout: any }>(`/api/dashboards/layout?key=${dashKey}`);
  const [widgets, setWidgets] = useState<WState[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);

  useEffect(() => {
    if (!layoutRes.loading) setWidgets(mergeLayout(dashKey, layoutRes.data?.layout?.widgets));
  }, [layoutRes.loading, layoutRes.data, dashKey]);

  const move = (i: number, d: number) => setWidgets((w) => {
    const n = [...w];
    const j = i + d;
    if (j < 0 || j >= n.length) return w;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const patch = (i: number, p: Partial<WState>) => setWidgets((w) => w.map((x, k) => (k === i ? { ...x, ...p } : x)));

  const save = async () => {
    setSaving(true);
    try {
      await api('/api/dashboards/layout', { method: 'PUT', body: { key: dashKey, widgets } });
      toast('Layout dashboard disimpan', 'success');
      setEditing(false);
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };
  const reset = async () => {
    await api(`/api/dashboards/layout?key=${dashKey}`, { method: 'DELETE' });
    setWidgets(mergeLayout(dashKey, null));
    toast('Layout dikembalikan ke default');
  };
  const exportAs = async (format: string) => {
    if (!meta.export) return;
    try {
      await download('/api/reports/export', { def: { name: meta.export.name, dataset: meta.export.dataset }, format });
    } catch (e) {
      toastError(e);
    }
  };
  const slackDigest = async () => {
    try {
      const r = await api('/api/slack/digest', { method: 'POST' });
      r.slack?.ok ? toast('Executive summary terkirim ke Slack Business Owner', 'success') : toast(`Slack: ${r.slack?.error}`, 'error');
    } catch (e) {
      toastError(e);
    }
  };

  const catalog = useMemo(() => Object.keys(WIDGETS).filter((k) => !widgets.some((w) => w.key === k)), [widgets]);
  const hidden = widgets.filter((w) => !w.visible);

  return (
    <>
      <PageHeader
        title={meta.title}
        subtitle={<>{meta.subtitle} {metrics.data?.generatedAt && <span className="small">· diperbarui {new Date(metrics.data.generatedAt).toLocaleTimeString('id-ID')}</span>}</>}
        actions={
          editing ? (
            <>
              {(dashKey === 'custom' || hidden.length > 0) && <Button icon={<Plus size={15} />} onClick={() => setShowCatalog(!showCatalog)}>Tambah widget</Button>}
              <Button icon={<RotateCcw size={15} />} onClick={reset}>Reset default</Button>
              <Button onClick={() => { setEditing(false); layoutRes.reload(); }}>Batal</Button>
              <Button variant="primary" icon={<Save size={15} />} loading={saving} onClick={save}>Simpan layout</Button>
            </>
          ) : (
            <>
              {meta.export && (
                <div className="row" style={{ gap: 4 }}>
                  {['pdf', 'xlsx', 'csv'].map((f) => (
                    <Button key={f} size="sm" icon={<Download size={13} />} onClick={() => exportAs(f)}>{f.toUpperCase()}</Button>
                  ))}
                </div>
              )}
              {role === 'admin' && <Link href="/reports/schedules" className="btn btn-secondary btn-sm"><CalendarClock size={13} /> Schedule</Link>}
              {dashKey === 'executive' && role === 'admin' && <Button size="sm" icon={<Send size={13} />} onClick={slackDigest}>Slack Business Owner</Button>}
              <Button size="sm" variant="primary" icon={<Settings2 size={13} />} onClick={() => setEditing(true)}>Customize</Button>
            </>
          )
        }
      />

      {editing && (
        <div className="callout info mb">
          <Settings2 size={16} />
          <div className="small">
            Mode kustomisasi: ubah judul, urutan (↑↓), ukuran (1–4 kolom), atau sembunyikan widget. Klik <b>Simpan layout</b> — layout tersimpan per user.
          </div>
        </div>
      )}

      {editing && showCatalog && (
        <Card title="Katalog widget" className="mb" actions={<Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => setShowCatalog(false)} />}>
          <div className="chip-list">
            {hidden.map((w) => (
              <button key={w.key} className="chip" style={{ cursor: 'pointer', border: '1px dashed var(--border-strong)' }} onClick={() => setWidgets((ws) => ws.map((x) => (x.key === w.key ? { ...x, visible: true } : x)))}>
                <Eye size={12} /> {w.title || WIDGETS[w.key].title}
              </button>
            ))}
            {dashKey === 'custom' &&
              catalog.map((k) => (
                <button key={k} className="chip" style={{ cursor: 'pointer' }} onClick={() => setWidgets((ws) => [...ws, { key: k, visible: true, size: WIDGETS[k].size }])}>
                  <Plus size={12} /> {WIDGETS[k].title}
                </button>
              ))}
          </div>
        </Card>
      )}

      {metrics.error && <ErrorBox error={metrics.error} />}
      {(metrics.loading && !metrics.data) || layoutRes.loading ? (
        <Loading />
      ) : metrics.data ? (
        <div className="dash-grid">
          {widgets.map((w, i) => {
            const def = WIDGETS[w.key];
            if (!def || (!w.visible && !editing)) return null;
            const title = w.title || def.title;
            return (
              <div key={w.key} className={`w s${w.size} ${editing ? 'editing' : ''}`} style={!w.visible ? { opacity: 0.45 } : undefined}>
                {editing && (
                  <div className="w-tools">
                    <input className="input" value={w.title ?? def.title} onChange={(e) => patch(i, { title: e.target.value })} aria-label="Judul widget" />
                    <Button size="sm" variant="ghost" icon={<ArrowUp size={13} />} onClick={() => move(i, -1)} title="Naik" />
                    <Button size="sm" variant="ghost" icon={<ArrowDown size={13} />} onClick={() => move(i, 1)} title="Turun" />
                    <select className="select" style={{ width: 62, height: 26, padding: '0 4px' }} value={w.size} onChange={(e) => patch(i, { size: Number(e.target.value) })} title="Lebar (kolom)">
                      {[1, 2, 3, 4].map((s) => <option key={s} value={s}>{s}/4</option>)}
                    </select>
                    <Button size="sm" variant="ghost" icon={w.visible ? <EyeOff size={13} /> : <Eye size={13} />} onClick={() => patch(i, { visible: !w.visible })} title={w.visible ? 'Sembunyikan' : 'Tampilkan'} />
                    {dashKey === 'custom' && <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => setWidgets((ws) => ws.filter((_, k) => k !== i))} title="Hapus" />}
                  </div>
                )}
                <WidgetCard def={def} title={title} m={metrics.data} c={c} />
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
