import { Assignment, Entitlement, Identity, OktaEvent, SodPolicy, SodViolation } from './models';
import { resolveSide } from './sod';
import { getSetting } from './settings';
import { daysAgo } from './util';

const HOUR = 3600_000;
const SEV_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
const ACTIVE_STATUSES = ['open', 'mitigated', 'accepted'];

/** Event System Log yang mengubah kepemilikan entitlement (lihat Okta Event Types). */
const MEMBERSHIP_EVENTS = ['group.user_membership.add', 'group.user_membership.remove', 'application.user_membership.add', 'application.user_membership.remove'];

/**
 * Sinyal keamanan identitas dari Okta System Log (eventType mengikuti katalog Okta Event Types:
 * https://developer.okta.com/docs/reference/api/event-types/).
 */
export const SIGNALS = [
  { key: 'failedLogin', label: 'Failed sign-in', test: (t: string, o?: string) => /^(user\.session\.start|user\.authentication\.|policy\.evaluate_sign_on)/.test(t) && (o === 'FAILURE' || o === 'DENY') },
  { key: 'lockout', label: 'Account lockout', test: (t: string) => t === 'user.account.lock' || t === 'user.account.lock.limit' },
  { key: 'threat', label: 'Threat / suspicious', test: (t: string) => /^(security\.(threat\.detected|request\.blocked|session\.detect_client_roaming|breached_credential|attack\.)|user\.risk\.|user\.account\.report_suspicious_activity)/.test(t) },
  { key: 'privilege', label: 'Admin privilege grant', test: (t: string) => t === 'user.account.privilege.grant' || t === 'group.privilege.grant' },
  { key: 'mfaWeakened', label: 'MFA factor removed', test: (t: string) => /^user\.mfa\.factor\.(deactivate|reset_all|suspend)$/.test(t) },
  { key: 'adminConsole', label: 'Admin Console access', test: (t: string) => t === 'user.session.access_admin_app' },
  { key: 'policyChange', label: 'Policy change', test: (t: string) => /^policy\.(lifecycle|rule)\./.test(t) },
  { key: 'apiToken', label: 'API token created', test: (t: string) => t === 'system.api_token.create' },
  { key: 'passwordReset', label: 'Password reset', test: (t: string) => t === 'user.account.reset_password' || t === 'user.account.update_password' },
] as const;
type SignalKey = (typeof SIGNALS)[number]['key'];
const SIGNAL_TYPES_RX = /^(user\.session\.start|user\.authentication\.|policy\.evaluate_sign_on|user\.account\.(lock|privilege\.grant|reset_password|update_password|report_suspicious)|security\.|user\.risk\.|group\.privilege\.grant|user\.mfa\.factor\.|user\.session\.access_admin_app|policy\.(lifecycle|rule)\.|system\.api_token\.create)/;

export function signalOf(eventType: string, outcome?: string): SignalKey | null {
  for (const s of SIGNALS) if (s.test(eventType, outcome)) return s.key;
  return null;
}

const floorHour = (ms: number) => {
  const d = new Date(ms);
  d.setMinutes(0, 0, 0); // jam lokal (TZ proses), sama dengan label di UI
  return d.getTime();
};

type Compiled = { id: string; name: string; severity: string; A: Set<string>; B: Set<string> };

function violatedPolicies(held: Set<string> | undefined, policies: Compiled[]) {
  const out: number[] = [];
  if (!held?.size) return out;
  policies.forEach((p, i) => {
    const mA = [...held].filter((e) => p.A.has(e));
    const mB = [...held].filter((e) => p.B.has(e));
    // aturan sama dengan runSodScan: satu entitlement yang cocok di kedua sisi bukan konflik
    if (mA.length && mB.length && !(mA.length === 1 && mB.length === 1 && mA[0] === mB[0])) out.push(i);
  });
  return out;
}

/**
 * Rekonstruksi jumlah user yang melanggar SoD per jam.
 * Titik awal = assignment hasil sync terakhir; event membership System Log setelah sync diterapkan maju
 * (state "sekarang"), lalu semua event di dalam rentang di-undo mundur jam demi jam.
 * Selama undo, event yang membuat/menghapus kombinasi konflik dicatat sebagai timeline (siapa, kapan, oleh siapa).
 */
