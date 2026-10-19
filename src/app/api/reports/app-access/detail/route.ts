import { route, ADMIN_AUDITOR, HttpError } from '@/lib/api';
import { Application, Assignment, Campaign, CertItem, Entitlement, Identity, OktaEvent, Role, SodPolicy, SodViolation } from '@/lib/models';
import { accessRequestsFor } from '@/lib/accessRequests';
import { getOktaClient, OktaClient } from '@/lib/okta';
import { daysAgo } from '@/lib/util';

export const dynamic = 'force-dynamic';

type Source = { kind: 'okta' | 'mongo'; endpoint: string; description: string; ok?: boolean; error?: string; data?: any };

/**
 * Everything known about one user's access to one application: the live Okta app account,
 * the groups that grant it, OIG entitlements, access requests + approvers, SoD violations,
 * certifications, mined roles and System Log activity. Every query is listed in `sources`
 * together with its JSON so the UI can show where each value came from.
 */
export const GET = route(async ({ query }) => {
  const [identity, application] = await Promise.all([
    Identity.findById(query.get('identityId')).lean<any>(),
    Application.findById(query.get('applicationId')).lean<any>(),
  ]);
  if (!identity || !application) throw new HttpError(404, 'User or application not found');
  const userId = identity.oktaId as string | undefined;
  const appId = application.oktaId as string | undefined;

  const sources: Source[] = [];
  const collect = <T>(kind: Source['kind'], endpoint: string, description: string, fn: () => Promise<T>): Promise<T | null> => {
    const entry: Source = { kind, endpoint, description };
    sources.push(entry);
    return fn().then(
      (data) => { Object.assign(entry, { ok: true, data }); return data; },
      (e: any) => { Object.assign(entry, { ok: false, error: e?.message || String(e) }); return null; },
    );
  };

  // ---------- Okta (live) ----------
  const okta: OktaClient | null = userId && appId ? await getOktaClient().catch((e: any) => { sources.push({ kind: 'okta', endpoint: '—', description: 'Okta client', ok: false, error: e.message }); return null; }) : null;
  const governanceFilter = encodeURIComponent(`parent.externalId eq "${appId}" AND parent.type eq "APPLICATION" AND targetPrincipal.externalId eq "${userId}" AND targetPrincipal.type eq "OKTA_USER"`);
  const [oktaApp, appUser, appGroups, userGroups, oigEntitlements]: any[] = okta
    ? await Promise.all([
      collect('okta', `GET /api/v1/apps/${appId}`, 'Application settings and features', () => okta.get(`/api/v1/apps/${appId}`)),
      collect('okta', `GET /api/v1/apps/${appId}/users/${userId}`, "User's app account: scope, status, username, app profile", () => okta.get(`/api/v1/apps/${appId}/users/${userId}`)),
      collect('okta', `GET /api/v1/apps/${appId}/groups?expand=group`, 'Groups assigned to the application (priority + group app profile)', () => okta.paginate<any>(`/api/v1/apps/${appId}/groups?limit=200&expand=group`, 10)),
      collect('okta', `GET /api/v1/users/${userId}/groups`, "User's current Okta groups", () => okta.paginate<any>(`/api/v1/users/${userId}/groups?limit=200`, 10)),
      collect('okta', `GET /governance/api/v1/principal-entitlements?filter=…`, 'Okta Identity Governance entitlements for this user in the app', () => okta.get(`/governance/api/v1/principal-entitlements?filter=${governanceFilter}`)),
    ])
    : [null, null, null, null, null];

  // ---------- MongoDB (synced) ----------
  const appEntitlements = await collect('mongo', `entitlements.find({ applicationId: ${application._id} })`, 'Synced entitlements of this app (app access + app-linked groups)',
    () => Entitlement.find({ applicationId: application._id }).lean<any[]>()) || [];
  const entitlementIds = appEntitlements.map((entitlement) => entitlement._id);
  const [assignments, violations, certItems, roles, requests, events, ssoCount] = await Promise.all([
    collect('mongo', `assignments.find({ identityId, entitlementId: { $in: [${entitlementIds.length}] } })`, "User's synced assignments for this app",
      () => Assignment.find({ identityId: identity._id, entitlementId: { $in: entitlementIds } }).lean<any[]>()),
    collect('mongo', 'sodviolations.find({ identityId, matchedA|matchedB ∈ app entitlements })', 'Separation-of-duties violations involving this app',
      () => SodViolation.find({ identityId: identity._id, $or: [{ matchedA: { $in: entitlementIds } }, { matchedB: { $in: entitlementIds } }] }).lean<any[]>()),
    collect('mongo', 'certitems.find({ identityId, applicationId | entitlementId ∈ app })', 'Access certification decisions for this app',
      () => CertItem.find({ identityId: identity._id, $or: [{ applicationId: application._id }, { entitlementId: { $in: entitlementIds } }] }).sort({ createdAt: -1 }).limit(20).lean<any[]>()),
    collect('mongo', 'roles.find({ memberIds: identityId, entitlementIds ∈ app })', 'Mined / business roles that include this app',
      () => Role.find({ memberIds: identity._id, entitlementIds: { $in: entitlementIds } }, { name: 1, status: 1, source: 1, confidence: 1, coverage: 1 }).lean<any[]>()),
    userId ? collect('mongo', 'oktaevents: access.request.create / update / resolve (Okta System Log)', 'Okta Identity Governance access requests and approval steps',
      async () => (await accessRequestsFor(userId)).filter((request) => request.resourceId === appId || appEntitlements.some((entitlement) => entitlement.oktaId === request.resourceId))) : null,
    userId && appId ? collect('mongo', 'oktaevents.find({ user + app }).limit(30)', 'Latest Okta System Log events involving this user and app',
      () => OktaEvent.find({ $or: [{ 'targets.id': { $all: [userId, appId] } }, { 'actor.id': userId, 'targets.id': appId }] }, { raw: 0 }).sort({ published: -1 }).limit(30).lean<any[]>()) : null,
    userId && appId ? OktaEvent.countDocuments({ eventType: 'user.authentication.sso', 'actor.id': userId, 'targets.id': appId, published: { $gte: daysAgo(30) } }) : 0,
  ]);

  // names for SoD sides and certification campaigns
  const [policies, matched, campaigns] = await Promise.all([
    SodPolicy.find({ _id: { $in: (violations || []).map((violation) => violation.policyId) } }, { name: 1, severity: 1, sideA: 1, sideB: 1, mitigation: 1 }).lean<any[]>(),
    Entitlement.find({ _id: { $in: (violations || []).flatMap((violation) => [...(violation.matchedA || []), ...(violation.matchedB || [])]) } }, { name: 1 }).lean<any[]>(),
    Campaign.find({ _id: { $in: (certItems || []).map((item) => item.campaignId) } }, { name: 1, status: 1 }).lean<any[]>(),
  ]);
  const policyOf = new Map(policies.map((policy) => [String(policy._id), policy]));
  const entitlementName = new Map([...appEntitlements, ...matched].map((entitlement) => [String(entitlement._id), entitlement.name]));
  const campaignOf = new Map(campaigns.map((campaign) => [String(campaign._id), campaign]));
  const names = (ids: any[] = []) => ids.map((id) => entitlementName.get(String(id)) || String(id));

  // groups of the user that grant this app (live from Okta, falling back to the synced data)
  const userGroupIds = new Set((userGroups || []).map((group: any) => group.id));
  const grantingGroups = appGroups && userGroups
    ? appGroups.filter((group: any) => userGroupIds.has(group.id)).map((group: any) => ({ id: group.id, name: group._embedded?.group?.profile?.name || group.id, priority: group.priority, profile: group.profile || {}, source: 'okta' }))
    : appEntitlements.filter((entitlement) => entitlement.kind === 'group' && (assignments || []).some((assignment) => String(assignment.entitlementId) === String(entitlement._id)))
      .map((entitlement) => ({ id: entitlement.oktaId, name: entitlement.name, priority: undefined, profile: {}, source: 'mongo' }));

  const oigItems: any[] = oigEntitlements?.data || (Array.isArray(oigEntitlements) ? oigEntitlements : []);
  const lastUsedAt = (assignments || []).map((assignment) => assignment.lastUsedAt).filter(Boolean).sort().pop();

  return {
    application: {
      _id: application._id, oktaId: appId, label: application.label, name: application.name, status: oktaApp?.status || application.status,
      signOnMode: oktaApp?.signOnMode || application.signOnMode, owner: application.owner, riskLevel: application.riskLevel,
      created: oktaApp?.created, lastUpdated: oktaApp?.lastUpdated, features: oktaApp?.features || [],
    },
    account: appUser && {
      scope: appUser.scope, status: appUser.status, syncState: appUser.syncState, userName: appUser.credentials?.userName,
      externalId: appUser.externalId, created: appUser.created, statusChanged: appUser.statusChanged, lastUpdated: appUser.lastUpdated,
      lastSync: appUser.lastSync, passwordChanged: appUser.passwordChanged, viaGroup: appUser._links?.group?.name, profile: appUser.profile || {},
    },
    groups: grantingGroups,
    entitlements: oigItems.map((item) => ({
      name: item.name || item.entitlement?.name || item.id,
      values: (item.values || item.entitlementValues || []).map((value: any) => value.name || value.externalValue || value.id),
      grantType: item.grantType || item.assignmentType,
    })),
    usage: { lastUsedAt, sso30d: ssoCount },
    requests: requests || [],
    sod: (violations || []).map((violation) => {
      const policy = policyOf.get(String(violation.policyId));
      return {
        id: violation._id, policy: policy?.name || 'Unknown policy', severity: violation.severity || policy?.severity, status: violation.status,
        sideA: { label: policy?.sideA?.label, entitlements: names(violation.matchedA) }, sideB: { label: policy?.sideB?.label, entitlements: names(violation.matchedB) },
        detectedAt: violation.detectedAt, mitigation: policy?.mitigation, note: violation.note,
      };
    }),
    certifications: (certItems || []).map((item) => ({
      id: item._id, campaign: campaignOf.get(String(item.campaignId))?.name || 'Campaign', entitlement: entitlementName.get(String(item.entitlementId)),
      decision: item.decision, reviewer: item.reviewer, decidedBy: item.decidedBy, decidedAt: item.decidedAt, comment: item.comment, dueDate: item.dueDate,
    })),
    roles: roles || [],
    events: (events || []).map((event) => ({ id: event.uuid, published: event.published, eventType: event.eventType, message: event.displayMessage, actor: event.actor?.displayName || event.actor?.alternateId, outcome: event.outcome })),
    // the raw JSON of every source is only sent when asked for (?json=1, the modal's "View more")
    sources: query.get('json') === '1' ? sources : sources.map(({ data, ...source }) => source),
  };
}, ADMIN_AUDITOR);
