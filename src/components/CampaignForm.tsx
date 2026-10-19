'use client';
import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Search, X } from 'lucide-react';
import { api, useApi } from '@/lib/client';
import { Badge, Button, Card, CheckList, Field, Switch, toastError } from './ui';

export const DEFAULT_CAMPAIGN = {
  name: '',
  description: '',
  scopeType: 'department',
  scope: { departments: [] as string[], applicationIds: [] as string[], entitlementIds: [] as string[], roleIds: [] as string[], riskLevels: ['high', 'critical'], riskTarget: 'identity', inactiveDays: 90 },
  reviewerHierarchy: ['manager', 'manager_of_manager', 'fallback'],
  specificReviewer: '',
  fallbackReviewer: '',
  escalation: { enabled: true, afterDays: 7, maxLevel: 2 },
  allowReassign: true,
  autoRemediate: false,
  durationDays: 14,
  recurrence: 'none',
  startAt: '',
  launchMode: 'now',
};

const SCOPES: [string, string, string][] = [
  ['all', 'Semua akses', 'Seluruh assignment di organisasi'],
  ['department', 'Department', 'User pada department tertentu'],
  ['application', 'Application', 'Akses ke aplikasi tertentu'],
  ['entitlement', 'Entitlement / group', 'Group atau entitlement spesifik'],
  ['role', 'Role', 'Anggota & entitlement role tertentu'],
  ['risk', 'Risk', 'Identitas / entitlement berisiko tinggi'],
  ['mover', 'Mover', 'User yang pindah department'],
  ['leaver', 'Leaver', 'Suspended / deprovisioned dengan akses'],
  ['inactive', 'Long inactive', 'Dormant > N hari'],
  ['privileged', 'Privileged', 'Admin & akses privileged'],
  ['non_human', 'Non-human', 'Service account, bot, API'],
];