export async function sodHourly(hours: number) {
  const now = Date.now();
  const end = floorHour(now) + HOUR;
  const start = end - hours * HOUR;

  const [policyDocs, ents] = await Promise.all([
    SodPolicy.find({ enabled: true }).lean<any[]>(),
    Entitlement.find({}, { name: 1, oktaId: 1 }).lean<any[]>(),
  ]);
  const policies: Compiled[] = policyDocs
    .map((p) => ({ id: String(p._id), name: p.name, severity: p.severity, A: resolveSide(p.sideA, ents), B: resolveSide(p.sideB, ents) }))
    .filter((p) => p.A.size && p.B.size);
  const relevant = new Set(policies.flatMap((p) => [...p.A, ...p.B]));
  const entName = new Map(ents.map((e) => [String(e._id), e.name]));
  const entByOkta = new Map(ents.filter((e) => e.oktaId && relevant.has(String(e._id))).map((e) => [String(e.oktaId), String(e._id)]));

  const [identities, assigns, lastSync] = await Promise.all([
    Identity.find({}, { oktaId: 1, displayName: 1, login: 1, department: 1 }).lean<any[]>(),
    Assignment.find({ entitlementId: { $in: [...relevant] } }, { identityId: 1, entitlementId: 1 }).lean<any[]>(),
    getSetting<any>('okta.lastSync', null),
  ]);
  const idByOkta = new Map(identities.filter((i) => i.oktaId).map((i) => [i.oktaId, String(i._id)]));
  const held = new Map<string, Set<string>>();
  for (const a of assigns) {
    const k = String(a.identityId);
    if (!held.has(k)) held.set(k, new Set());
    held.get(k)!.add(String(a.entitlementId));
  }
  // assignment diambil di awal sync, bukan saat sync selesai
  const baseAt = lastSync?.at ? new Date(lastSync.at).getTime() - (lastSync.result?.duration || 0) * 1000 : now;

  const raw = policies.length
    ? await OktaEvent.find(
        { eventType: { $in: MEMBERSHIP_EVENTS }, outcome: 'SUCCESS', published: { $gte: new Date(Math.min(start, baseAt)) } },
        { eventType: 1, published: 1, targets: 1, actor: 1 },
      ).sort({ published: 1 }).lean<any[]>()
    : [];
  const events = raw
    .map((ev) => {
      const isApp = ev.eventType.startsWith('application.');
      const user = (ev.targets || []).find((t: any) => t.type === 'User');
      const res = (ev.targets || []).find((t: any) => t.type === (isApp ? 'AppInstance' : 'UserGroup'));
      const identityId = user && idByOkta.get(user.id);
      const entId = res && entByOkta.get(isApp ? `app:${res.id}` : res.id);
      if (!identityId || !entId) return null;
      return { at: new Date(ev.published).getTime(), add: ev.eventType.endsWith('.add'), identityId, entId, eventType: ev.eventType, actor: ev.actor?.displayName || ev.actor?.alternateId || 'system' };
    })
    .filter(Boolean) as { at: number; add: boolean; identityId: string; entId: string; eventType: string; actor: string }[];

  const setHeld = (identityId: string, entId: string, present: boolean) => {
    if (!held.has(identityId)) held.set(identityId, new Set());
    present ? held.get(identityId)!.add(entId) : held.get(identityId)!.delete(entId);
  };

  // maju: event setelah sync terakhir → state sekarang
  for (const e of events) if (e.at > baseAt) setHeld(e.identityId, e.entId, e.add);

  const viol = new Map<string, number[]>();
  for (const [id, h] of held) {
    const v = violatedPolicies(h, policies);
    if (v.length) viol.set(id, v);
  }

  const timeline: any[] = [];
  const points: any[] = [];
  const desc = events.filter((e) => e.at > start).reverse();
  let k = 0;
  for (let bs = end - HOUR; bs >= start; bs -= HOUR) {
    const be = bs + HOUR;
    let introduced = 0;
    let resolved = 0;
    // undo event yang terjadi di jam ini → state berpindah ke awal jam (setelah snapshot titik ini diambil)
    const snapshot = [...viol.entries()];
    while (k < desc.length && desc[k].at >= bs) {
      const e = desc[k++];
      const after = viol.get(e.identityId) || [];
      setHeld(e.identityId, e.entId, !e.add);
      const before = violatedPolicies(held.get(e.identityId), policies);
      before.length ? viol.set(e.identityId, before) : viol.delete(e.identityId);
      // add yang memunculkan konflik / remove yang menghilangkannya
      const changed = e.add ? after.filter((i) => !before.includes(i)) : before.filter((i) => !after.includes(i));
      for (const i of changed) {
        e.add ? introduced++ : resolved++;
        timeline.push({ at: e.at, change: e.add ? 'introduced' : 'resolved', identityId: e.identityId, policy: policies[i].name, policyId: policies[i].id, severity: policies[i].severity, entitlement: entName.get(e.entId), actor: e.actor, eventType: e.eventType });
      }
    }
    const sev: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const [, ps] of snapshot) {
      const top = ps.map((i) => policies[i].severity).sort((a, b) => SEV_RANK[b] - SEV_RANK[a])[0];
      sev[top] = (sev[top] || 0) + 1;
    }
    points.push({ t: bs, users: snapshot.length, ...sev, introduced, resolved, who: snapshot.map(([id, ps]) => ({ id, policies: ps.map((i) => policies[i].name) })) });
  }
  points.reverse();

  const people = new Map(identities.map((i) => [String(i._id), { name: i.displayName || i.login, login: i.login, department: i.department }]));
  for (const t of timeline) t.identity = people.get(t.identityId);
  for (const p of points) for (const w of p.who) Object.assign(w, people.get(w.id));
  return { points, timeline, policies: policies.length, baseAt };
}

