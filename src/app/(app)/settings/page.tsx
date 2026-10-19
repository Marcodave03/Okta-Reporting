'use client';
import { useEffect, useState } from 'react';
import { Check, Database, Plug, RefreshCw, Trash2, UserPlus } from 'lucide-react';
import { api, fmtDateTime, useApi } from '@/lib/client';
import { DESIGNS, FONTS, THEMES } from '@/lib/themes';
import { useTheme } from '@/components/ThemeProvider';
import { useUser } from '@/components/UserContext';
import { Badge, Button, Card, DataTable, Field, Modal, PageHeader, StatusBadge, Switch, Tabs, TagInput, useConfirm, toast, toastError } from '@/components/ui';

const FONT_VAR: Record<string, string> = { 'public-sans': '--f-public-sans', inter: '--f-inter', roboto: '--f-roboto', 'open-sans': '--f-open-sans', lato: '--f-lato', poppins: '--f-poppins', montserrat: '--f-montserrat', nunito: '--f-nunito', plex: '--f-plex', 'source-sans': '--f-source-sans' };

function DesignPreview({ k }: { k: string }) {
  const sideW = k === 'compact' ? 14 : 38;
  const r = k === 'modern' ? 6 : k === 'compact' ? 1 : 2;
  return (
    <svg viewBox="0 0 160 90" style={{ width: '100%', borderRadius: 6, background: 'var(--bg)', border: '1px solid var(--border)' }} aria-hidden>
      <rect x={k === 'modern' ? 4 : 0} y={k === 'modern' ? 4 : 0} width={sideW} height={k === 'modern' ? 82 : 90} rx={k === 'modern' ? 6 : 0} fill="var(--sidebar-bg)" stroke="var(--sidebar-border)" />
      {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={(k === 'modern' ? 4 : 0) + 4} y={14 + i * 11} width={k === 'compact' ? 6 : sideW - 8} height={5} rx={2} fill={i === 1 ? 'var(--primary)' : 'var(--border-strong)'} />)}
      <rect x={sideW + (k === 'modern' ? 8 : 0)} y={0} width={160} height={k === 'compact' ? 9 : 12} fill={k === 'modern' ? 'transparent' : 'var(--topbar-bg)'} />
      {[0, 1, 2].map((i) => <rect key={i} x={sideW + 10 + i * ((160 - sideW - 18) / 3)} y={k === 'compact' ? 14 : 20} width={(160 - sideW - 26) / 3} height={k === 'compact' ? 16 : 20} rx={r} fill="var(--surface)" stroke={k === 'modern' ? 'none' : 'var(--border)'} />)}
      <rect x={sideW + 10} y={k === 'compact' ? 36 : 48} width={160 - sideW - 18} height={k === 'compact' ? 48 : 36} rx={r} fill="var(--surface)" stroke={k === 'modern' ? 'none' : 'var(--border)'} />
    </svg>
  );
}