export function CampaignForm({ value, onChange, levels }: { value: any; onChange: (v: any) => void; levels: Record<string, string> }) {
  const v = value;
  const set = (p: any) => onChange({ ...v, ...p });
  const setScope = (p: any) => onChange({ ...v, scope: { ...v.scope, ...p } });
  const ids = useApi<any>('/api/identities?limit=1');
  const apps = useApi<any>('/api/applications');
  const ents = useApi<any>('/api/entitlements');
  const roles = useApi<any>('/api/roles');
  const [preview, setPreview] = useState<any>(null);
  const [previewing, setPreviewing] = useState(false);

  const runPreview = async () => {
    setPreviewing(true);
    try {
      setPreview(await api('/api/campaigns/preview', { body: v }));
    } catch (e) {
      toastError(e);
    } finally {
      setPreviewing(false);
    }
  };
  const moveLevel = (i: number, d: number) => {
    const h = [...v.reviewerHierarchy];
    const j = i + d;
    if (j < 0 || j >= h.length) return;
    [h[i], h[j]] = [h[j], h[i]];
    set({ reviewerHierarchy: h });
  };
  const available = Object.keys(levels).filter((k) => !v.reviewerHierarchy.includes(k));

  return (
    <div className="stack">
      <Card title="1. Informasi campaign">
        <div className="grid grid-2">
          <Field label="Nama campaign *"><input className="input" value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="mis. Q4 2026 Finance Access Review" /></Field>
          <Field label="Durasi review (hari)" hint="Jatuh tempo = tanggal launch + durasi"><input className="input" type="number" min={1} value={v.durationDays} onChange={(e) => set({ durationDays: Number(e.target.value) })} /></Field>
        </div>
        <div className="mt"><Field label="Deskripsi"><textarea className="textarea" value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field></div>
      </Card>

      <Card title="2. Scope — siapa & akses apa yang direview">
        <div className="grid grid-4" style={{ gap: 8 }}>
          {SCOPES.map(([k, label, desc]) => (
            <button type="button" key={k} className={`option-card ${v.scopeType === k ? 'selected' : ''}`} onClick={() => set({ scopeType: k })} style={{ padding: 10, gap: 2 }}>
              <b style={{ fontSize: 13 }}>{label}</b>
              <span className="small muted">{desc}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-2 mt">
          {(v.scopeType === 'department' || !['department', 'all'].includes(v.scopeType)) && (
            <Field label={v.scopeType === 'department' ? 'Department *' : 'Batasi ke department (opsional)'}>
              <CheckList options={(ids.data?.departments || []).map((d: string) => ({ value: d, label: d }))} value={v.scope.departments} onChange={(x) => setScope({ departments: x })} height={180} />
            </Field>
          )}
          {v.scopeType === 'application' && (
            <Field label="Aplikasi *"><CheckList options={(apps.data?.items || []).map((a: any) => ({ value: a._id, label: a.label, sub: `${a.assignments} akses` }))} value={v.scope.applicationIds} onChange={(x) => setScope({ applicationIds: x })} height={180} /></Field>
          )}
          {v.scopeType === 'entitlement' && (
            <Field label="Entitlement *"><CheckList options={(ents.data?.items || []).map((e: any) => ({ value: e._id, label: e.name, sub: `${e.holders}` }))} value={v.scope.entitlementIds} onChange={(x) => setScope({ entitlementIds: x })} height={180} /></Field>
          )}
          {v.scopeType === 'role' && (
            <Field label="Role *" hint="Role berstatus active/candidate dari Role Mining"><CheckList options={(roles.data?.items || []).map((r: any) => ({ value: r._id, label: r.name, sub: r.status }))} value={v.scope.roleIds} onChange={(x) => setScope({ roleIds: x })} height={180} /></Field>
          )}
          {v.scopeType === 'risk' && (
            <div className="stack">
              <Field label="Target risk">
                <select className="select" value={v.scope.riskTarget} onChange={(e) => setScope({ riskTarget: e.target.value })}>
                  <option value="identity">Risk level identitas</option>
                  <option value="entitlement">Risk level entitlement</option>
                </select>
              </Field>
              <Field label="Risk level">
                <div className="row">
                  {['critical', 'high', 'medium', 'low'].map((l) => (
                    <label key={l} className="check"><input type="checkbox" checked={v.scope.riskLevels.includes(l)} onChange={(e) => setScope({ riskLevels: e.target.checked ? [...v.scope.riskLevels, l] : v.scope.riskLevels.filter((x: string) => x !== l) })} /> {l}</label>
                  ))}
                </div>
              </Field>
            </div>
          )}
          {v.scopeType === 'inactive' && (
            <Field label="Tidak login lebih dari (hari)"><input className="input" type="number" value={v.scope.inactiveDays} onChange={(e) => setScope({ inactiveDays: Number(e.target.value) })} /></Field>
          )}
        </div>
      </Card>

      <Card title="3. Reviewer assignment & hierarki" sub="Reviewer ditentukan berurutan; level berikutnya dipakai bila level sebelumnya kosong / self-review, dan untuk eskalasi.">
        <div className="grid grid-2">
          <div className="stack" style={{ gap: 8 }}>
            {v.reviewerHierarchy.map((l: string, i: number) => (
              <div key={l} className="row card" style={{ padding: '8px 10px', flexWrap: 'nowrap' }}>
                <Badge tone="primary">L{i + 1}</Badge>
                <span style={{ flex: 1 }}>{levels[l]}</span>
                <Button size="sm" variant="ghost" icon={<ArrowUp size={13} />} onClick={() => moveLevel(i, -1)} />
                <Button size="sm" variant="ghost" icon={<ArrowDown size={13} />} onClick={() => moveLevel(i, 1)} />
                <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => set({ reviewerHierarchy: v.reviewerHierarchy.filter((x: string) => x !== l) })} disabled={v.reviewerHierarchy.length <= 1} />
              </div>
            ))}
            {available.length > 0 && (
              <div className="row">
                {available.map((k) => (
                  <Button key={k} size="sm" icon={<Plus size={12} />} onClick={() => set({ reviewerHierarchy: [...v.reviewerHierarchy, k] })}>{levels[k]}</Button>
                ))}
              </div>
            )}
          </div>
          <div className="stack">
            {v.reviewerHierarchy.includes('specific') && (
              <Field label="Reviewer tertentu (email) *"><input className="input" value={v.specificReviewer} onChange={(e) => set({ specificReviewer: e.target.value })} /></Field>
            )}
            <Field label="Fallback reviewer (email)" hint="Default: admin pertama"><input className="input" value={v.fallbackReviewer} onChange={(e) => set({ fallbackReviewer: e.target.value })} /></Field>
            <div className="row"><Switch checked={v.allowReassign} onChange={(x) => set({ allowReassign: x })} /> Izinkan reviewer melakukan <b>reassignment</b></div>
            <div className="row"><Switch checked={v.escalation.enabled} onChange={(x) => set({ escalation: { ...v.escalation, enabled: x } })} /> Auto-eskalasi ke level berikutnya</div>
            {v.escalation.enabled && (
              <div className="grid grid-2">
                <Field label="Eskalasi setelah (hari)"><input className="input" type="number" min={1} value={v.escalation.afterDays} onChange={(e) => set({ escalation: { ...v.escalation, afterDays: Number(e.target.value) } })} /></Field>
                <Field label="Maks. eskalasi"><input className="input" type="number" min={1} max={5} value={v.escalation.maxLevel} onChange={(e) => set({ escalation: { ...v.escalation, maxLevel: Number(e.target.value) } })} /></Field>
              </div>
            )}
            <div className="row"><Switch checked={v.autoRemediate} onChange={(x) => set({ autoRemediate: x })} /> Auto-remediation: revoke langsung dicabut di Okta</div>
          </div>
        </div>
      </Card>

      <Card title="4. Jadwal">
        <div className="grid grid-3">
          <Field label="Mode launch">
            <select className="select" value={v.launchMode} onChange={(e) => set({ launchMode: e.target.value })}>
              <option value="now">Launch sekarang</option>
              <option value="schedule">Jadwalkan</option>
              <option value="draft">Simpan sebagai draft</option>
            </select>
          </Field>
          {v.launchMode === 'schedule' && (
            <>
              <Field label="Mulai pada"><input className="input" type="datetime-local" value={v.startAt} onChange={(e) => set({ startAt: e.target.value })} /></Field>
              <Field label="Pengulangan" hint="Instance baru dibuat otomatis setiap periode">
                <select className="select" value={v.recurrence} onChange={(e) => set({ recurrence: e.target.value })}>
                  <option value="none">Sekali</option>
                  <option value="weekly">Mingguan</option>
                  <option value="monthly">Bulanan</option>
                  <option value="quarterly">Kuartalan</option>
                  <option value="semiannual">Semesteran</option>
                  <option value="annual">Tahunan</option>
                </select>
              </Field>
            </>
          )}
        </div>
      </Card>

      <Card title="Preview" actions={<Button icon={<Search size={14} />} loading={previewing} onClick={runPreview}>Hitung preview</Button>}>
        {preview ? (
          <div className="stack">
            <div className="row"><Badge tone="info">{preview.items} item review</Badge><Badge>{preview.identities} identitas</Badge><Badge>{preview.reviewers.length} reviewer</Badge></div>
            <div className="table-wrap" style={{ maxHeight: 220 }}>
              <table className="table"><thead><tr><th>Reviewer</th><th>Item</th></tr></thead><tbody>{preview.reviewers.slice(0, 30).map((r: any) => <tr key={r.email}><td>{r.email}</td><td>{r.count}</td></tr>)}</tbody></table>
            </div>
          </div>
        ) : (
          <div className="muted small">Klik “Hitung preview” untuk melihat jumlah item dan distribusi reviewer sebelum launch.</div>
        )}
      </Card>
    </div>
  );
}