/** Sinyal keamanan per jam dari System Log + daftar event terbaru. */
export async function securitySignals(hours: number) {
  const end = floorHour(Date.now()) + HOUR;
  const start = end - hours * HOUR;
  const events = await OktaEvent.find(
    { published: { $gte: new Date(start) }, eventType: SIGNAL_TYPES_RX },
    { eventType: 1, outcome: 1, published: 1, actor: 1, targets: 1, displayMessage: 1, outcomeReason: 1, ipAddress: 1, location: 1 },
  ).sort({ published: -1 }).limit(100_000).lean<any[]>();

  const buckets = new Map<number, Record<string, number>>();
  for (let t = start; t < end; t += HOUR) buckets.set(t, Object.fromEntries(SIGNALS.map((s) => [s.key, 0])));
  const totals: Record<string, number> = Object.fromEntries(SIGNALS.map((s) => [s.key, 0]));
  const recent: any[] = [];
  for (const ev of events) {
    const key = signalOf(ev.eventType, ev.outcome);
    if (!key) continue;
    totals[key]++;
    const b = buckets.get(floorHour(new Date(ev.published).getTime()));
    if (b) b[key]++;
    // Admin Console access & policy change volumenya tinggi namun rutin — tidak masuk feed "high signal"
    if (recent.length < 40 && !['adminConsole', 'policyChange'].includes(key)) {
      const user = (ev.targets || []).find((t: any) => t.type === 'User') || ev.actor;
      recent.push({ _id: String(ev._id), at: ev.published, signal: key, eventType: ev.eventType, user: user?.displayName || user?.alternateId, actor: ev.actor?.displayName || ev.actor?.alternateId, message: ev.displayMessage, outcome: ev.outcome, reason: ev.outcomeReason, ip: ev.ipAddress, location: ev.location });
    }
  }
  return { points: [...buckets.entries()].map(([t, v]) => ({ t, ...v })), totals, recent };
}

/** Jumlah per sinyal untuk 24 jam & 7 hari terakhir (KPI tidak bergantung pada rentang chart). */
async function signalCounts() {
  const dayAgo = Date.now() - 24 * HOUR;
  const events = await OktaEvent.find({ published: { $gte: daysAgo(7) }, eventType: SIGNAL_TYPES_RX }, { eventType: 1, outcome: 1, published: 1 }).lean<any[]>();
  const d1: Record<string, number> = {};
  const d7: Record<string, number> = {};
  for (const e of events) {
    const k = signalOf(e.eventType, e.outcome);
    if (!k) continue;
    d7[k] = (d7[k] || 0) + 1;
    if (new Date(e.published).getTime() >= dayAgo) d1[k] = (d1[k] || 0) + 1;
  }
  return { d1, d7 };
}

