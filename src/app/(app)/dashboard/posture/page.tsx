'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Play, RefreshCw } from 'lucide-react';
import { api, fmtDateTime, useApi } from '@/lib/client';
import { Badge, Button, Card, DataTable, ErrorBox, Loading, PageHeader, RiskBadge, Stat, StatusBadge, Tabs, TypeBadge, toast, toastError } from '@/components/ui';
import { Bars, StackedArea, useColors } from '@/components/charts';
import { useIsAdmin } from '@/components/UserContext';

const RANGES = [
  { key: '24h', label: '24 jam' },
  { key: '7d', label: '7 hari' },
  { key: '30d', label: '30 hari' },
];
// sinyal yang digambar (≤5 seri, urutan warna kategorikal tetap); sisanya tampil di tabel total
const CHART_SIGNALS = ['failedLogin', 'threat', 'lockout', 'privilege', 'mfaWeakened'];

const hourLabel = (t: number, range: string) =>
  new Date(t).toLocaleString('id-ID', range === '24h' ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function PosturePage() {
  const admin = useIsAdmin();
  const c = useColors();
  const [range, setRange] = useState('24h');
  const { data, loading, error, reload } = useApi<any>(`/api/posture?range=${range}`);
  const [hourIdx, setHourIdx] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => setHourIdx(null), [range, data]);

  const sod = useMemo(() => (data?.sodHourly || []).map((p: any) => ({ ...p, label: hourLabel(p.t, range) })), [data, range]);
  const signals = useMemo(() => (data?.signalsHourly || []).map((p: any) => ({ ...p, label: hourLabel(p.t, range) })), [data, range]);
  const sigLabel = useMemo(() => Object.fromEntries((data?.signals || []).map((s: any) => [s.key, s.label])), [data]);
  const sel = sod.length ? sod[hourIdx ?? sod.length - 1] : null;

  const scan = async () => {
    setScanning(true);
    try {
      const r = await api('/api/sod/scan', { method: 'POST' });
      toast(`SoD scan selesai: ${r.violationsFound} pelanggaran (${r.newViolations} baru) dari ${r.policies} policy`, 'success');
      reload();
    } catch (e) { toastError(e); } finally { setScanning(false); }
  };

  const k = data?.kpis || {};
  const scoreTone = (data?.score?.value ?? 100) >= 80 ? 'success' : (data?.score?.value ?? 100) >= 60 ? 'warning' : 'danger';

  return (
    <>
      <PageHeader
        title="Identity Security Posture"
        subtitle={<>Pelanggaran SoD per jam direkonstruksi dari assignment Okta + event membership System Log, ditambah sinyal keamanan identitas (failed sign-in, threat, privilege grant, MFA). {data?.generatedAt && <span className="small">· diperbarui {new Date(data.generatedAt).toLocaleTimeString('id-ID')}</span>}</>}
        actions={<>
          <Tabs value={range} onChange={setRange} tabs={RANGES} />
          <Button size="sm" icon={<RefreshCw size={13} className={loading ? 'spin' : ''} />} onClick={reload}>Refresh</Button>
          {admin && <Button size="sm" variant="primary" icon={<Play size={13} />} loading={scanning} onClick={scan}>Run SoD scan</Button>}
        </>}
      />
      {error && <ErrorBox error={error} />}
      {loading && !data ? <Loading /> : data && (
        <div className="stack">
          {data.policies === 0 && (
            <div className="callout warning small">
              Belum ada SoD policy aktif yang cocok dengan entitlement Okta — tanpa policy tidak ada pelanggaran yang bisa terdeteksi. Aktifkan template di <Link href="/sod/policies">SoD Policies › Predefined library</Link>.
            </div>
          )}
          <div className="small muted">
            Okta sync terakhir: <b>{fmtDateTime(data.lastSync)}</b> · System Log terakhir ditarik: <b>{fmtDateTime(data.lastEventsPull)}</b> · {data.policies} policy SoD aktif
          </div>

          <div className="grid grid-4">
            <Stat label="Posture score" value={<span style={{ color: `var(--${scoreTone})` }}>{data.score.value}<span className="small muted">/100</span></span>} hint="100 dikurangi penalti — lihat rincian di bawah" />
            <Link href="/sod/violations" className="kpi-link"><Stat label="Users in SoD violation" value={<span style={{ color: k.usersInViolation ? 'var(--danger)' : 'var(--success)' }}>{k.usersInViolation}</span>} hint={`${k.openViolations} open violation · ${k.mitigated} mitigated/accepted`} /></Link>
            <Link href="/sod/violations?severity=critical" className="kpi-link"><Stat label="Critical / high SoD" value={`${k.critical} / ${k.high}`} hint="pelanggaran open" /></Link>
            <Stat label="Privileged identities" value={k.privileged} hint={`${k.dormantPrivileged} dormant >90 hari`} />
          </div>
          <div className="grid grid-4">
            <Stat label="Failed sign-in (24j)" value={k.failedLogins24h} hint="FAILURE/DENY pada login & MFA" />
            <Stat label="Threat signals (24j)" value={k.threats24h} hint={`${k.lockouts24h} account lockout`} />
            <Stat label="Admin privilege grants (7h)" value={k.privilegeGrants7d} hint="user/group.privilege.grant" />
            <Stat label="MFA factor removed (7h)" value={k.mfaWeakened7d} hint="deactivate / reset_all / suspend" />
          </div>

          <Card title="Users in SoD violation per jam" sub={data.peak && `puncak ${data.peak.users} user · ${hourLabel(data.peak.t, range)} · dikelompokkan per severity tertinggi`}>
            <StackedArea data={sod} x="label" height={260} series={[
              { key: 'critical', label: 'Critical', color: c.status.critical },
              { key: 'high', label: 'High', color: c.status.high },
              { key: 'medium', label: 'Medium', color: c.status.medium },
              { key: 'low', label: 'Low', color: c.status.low },
            ]} />
          </Card>

          <div className="grid grid-2">
            <Card title="User yang melanggar pada jam tertentu" sub="geser untuk memilih jam">
              {sel && (
                <div className="stack" style={{ gap: 10 }}>
                  <input type="range" min={0} max={sod.length - 1} value={hourIdx ?? sod.length - 1} onChange={(e) => setHourIdx(Number(e.target.value))} aria-label="Pilih jam" />
                  <div className="row"><b>{hourLabel(sel.t, '7d')}</b><span className="muted small">{sel.users} user · {sel.introduced} konflik baru · {sel.resolved} selesai di jam ini</span></div>
                  {sel.who.length ? (
                    <div className="table-wrap" style={{ maxHeight: 260 }}>
                      <table className="table">
                        <thead><tr><th>User</th><th>Policy dilanggar</th></tr></thead>
                        <tbody>{sel.who.map((w: any) => (
                          <tr key={w.id}><td><Link className="cell-title" href={`/identities/${w.id}`}>{w.name}</Link><div className="cell-sub">{w.department || w.login}</div></td><td className="small">{w.policies.join(' · ')}</td></tr>
                        ))}</tbody>
                      </table>
                    </div>
                  ) : <div className="empty">✅ Tidak ada user dengan akses konflik pada jam ini</div>}
                </div>
              )}
            </Card>
            <Card title="Konflik SoD muncul vs selesai per jam" sub="dari event group/app membership Okta">
              <Bars data={sod} x="label" height={240} series={[
                { key: 'introduced', label: 'Konflik muncul', color: c.status.critical },
                { key: 'resolved', label: 'Konflik selesai', color: c.status.low },
              ]} />
            </Card>
          </div>

          <Card title="Current SoD violators" sub="hasil SoD scan terakhir (open, mitigated, accepted)" flush>
            <DataTable
              rows={data.violators}
              empty={<div className="empty">✅ Tidak ada user yang melanggar SoD</div>}
              columns={[
                { key: 'identity', label: 'Identity', render: (r: any) => (<div><Link className="cell-title" href={`/identities/${r._id}`}>{r.identity.displayName}</Link><div className="cell-sub row" style={{ gap: 4 }}>{r.identity.department || r.identity.login}{r.identity.identityType !== 'human' && <TypeBadge type={r.identity.identityType} />}</div></div>) },
                { key: 'severity', label: 'Severity', render: (r: any) => <RiskBadge level={r.severity} /> },
                {
                  key: 'violations', label: 'Policy & akses konflik', render: (r: any) => (
                    <div className="stack" style={{ gap: 6, maxWidth: 520 }}>
                      {r.violations.map((v: any, i: number) => (
                        <div key={i} className="small">
                          <div><b>{v.policy}</b> <StatusBadge status={v.status} /></div>
                          <div className="muted">{v.a.join(', ')} <b style={{ color: 'var(--danger)' }}>⇄</b> {v.b.join(', ')}</div>
                          {v.introducedAt && <div className="muted">muncul {fmtDateTime(v.introducedAt)} oleh {v.introducedBy}</div>}
                        </div>
                      ))}
                    </div>
                  ),
                },
                { key: 'risk', label: 'Risk', render: (r: any) => <b>{r.identity.riskScore}</b> },
                { key: 'since', label: 'Detected', render: (r: any) => fmtDateTime(r.since) },
              ]}
            />
          </Card>

          <Card title="SoD change timeline" sub="setiap penambahan/pencabutan akses Okta yang memunculkan atau menyelesaikan konflik" flush>
            <DataTable
              rows={data.sodTimeline.map((t: any, i: number) => ({ ...t, _id: `${t.at}-${i}` }))}
              empty={<div className="empty">Tidak ada perubahan akses yang memengaruhi SoD pada rentang ini</div>}
              columns={[
                { key: 'at', label: 'Waktu', render: (t: any) => <span className="nowrap">{fmtDateTime(t.at)}</span> },
                { key: 'change', label: 'Perubahan', render: (t: any) => <Badge tone={t.change === 'introduced' ? 'danger' : 'success'}>{t.change === 'introduced' ? 'konflik muncul' : 'konflik selesai'}</Badge> },
                { key: 'user', label: 'User', render: (t: any) => <Link className="cell-title" href={`/identities/${t.identityId}`}>{t.identity?.name}</Link> },
                { key: 'policy', label: 'Policy', render: (t: any) => (<div><div>{t.policy}</div><RiskBadge level={t.severity} /></div>) },
                { key: 'ent', label: 'Akses', render: (t: any) => <span className="small">{t.change === 'introduced' ? '+ ' : '− '}{t.entitlement}</span> },
                { key: 'actor', label: 'Oleh', render: (t: any) => (<div className="small"><div>{t.actor}</div><div className="mono muted">{t.eventType}</div></div>) },
              ]}
            />
          </Card>

          <div className="grid grid-2">
            <Card title="Sinyal keamanan Okta per jam" sub="System Log: failed sign-in, threat, lockout, privilege grant, MFA removed">
              <Bars data={signals} x="label" stacked height={240} series={CHART_SIGNALS.map((key) => ({ key, label: sigLabel[key] || key }))} />
            </Card>
            <Card title="Total sinyal pada rentang ini" flush>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Sinyal</th><th style={{ textAlign: 'right' }}>Jumlah</th></tr></thead>
                  <tbody>{data.signals.map((s: any) => <tr key={s.key}><td>{s.label}</td><td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><b>{s.total}</b></td></tr>)}</tbody>
                </table>
              </div>
            </Card>
          </div>

          <div className="grid grid-2">
            <Card title="High-signal security events" sub="40 terbaru (tanpa Admin Console access & policy change)" flush>
              <DataTable
                rows={data.securityEvents}
                empty={<div className="empty">Tidak ada sinyal keamanan pada rentang ini</div>}
                columns={[
                  { key: 'at', label: 'Waktu', render: (e: any) => <span className="nowrap small">{fmtDateTime(e.at)}</span> },
                  { key: 'signal', label: 'Sinyal', render: (e: any) => (<div><Badge tone={['threat', 'lockout', 'failedLogin'].includes(e.signal) ? 'danger' : 'warning'}>{sigLabel[e.signal]}</Badge><div className="mono muted">{e.eventType}</div></div>) },
                  { key: 'user', label: 'User', render: (e: any) => (<div className="small"><div>{e.user}</div>{e.actor !== e.user && <div className="muted">oleh {e.actor}</div>}</div>) },
                  { key: 'msg', label: 'Detail', render: (e: any) => (<div className="small" style={{ maxWidth: 260 }}><div>{e.message}</div><div className="muted">{[e.outcome, e.reason, e.ip, e.location].filter(Boolean).join(' · ')}</div></div>) },
                ]}
              />
            </Card>
            <Card title="Rincian posture score" flush>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Area</th><th style={{ textAlign: 'right' }}>Penalti</th></tr></thead>
                  <tbody>
                    {data.score.deductions.map((d: any) => <tr key={d.label}><td className="small">{d.label}</td><td style={{ textAlign: 'right' }}><b style={{ color: d.points ? 'var(--danger)' : undefined }}>−{d.points}</b></td></tr>)}
                    <tr><td><b>Score</b></td><td style={{ textAlign: 'right' }}><b>{data.score.value}/100</b></td></tr>
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