function Appearance() {
  const { prefs, setPrefs } = useTheme();
  return (
    <div className="stack">
      <Card title="Theme" sub="5 pilihan warna. Default mengikuti Okta Admin Console.">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
          {THEMES.map((t) => (
            <button key={t.key} className={`option-card ${prefs.theme === t.key ? 'selected' : ''}`} onClick={() => setPrefs({ theme: t.key })}>
              <div className="swatches">{t.swatch.map((c) => <span key={c} style={{ background: c }} />)}</div>
              <div className="row" style={{ justifyContent: 'space-between' }}><b>{t.name}</b>{prefs.theme === t.key && <Check size={16} color="var(--primary)" />}</div>
              <span className="small muted">{t.description}</span>
            </button>
          ))}
        </div>
      </Card>
      <Card title="Font" sub="10 pilihan font (self-hosted via next/font).">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          {FONTS.map((f) => (
            <button key={f.key} className={`option-card ${prefs.font === f.key ? 'selected' : ''}`} onClick={() => setPrefs({ font: f.key })} style={{ fontFamily: `var(${FONT_VAR[f.key]}), system-ui` }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><b style={{ fontSize: 16 }}>{f.name}</b>{prefs.font === f.key && <Check size={16} color="var(--primary)" />}</div>
              <span style={{ fontSize: 22, fontWeight: 600 }}>Aa 123</span>
              <span className="small muted">{f.note} — Identity Governance</span>
            </button>
          ))}
        </div>
      </Card>
      <Card title="Design / layout" sub="3 gaya tata letak.">
        <div className="grid grid-3">
          {DESIGNS.map((d) => (
            <button key={d.key} className={`option-card ${prefs.design === d.key ? 'selected' : ''}`} onClick={() => setPrefs({ design: d.key })}>
              <DesignPreview k={d.key} />
              <div className="row" style={{ justifyContent: 'space-between' }}><b>{d.name}</b>{prefs.design === d.key && <Check size={16} color="var(--primary)" />}</div>
              <span className="small muted">{d.description}</span>
            </button>
          ))}
        </div>
      </Card>
      <div className="small muted">Preferensi disimpan per user (server) dan diterapkan otomatis di perangkat lain saat login.</div>
    </div>
  );
}

function Integrations() {
  const cfg = useApi<any>('/api/settings/integrations');
  const sync = useApi<any>('/api/okta/sync');
  const [v, setV] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState('');
  const [testTo, setTestTo] = useState('');
  useEffect(() => { if (cfg.data) setV(cfg.data); }, [cfg.data]);
  useEffect(() => {
    if (!sync.data?.state?.running) return;
    const t = setInterval(sync.reload, 2500);
    return () => clearInterval(t);
  }, [sync.data?.state?.running, sync.reload]);

  if (!v) return null;
  const set = (section: string, k: string, val: any) => setV({ ...v, [section]: { ...v[section], [k]: val } });
  const save = async () => {
    setSaving(true);
    try { setV(await api('/api/settings/integrations', { method: 'PUT', body: v })); toast('Konfigurasi integrasi disimpan', 'success'); } catch (e) { toastError(e); } finally { setSaving(false); }
  };
  const test = async (channel: string) => {
    setTesting(channel);
    try {
      const r = await api('/api/integrations/test', { body: { channel, to: testTo } });
      r.ok ? toast(channel === 'okta' ? `Terhubung ke Okta${r.orgName ? ` (${r.orgName})` : ''} sebagai ${r.tokenOwner}` : 'Test berhasil terkirim', 'success') : toast(r.error, 'error');
    } catch (e) { toastError(e); } finally { setTesting(''); }
  };
  const startSync = async () => { try { await api('/api/okta/sync', { method: 'POST' }); sync.reload(); toast('Sinkronisasi Okta dimulai', 'success'); } catch (e) { toastError(e); } };
  const st = sync.data?.state;
  const last = sync.data?.last;

  return (
    <div className="stack">
      <div className="callout info small">Simpan dulu perubahan, lalu klik Test. Nilai rahasia ditampilkan ter-mask (••••1234); biarkan apa adanya bila tidak ingin mengubah.</div>
      <Card title="Okta" sub="Management API (SSWS token) untuk sync users, groups, apps, usage log & remediasi" actions={<><Button size="sm" icon={<Plug size={13} />} loading={testing === 'okta'} onClick={() => test('okta')}>Test connection</Button><Button size="sm" variant="primary" icon={<RefreshCw size={13} className={st?.running ? 'spin' : ''} />} onClick={startSync} disabled={st?.running}>Sync now</Button></>}>
        <div className="grid grid-2">
          <Field label="Okta org URL" hint="contoh: https://dev-123456.okta.com"><input className="input" value={v.okta.orgUrl} onChange={(e) => set('okta', 'orgUrl', e.target.value)} /></Field>
          <Field label="API token (SSWS)" hint="Okta Admin › Security › API › Tokens"><input className="input" value={v.okta.apiToken} onChange={(e) => set('okta', 'apiToken', e.target.value)} /></Field>
          <Field label="Interval sync otomatis (jam, 0 = off)"><input className="input" type="number" min={0} value={v.okta.syncIntervalHours} onChange={(e) => set('okta', 'syncIntervalHours', Number(e.target.value))} /></Field>
          <Field label="Remediasi otomatis ke Okta" hint="Revoke di certification akan menghapus user dari group/app di Okta">
            <div className="row"><Switch checked={!!v.okta.remediation} onChange={(x) => set('okta', 'remediation', x)} /> {v.okta.remediation ? <Badge tone="danger">AKTIF — perubahan nyata di Okta</Badge> : <Badge>nonaktif (manual)</Badge>}</div>
          </Field>
          <Field label="OIDC Client ID (opsional, untuk Sign in with Okta)"><input className="input" value={v.okta.clientId} onChange={(e) => set('okta', 'clientId', e.target.value)} /></Field>
          <Field label="OIDC Client Secret" hint={`Redirect URI: ${v.app.baseUrl}/api/auth/okta/callback`}><input className="input" value={v.okta.clientSecret} onChange={(e) => set('okta', 'clientSecret', e.target.value)} /></Field>
        </div>
        <div className="callout mt small" style={{ flexDirection: 'column', gap: 4 }}>
          <div><b>Status sync:</b> {st?.running ? <Badge tone="info">berjalan · {st.step}</Badge> : st?.error ? <Badge tone="danger">gagal</Badge> : <Badge>{st?.step || 'idle'}</Badge>} {st?.error && <span style={{ color: 'var(--danger)' }}>{st.error}</span>}</div>
          {last && <div><b>Sync terakhir:</b> {fmtDateTime(last.at)} — {last.result?.users} users, {last.result?.groups} groups, {last.result?.apps} apps, {last.result?.assignments} assignments ({last.result?.duration}s)</div>}
        </div>
      </Card>
      <Card title="Email (SMTP)" sub="Untuk workflow email & report terjadwal. Host localhost:1025 = Mailpit (testing lokal, email tidak keluar; lihat http://localhost:8025)." actions={<><input className="input" style={{ width: 220 }} type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Kirim test ke (default: email login)" /><Button size="sm" loading={testing === 'smtp'} onClick={() => test('smtp')}>Kirim test</Button></>}>
        <div className="grid grid-3">
          <Field label="Host"><input className="input" value={v.smtp.host} onChange={(e) => set('smtp', 'host', e.target.value)} /></Field>
          <Field label="Port"><input className="input" type="number" value={v.smtp.port} onChange={(e) => set('smtp', 'port', Number(e.target.value))} /></Field>
          <Field label="From"><input className="input" value={v.smtp.from} onChange={(e) => set('smtp', 'from', e.target.value)} /></Field>
          <Field label="Username"><input className="input" value={v.smtp.user} onChange={(e) => set('smtp', 'user', e.target.value)} /></Field>
          <Field label="Password"><input className="input" type="password" value={v.smtp.pass} onChange={(e) => set('smtp', 'pass', e.target.value)} /></Field>
          <Field label="TLS (secure)"><div className="row"><Switch checked={!!v.smtp.secure} onChange={(x) => set('smtp', 'secure', x)} /> port 465</div></Field>
        </div>
      </Card>
      <Card title="Slack" sub="Incoming webhook untuk pesan. Bot token (opsional) untuk mengirim file report ke channel. Channel Business Owner menerima executive summary & laporan campaign." actions={<><Button size="sm" loading={testing === 'slack'} onClick={() => test('slack')}>Test default</Button><Button size="sm" loading={testing === 'slack_bo'} onClick={() => test('slack_bo')}>Test Business Owner</Button><Button size="sm" loading={testing === 'slack_file'} onClick={() => test('slack_file')}>Test kirim file</Button></>}>
        <div className="grid grid-2">
          <Field label="Webhook URL (default / IAM team)"><input className="input" value={v.slack.webhookUrl} onChange={(e) => set('slack', 'webhookUrl', e.target.value)} placeholder="https://hooks.slack.com/services/…" /></Field>
          <Field label="Webhook URL Business Owner"><input className="input" value={v.slack.businessOwnerWebhookUrl} onChange={(e) => set('slack', 'businessOwnerWebhookUrl', e.target.value)} placeholder="https://hooks.slack.com/services/…" /></Field>
          <Field label="Bot token (opsional, untuk lampiran file)" hint="Slack App › OAuth & Permissions › Bot User OAuth Token (scope chat:write, files:write)"><input className="input" type="password" value={v.slack.botToken} onChange={(e) => set('slack', 'botToken', e.target.value)} placeholder="xoxb-…" /></Field>
          <Field label="Channel ID default" hint="Klik nama channel › About › Channel ID. Undang bot: /invite @NamaApp"><input className="input" value={v.slack.channelId} onChange={(e) => set('slack', 'channelId', e.target.value)} placeholder="C0123456789" /></Field>
          <Field label="Channel ID Business Owner" hint="Kosong = pakai channel default"><input className="input" value={v.slack.businessOwnerChannelId} onChange={(e) => set('slack', 'businessOwnerChannelId', e.target.value)} placeholder="C0123456789" /></Field>
        </div>
        <div className="mt"><Field label="Email Business Owners" hint="Penerima role 'business_owners' pada workflow & digest"><TagInput value={v.businessOwners || []} onChange={(x) => setV({ ...v, businessOwners: x })} /></Field></div>
      </Card>
      <Card title="Aplikasi"><Field label="Base URL" hint="Dipakai untuk link di email & redirect OIDC"><input className="input" value={v.app.baseUrl} onChange={(e) => set('app', 'baseUrl', e.target.value)} /></Field></Card>
      <div className="row"><span className="spacer" /><Button variant="primary" loading={saving} onClick={save}>Simpan konfigurasi</Button></div>
    </div>
  );
}

function UsersTab() {
  const me = useUser();
  const users = useApi<any>('/api/users');
  const [add, setAdd] = useState<any>(null);
  const { confirm, dialog } = useConfirm();
  const patch = async (u: any, body: any) => { try { await api(`/api/users/${u._id}`, { method: 'PATCH', body }); users.reload(); } catch (e) { toastError(e); } };
  const create = async () => { try { await api('/api/users', { body: add }); toast('User dibuat', 'success'); setAdd(null); users.reload(); } catch (e) { toastError(e); } };
  const remove = async (u: any) => { if (await confirm('Hapus user?', u.email, true)) { try { await api(`/api/users/${u._id}`, { method: 'DELETE' }); users.reload(); } catch (e) { toastError(e); } } };
  return (
    <>
      {dialog}
      <Card title="Platform users" sub="Admin: akses penuh · Reviewer: My Reviews & dashboard · Auditor: read-only" flush actions={<Button size="sm" variant="primary" icon={<UserPlus size={13} />} onClick={() => setAdd({ email: '', name: '', role: 'reviewer', password: '' })}>Add user</Button>}>
        <DataTable
          rows={users.data?.items || []}
          columns={[
            { key: 'email', label: 'User', render: (u: any) => (<div><div className="cell-title">{u.name}</div><div className="cell-sub">{u.email}</div></div>) },
            { key: 'role', label: 'Role', render: (u: any) => <select className="select" style={{ width: 120, height: 30 }} value={u.role} disabled={u._id === me.sub} onChange={(e) => patch(u, { role: e.target.value })}>{['admin', 'reviewer', 'auditor'].map((r) => <option key={r}>{r}</option>)}</select> },
            { key: 'authSource', label: 'Auth', render: (u: any) => <Badge>{u.authSource}</Badge> },
            { key: 'lastLoginAt', label: 'Last login', render: (u: any) => fmtDateTime(u.lastLoginAt) },
            { key: 'active', label: 'Active', render: (u: any) => <Switch checked={u.active} disabled={u._id === me.sub} onChange={(v) => patch(u, { active: v })} /> },
            { key: 'act', label: '', render: (u: any) => u._id !== me.sub && <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => remove(u)} /> },
          ]}
        />
      </Card>
      <Modal open={!!add} title="Add user" onClose={() => setAdd(null)} footer={<><Button onClick={() => setAdd(null)}>Batal</Button><Button variant="primary" onClick={create}>Simpan</Button></>}>
        {add && (
          <>
            <Field label="Email"><input className="input" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} /></Field>
            <Field label="Nama"><input className="input" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></Field>
            <Field label="Role"><select className="select" value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })}>{['reviewer', 'admin', 'auditor'].map((r) => <option key={r}>{r}</option>)}</select></Field>
            <Field label="Password" hint="Kosongkan bila user login via Okta SSO (min. 8 karakter)"><input className="input" type="password" value={add.password} onChange={(e) => setAdd({ ...add, password: e.target.value })} /></Field>
          </>
        )}
      </Modal>
    </>
  );
}

