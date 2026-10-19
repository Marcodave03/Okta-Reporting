import { Application, Assignment, Entitlement, Identity, OktaEvent, Setting } from './models';
import { getConfig } from './settings';
import { runSodScan } from './sod';
import { emit } from './notify';
import { audit } from './audit';
import { daysAgo } from './util';

/* ======================= Okta Management API client ======================= */
export class OktaClient {
  constructor(private orgUrl: string, private token: string) {
    if (!orgUrl || orgUrl.includes('your-org')) throw new Error('OKTA_ORG_URL belum dikonfigurasi');
    if (!token) throw new Error('OKTA_API_TOKEN belum dikonfigurasi');
  }

  async request(pathOrUrl: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${this.orgUrl}${pathOrUrl}`;
    const res = await fetch(url, {
      ...init,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `SSWS ${this.token}`, ...(init.headers || {}) },
      cache: 'no-store',
    });
    // Rate limit: tunggu hingga X-Rate-Limit-Reset
    if (res.status === 429 && attempt < 5) {
      const reset = Number(res.headers.get('x-rate-limit-reset') || 0) * 1000;
      const wait = Math.min(Math.max(reset - Date.now(), 1000), 60000);
      await new Promise((r) => setTimeout(r, wait));
      return this.request(pathOrUrl, init, attempt + 1);
    }
    if (!res.ok && res.status !== 204) {
      let detail = '';
      try {
        const j = await res.json();
        detail = j.errorSummary || JSON.stringify(j);
      } catch {}
      throw new Error(`Okta API ${res.status} ${init.method || 'GET'} ${url.replace(this.orgUrl, '')}: ${detail}`);
    }
    return res;
  }

  async get<T = any>(path: string): Promise<T> {
    return (await this.request(path)).json();
  }

  /** Iterasi semua halaman berdasarkan header Link rel="next". */
  async paginate<T = any>(path: string, maxPages = 500): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = path;
    let pages = 0;
    while (next && pages < maxPages) {
      const res = await this.request(next);
      out.push(...((await res.json()) as T[]));
      next = parseNextLink(res.headers.get('link'));
      pages++;
    }
    return out;
  }

  async delete(path: string) {
    await this.request(path, { method: 'DELETE' });
  }
}

function parseNextLink(link: string | null) {
  if (!link) return null;
  for (const part of link.split(',')) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

export async function getOktaClient() {
  const { okta } = await getConfig();
  return new OktaClient(okta.orgUrl, okta.apiToken);
}

export async function testOktaConnection() {
  const client = await getOktaClient();
  const me = await client.get('/api/v1/users/me');
  let org: any = null;
  try {
    org = await client.get('/api/v1/org');
  } catch {}
  return { ok: true, tokenOwner: me?.profile?.login, orgName: org?.companyName || null };
}

/* ======================= Klasifikasi & heuristik ======================= */
const NON_HUMAN_RX = /^(svc|service|bot|api|sa|system|integration|automation)[-_.]/i;

export function classifyIdentity(profile: any): 'human' | 'service' | 'bot' | 'api' {
  const t = `${profile.userType || ''} ${profile.employeeType || ''}`.toLowerCase();
  const login = String(profile.login || '');
  if (/bot/.test(t) || /^bot[-_.]/i.test(login)) return 'bot';
  if (/\bapi\b/.test(t) || /^api[-_.]/i.test(login)) return 'api';
  if (/service|system|non.?human/.test(t) || NON_HUMAN_RX.test(login)) return 'service';
  return 'human';
}

export function entitlementRisk(name: string): { riskLevel: string; privileged: boolean } {
  const n = name.toLowerCase();
  if (/super ?admin|org ?admin|root|domain admin/.test(n)) return { riskLevel: 'critical', privileged: true };
  if (/admin|approv|release|deploy|payroll|treasury|bank|privileged|prod/.test(n)) return { riskLevel: 'high', privileged: /admin|deploy|privileged|prod|release/.test(n) };
  if (/finance|hr|write|edit|create|maint|manage|journal|vendor/.test(n)) return { riskLevel: 'medium', privileged: false };
  return { riskLevel: 'low', privileged: false };
}

export function lifecycleFor(i: { status: string; lastLogin?: Date | null; sourceCreatedAt?: Date | null; isMover?: boolean }) {
  if (['DEPROVISIONED', 'SUSPENDED'].includes(i.status)) return 'leaver';
  if (i.isMover) return 'mover';
  if (i.sourceCreatedAt && i.sourceCreatedAt > daysAgo(30)) return 'joiner';
  if (!i.lastLogin || i.lastLogin < daysAgo(90)) return 'inactive';
  return 'active';
}

/* ======================= Full sync ======================= */
type SyncState = { running: boolean; startedAt?: Date; finishedAt?: Date; step?: string; error?: string; result?: any };
const g = global as any;
const state: SyncState = g.__oktaSync || (g.__oktaSync = { running: false });
export const getSyncState = () => state;

export async function syncFromOkta(actor = 'system') {
  if (state.running) throw new Error('Sinkronisasi sedang berjalan');
  Object.assign(state, { running: true, startedAt: new Date(), finishedAt: undefined, error: undefined, step: 'connecting' });
  const t0 = Date.now();
  const token = `sync-${t0}`;
  try {
    const client = await getOktaClient();

    // ---------- Users ----------
    state.step = 'users';
    const active = await client.paginate<any>('/api/v1/users?limit=200');
    let deprov: any[] = [];
    try {
      deprov = await client.paginate<any>(`/api/v1/users?limit=200&search=${encodeURIComponent('status eq "DEPROVISIONED"')}`);
    } catch {}
    const users = [...active, ...deprov];
    const existing = new Map((await Identity.find({ source: 'okta' }).lean<any[]>()).map((i) => [i.oktaId, i]));
    const now = new Date();
    const userOps = users.map((u) => {
      const p = u.profile || {};
      const prev = existing.get(u.id);
      const isMover = !!(prev && prev.department && p.department && prev.department !== p.department);
      const recentMover = !!(prev?.departmentChangedAt && prev.departmentChangedAt > daysAgo(60));
      const lastLogin = u.lastLogin ? new Date(u.lastLogin) : null;
      const sourceCreatedAt = u.created ? new Date(u.created) : null;
      const set: any = {
        oktaId: u.id,
        login: p.login,
        email: (p.email || '').toLowerCase(),
        firstName: p.firstName,
        lastName: p.lastName,
        displayName: p.displayName || [p.firstName, p.lastName].filter(Boolean).join(' ') || p.login,
        department: p.department || '',
        title: p.title || '',
        location: p.city || p.countryCode || '',
        employeeType: p.employeeType || p.userType || '',
        managerRef: p.managerId || p.manager || '',
        status: u.status,
        identityType: classifyIdentity(p),
        lastLogin,
        sourceCreatedAt,
        statusChangedAt: u.statusChanged ? new Date(u.statusChanged) : null,
        lifecycle: lifecycleFor({ status: u.status, lastLogin, sourceCreatedAt, isMover: isMover || recentMover }),
        source: 'okta',
        lastSyncedAt: now,
      };
      if (isMover) {
        set.previousDepartment = prev.department;
        set.departmentChangedAt = now;
      }
      return { updateOne: { filter: { oktaId: u.id }, update: { $set: set }, upsert: true } };
    });
    if (userOps.length) await Identity.bulkWrite(userOps);

    // resolve manager -> managerId (berdasarkan Okta id, login, email, atau employeeNumber)
    const all = await Identity.find({ source: 'okta' }, { oktaId: 1, login: 1, email: 1, managerRef: 1 }).lean<any[]>();
    const lookup = new Map<string, any>();
    all.forEach((i) => {
      [i.oktaId, i.login?.toLowerCase(), i.email].filter(Boolean).forEach((k) => lookup.set(k, i._id));
    });
    const empNo = new Map<string, any>();
    users.forEach((u) => u.profile?.employeeNumber && empNo.set(String(u.profile.employeeNumber), u.id));
    const mgrOps = all
      .filter((i) => i.managerRef)
      .map((i) => {
        const ref = String(i.managerRef);
        const mid = lookup.get(ref) || lookup.get(ref.toLowerCase()) || lookup.get(empNo.get(ref));
        return mid ? { updateOne: { filter: { _id: i._id }, update: { $set: { managerId: mid } } } } : null;
      })
      .filter(Boolean) as any[];
    if (mgrOps.length) await Identity.bulkWrite(mgrOps);
    const idByOkta = new Map(all.map((i) => [i.oktaId, i._id]));

    // ---------- Apps ----------
    state.step = 'applications';
    const apps = await client.paginate<any>('/api/v1/apps?limit=200');
    const appIdByOkta = new Map<string, any>();
    const groupAppByOkta = new Map<string, string>();
    let assignmentCount = 0;
    for (const a of apps) {
      const doc = await Application.findOneAndUpdate(
        { oktaId: a.id },
        { $set: { oktaId: a.id, name: a.name, label: a.label, status: a.status, signOnMode: a.signOnMode, source: 'okta' } },
        { upsert: true, new: true },
      );
      appIdByOkta.set(a.id, doc._id);
      const risk = entitlementRisk(a.label || a.name);
      const ent = await Entitlement.findOneAndUpdate(
        { oktaId: `app:${a.id}` },
        {
          $set: { oktaId: `app:${a.id}`, kind: 'app', name: `${a.label} - Access`, applicationId: doc._id, source: 'okta' },
          $setOnInsert: { riskLevel: risk.riskLevel, privileged: risk.privileged },
        },
        { upsert: true, new: true },
      );
      if (a.status !== 'ACTIVE') continue;
      try {
        const appUsers = await client.paginate<any>(`/api/v1/apps/${a.id}/users?limit=500`);
        assignmentCount += await upsertAssignments(
          appUsers.map((u) => ({ identityId: idByOkta.get(u.id), grantedAt: u.created ? new Date(u.created) : undefined })),
          ent._id,
          token,
        );
      } catch (e: any) {
        console.warn('[okta] app users failed', a.label, e.message);
      }
      try {
        const appGroups = await client.paginate<any>(`/api/v1/apps/${a.id}/groups?limit=200`);
        for (const group of appGroups) groupAppByOkta.set(group.id, a.id);
      } catch (e: any) {
        console.warn('[okta] app groups failed', a.label, e.message);
      }
    }

    // ---------- Groups ----------
    state.step = 'groups';
    const groups = await client.paginate<any>('/api/v1/groups?limit=200&expand=app');
    for (const gr of groups) {
      const name = gr.profile?.name || gr.id;
      const risk = entitlementRisk(name);
      const appOktaId = groupAppByOkta.get(gr.id) || gr._embedded?.app?.id;
      const ent = await Entitlement.findOneAndUpdate(
        { oktaId: gr.id },
        {
          $set: {
            oktaId: gr.id,
            kind: 'group',
            name,
            description: gr.profile?.description || '',
            source: 'okta',
            ...(appOktaId && appIdByOkta.get(appOktaId) ? { applicationId: appIdByOkta.get(appOktaId) } : {}),
          },
          $setOnInsert: { riskLevel: risk.riskLevel, privileged: risk.privileged },
        },
        { upsert: true, new: true },
      );
      try {
        const members = await client.paginate<any>(`/api/v1/groups/${gr.id}/users?limit=500`);
        assignmentCount += await upsertAssignments(members.map((u) => ({ identityId: idByOkta.get(u.id) })), ent._id, token);
      } catch (e: any) {
        console.warn('[okta] group members failed', name, e.message);
      }
    }

    // hapus assignment Okta yang tidak lagi ada
    state.step = 'cleanup';
    await Assignment.deleteMany({ source: 'okta', syncToken: { $ne: token } });

    // ---------- Usage data dari System Log (SSO events 30 hari) ----------
    state.step = 'usage';
    await syncUsageFromSystemLog(client, appIdByOkta, idByOkta).catch((e) => console.warn('[okta] usage sync failed', e.message));

    // ---------- Semua event System Log (activity) ----------
    state.step = 'activity';
    const events = await pullOktaEvents(client).catch((e) => {
      console.warn('[okta] activity pull failed', e.message);
      return null;
    });

    // ---------- Analitik ----------
    state.step = 'sod-scan';
    const sod = await runSodScan({ notify: true });

    const result = { users: users.length, groups: groups.length, apps: apps.length, assignments: assignmentCount, events: events?.fetched ?? null, sod, duration: Math.round((Date.now() - t0) / 1000) };
    await Setting.updateOne({ key: 'okta.lastSync' }, { $set: { value: { at: new Date(), result } } }, { upsert: true });
    Object.assign(state, { running: false, finishedAt: new Date(), step: 'done', result });
    await audit(actor, 'okta.sync', 'okta', result);
    await emit('okta.sync.completed', { vars: result });
    return result;
  } catch (e: any) {
    Object.assign(state, { running: false, finishedAt: new Date(), step: 'failed', error: e.message });
    await audit(actor, 'okta.sync.failed', 'okta', { error: e.message });
    await emit('okta.sync.failed', { vars: { error: e.message } });
    throw e;
  }
}

async function upsertAssignments(rows: { identityId: any; grantedAt?: Date }[], entitlementId: any, token: string) {
  const ops = rows
    .filter((r) => r.identityId)
    .map((r) => ({
      updateOne: {
        filter: { identityId: r.identityId, entitlementId },
        update: { $set: { source: 'okta', syncToken: token }, $setOnInsert: { grantedAt: r.grantedAt || new Date() } },
        upsert: true,
      },
    }));
  if (ops.length) await Assignment.bulkWrite(ops, { ordered: false });
  return ops.length;
}

async function syncUsageFromSystemLog(client: OktaClient, appIdByOkta: Map<string, any>, idByOkta: Map<string, any>) {
  const since = daysAgo(30).toISOString();
  const filter = encodeURIComponent('eventType eq "user.authentication.sso"');
  const events = await client.paginate<any>(`/api/v1/logs?since=${since}&filter=${filter}&limit=1000`, 10);
  const latest = new Map<string, Date>(); // identityId:appEntitlementOktaId
  for (const ev of events) {
    const uid = ev.actor?.id;
    const target = (ev.target || []).find((t: any) => t.type === 'AppInstance');
    if (!uid || !target) continue;
    const key = `${uid}|${target.id}`;
    const at = new Date(ev.published);
    if (!latest.has(key) || latest.get(key)! < at) latest.set(key, at);
  }
  const ents = await Entitlement.find({ kind: 'app', source: 'okta' }, { oktaId: 1 }).lean<any[]>();
  const entByApp = new Map(ents.map((e) => [String(e.oktaId).replace('app:', ''), e._id]));
  const ops: any[] = [];
  for (const [key, at] of latest) {
    const [uid, appId] = key.split('|');
    const identityId = idByOkta.get(uid);
    const entitlementId = entByApp.get(appId);
    if (identityId && entitlementId) ops.push({ updateOne: { filter: { identityId, entitlementId }, update: { $set: { lastUsedAt: at } } } });
  }
  if (ops.length) await Assignment.bulkWrite(ops, { ordered: false });
}

/* ======================= System Log → OktaEvent (semua event) ======================= */
/** Kategori dipakai untuk filter di UI (label ada di components/OktaEvents.tsx). */
export function eventCategory(t: string) {
  if (/access[._]request/.test(t)) return 'request';
  if (t.startsWith('group.user_membership')) return 'group';
  if (/^(application|app)\.user_membership/.test(t)) return 'app_access';
  if (t.startsWith('user.lifecycle')) return 'lifecycle';
  if (/^user\.(session|authentication|mfa)|^policy\.evaluate_sign_on/.test(t)) return 'auth';
  if (t.startsWith('user.')) return 'account';
  if (/^(group|application|app|policy|system|zone|iam|oauth2|security)\./.test(t)) return 'admin';
  return 'other';
}

const pickActor = (a: any) => (a ? { id: a.id, type: a.type, alternateId: a.alternateId, displayName: a.displayName } : null);

function toEventDoc(ev: any) {
  const targets = (ev.target || []).map(pickActor);
  const userIds = Array.from(new Set([ev.actor?.type === 'User' ? ev.actor.id : null, ...(ev.target || []).filter((t: any) => t.type === 'User').map((t: any) => t.id)].filter(Boolean)));
  const geo = ev.client?.geographicalContext;
  return {
    uuid: ev.uuid,
    published: new Date(ev.published),
    eventType: ev.eventType,
    category: eventCategory(ev.eventType || ''),
    displayMessage: ev.displayMessage,
    severity: ev.severity,
    outcome: ev.outcome?.result,
    outcomeReason: ev.outcome?.reason,
    actor: pickActor(ev.actor),
    targets,
    userIds,
    ipAddress: ev.client?.ipAddress,
    location: [geo?.city, geo?.country].filter(Boolean).join(', '),
    raw: JSON.stringify(ev),
  };
}

type EventsState = { running: boolean; startedAt?: Date; finishedAt?: Date; fetched?: number; error?: string };
const evState: EventsState = g.__oktaEvents || (g.__oktaEvents = { running: false });
export const getEventsState = () => evState;

/**
 * Tarik semua event System Log secara inkremental (cursor di Setting 'okta.eventsCursor').
 * Penarikan pertama mengambil ~90 hari (batas retensi Okta). Event di-dedupe berdasarkan uuid.
 */
export async function pullOktaEvents(client?: OktaClient) {
  if (evState.running) throw new Error('Penarikan log Okta sedang berjalan');
  Object.assign(evState, { running: true, startedAt: new Date(), finishedAt: undefined, error: undefined, fetched: 0 });
  try {
    const c = client || (await getOktaClient());
    const cursor = await Setting.findOne({ key: 'okta.eventsCursor' }).lean<any>();
    // overlap 5 menit agar event yang terlambat masuk tetap terambil (duplikat diabaikan via uuid)
    const since = cursor?.value ? new Date(new Date(cursor.value).getTime() - 5 * 60000) : daysAgo(89);
    const until = new Date();
    let next: string | null = `/api/v1/logs?since=${since.toISOString()}&until=${until.toISOString()}&sortOrder=ASCENDING&limit=1000`;
    let pages = 0;
    while (next && pages < 2000) {
      const res = await c.request(next);
      const events = (await res.json()) as any[];
      if (!events.length) break;
      await OktaEvent.bulkWrite(
        events.map((ev) => ({ updateOne: { filter: { uuid: ev.uuid }, update: { $setOnInsert: toEventDoc(ev) }, upsert: true } })),
        { ordered: false },
      );
      evState.fetched = (evState.fetched || 0) + events.length;
      await Setting.updateOne({ key: 'okta.eventsCursor' }, { $set: { value: events[events.length - 1].published } }, { upsert: true });
      next = parseNextLink(res.headers.get('link'));
      pages++;
    }
    await Setting.updateOne({ key: 'okta.eventsCursor' }, { $set: { value: until.toISOString() } }, { upsert: true });
    const result = { fetched: evState.fetched || 0, at: new Date() };
    await Setting.updateOne({ key: 'okta.lastEventsPull' }, { $set: { value: result } }, { upsert: true });
    Object.assign(evState, { running: false, finishedAt: new Date() });
    return result;
  } catch (e: any) {
    Object.assign(evState, { running: false, finishedAt: new Date(), error: e.message });
    throw e;
  }
}

/* ======================= Remediation (revoke di Okta) ======================= */
export async function revokeInOkta(identity: any, entitlement: any) {
  const client = await getOktaClient();
  if (!identity.oktaId || !entitlement.oktaId) throw new Error('Identity/entitlement tidak berasal dari Okta');
  if (entitlement.kind === 'group') await client.delete(`/api/v1/groups/${entitlement.oktaId}/users/${identity.oktaId}`);
  else if (entitlement.kind === 'app') await client.delete(`/api/v1/apps/${String(entitlement.oktaId).replace('app:', '')}/users/${identity.oktaId}`);
  else throw new Error(`Remediasi untuk tipe ${entitlement.kind} belum didukung`);
}