/** Ringkasan Identity Security Posture: SoD per jam, sinyal keamanan Okta, privileged access, skor. */
export async function getPosture(range: string) {
  const hours = range === '30d' ? 720 : range === '7d' ? 168 : 24;
  const [sod, signals, violations, privEnts, lastSync, lastEvents] = await Promise.all([
    sodHourly(hours),
    securitySignals(hours),
    SodViolation.find({ status: { $in: ACTIVE_STATUSES } })
      .populate('policyId', 'name category')
      .populate('identityId', 'displayName login department title riskScore identityType')
      .populate('matchedA', 'name')
      .populate('matchedB', 'name')
      .lean<any[]>(),
    Entitlement.find({ privileged: true }, { _id: 1 }).lean<any[]>(),
    getSetting<any>('okta.lastSync', null),
    getSetting<any>('okta.lastEventsPull', null),
  ]);

  const privAssign = await Assignment.distinct('identityId', { entitlementId: { $in: privEnts.map((e) => e._id) } });
  const privIds = await Identity.find({ _id: { $in: privAssign }, status: { $nin: ['DEPROVISIONED', 'SUSPENDED'] } }, { lastLogin: 1 }).lean<any[]>();
  const dormantPriv = privIds.filter((i) => !i.lastLogin || new Date(i.lastLogin) < daysAgo(90)).length;

  const { d1, d7 } = await signalCounts();
  const [failed24, threat24, lock24, priv7, mfa7] = [d1.failedLogin || 0, d1.threat || 0, d1.lockout || 0, d7.privilege || 0, d7.mfaWeakened || 0];

  // violator aktif dikelompokkan per identity
  const byIdentity = new Map<string, any>();
  for (const v of violations) {
    if (!v.identityId) continue;
    const k = String(v.identityId._id);
    if (!byIdentity.has(k)) byIdentity.set(k, { _id: k, identity: v.identityId, violations: [], severity: 'low', since: v.detectedAt, statuses: new Set() });
    const row = byIdentity.get(k);
    const intro = sod.timeline.filter((t) => t.change === 'introduced' && t.identityId === k && t.policyId === String(v.policyId?._id)).sort((a, b) => b.at - a.at)[0];
    row.violations.push({ policy: v.policyId?.name, category: v.policyId?.category, severity: v.severity, status: v.status, a: v.matchedA.map((e: any) => e.name), b: v.matchedB.map((e: any) => e.name), introducedAt: intro?.at, introducedBy: intro?.actor });
    if (SEV_RANK[v.severity] > SEV_RANK[row.severity]) row.severity = v.severity;
    if (v.detectedAt && v.detectedAt < row.since) row.since = v.detectedAt;
    row.statuses.add(v.status);
  }
  const violators = [...byIdentity.values()]
    .map((r) => ({ ...r, statuses: [...r.statuses] }))
    .sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.violations.length - a.violations.length);

  const open = violations.filter((v) => v.status === 'open');
  const openUsers = new Set(open.map((v) => String(v.identityId?._id))).size;
  const critical = open.filter((v) => v.severity === 'critical').length;
  const high = open.filter((v) => v.severity === 'high').length;
  const medium = open.filter((v) => v.severity === 'medium' || v.severity === 'low').length;

  // skor heuristik transparan: 100 dikurangi penalti berbatas per area
  const deductions = [
    { label: 'Pelanggaran SoD terbuka (critical ×10, high ×6, lainnya ×3)', points: Math.min(40, critical * 10 + high * 6 + medium * 3) },
    { label: 'Privileged account dormant >90 hari (×3)', points: Math.min(15, dormantPriv * 3) },
    { label: 'Sinyal threat / lockout 24 jam (×1)', points: Math.min(15, threat24 + lock24) },
    { label: 'Failed sign-in 24 jam (per 10)', points: Math.min(10, Math.floor(failed24 / 10)) },
    { label: 'Admin privilege grant 7 hari (×2)', points: Math.min(10, priv7 * 2) },
    { label: 'MFA factor dihapus/reset 7 hari (×2)', points: Math.min(10, mfa7 * 2) },
  ];
  const score = Math.max(0, 100 - deductions.reduce((a, d) => a + d.points, 0));
  const peak = sod.points.reduce((m: any, p: any) => (!m || p.users > m.users ? p : m), null);

  return {
    generatedAt: new Date(),
    range,
    hours,
    lastSync: lastSync?.at || null,
    lastEventsPull: lastEvents?.at || null,
    policies: sod.policies,
    score: { value: score, deductions },
    kpis: {
      usersInViolation: openUsers,
      openViolations: open.length,
      critical,
      high,
      mitigated: violations.length - open.length,
      privileged: privIds.length,
      dormantPrivileged: dormantPriv,
      failedLogins24h: failed24,
      threats24h: threat24,
      lockouts24h: lock24,
      privilegeGrants7d: priv7,
      mfaWeakened7d: mfa7,
    },
    sodHourly: sod.points,
    peak: peak ? { t: peak.t, users: peak.users } : null,
    sodTimeline: sod.timeline.sort((a, b) => b.at - a.at).slice(0, 200),
    signals: SIGNALS.map((s) => ({ key: s.key, label: s.label, total: signals.totals[s.key] })),
    signalsHourly: signals.points,
    securityEvents: signals.recent,
    violators,
  };
}