function DataTab() {
  const [busy, setBusy] = useState('');
  const { confirm, dialog } = useConfirm();
  const run = async (action: string, msg: string, danger = false, warn?: string) => {
    if (warn && !(await confirm('Konfirmasi', warn, danger))) return;
    setBusy(action);
    try { const r = await api(`/api/setup/${action}`, { method: 'POST' }); toast(`${msg}${r.identities ? ` — ${r.identities} identities, ${r.assignments} assignments` : ''}`, 'success'); } catch (e) { toastError(e); } finally { setBusy(''); }
  };
  return (
    <div className="stack">
      {dialog}
      <Card title="Demo data" sub="Data contoh lengkap (identities human & non-human, apps, SoD, campaign, role, schedule, tren 90 hari).">
        <Button icon={<Database size={14} />} loading={busy === 'seed'} onClick={() => run('seed', 'Demo data dimuat', true, 'Seluruh data governance saat ini akan diganti dengan demo data. Lanjutkan?')}>Load demo data</Button>
      </Card>
      <Card title="Recompute analytics" sub="Jalankan ulang SoD scan, risk scoring, dan snapshot tren.">
        <Button icon={<RefreshCw size={14} />} loading={busy === 'recompute'} onClick={() => run('recompute', 'Analitik diperbarui')}>Recompute</Button>
      </Card>
      <Card title="Reset" sub="Hapus semua data governance (identities, campaigns, violations, dll). User platform, settings, report & workflow tetap.">
        <Button variant="danger" icon={<Trash2 size={14} />} loading={busy === 'reset'} onClick={() => run('reset', 'Data direset', true, 'Hapus SEMUA data governance? Tindakan ini tidak dapat dibatalkan. Setelah reset, jalankan Okta sync untuk mengisi data asli.')}>Reset governance data</Button>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  const user = useUser();
  const [tab, setTab] = useState('appearance');
  const tabs = [{ key: 'appearance', label: 'Appearance' }, ...(user.role === 'admin' ? [{ key: 'integrations', label: 'Integrations' }, { key: 'users', label: 'Users & Roles' }, { key: 'data', label: 'Data' }] : [])];
  return (
    <>
      <PageHeader title="Settings" subtitle="Tampilan (theme, font, design), integrasi Okta / Email / Slack, user platform, dan data." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'appearance' && <Appearance />}
      {tab === 'integrations' && <Integrations />}
      {tab === 'users' && <UsersTab />}
      {tab === 'data' && <DataTab />}
    </>
  );
}
