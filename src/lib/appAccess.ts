import { Application, Assignment, Entitlement, Identity, OktaEvent } from './models';
import { accessRequestsFor, assignedByOf } from './accessRequests';

const nameOf = (value: any) => value?.displayName || value?.alternateId || value?.id || '';
// the application itself (type "AppInstance"), not the app account (type "AppUser")
const appTarget = (event: any) => (event.targets || []).find((target: any) => target.type === 'AppInstance') || (event.targets || []).find((target: any) => /app/i.test(target.type || '') && target.type !== 'AppUser');
// the Okta user (type "User"), not the app account (type "AppUser") that is listed before it
const userTarget = (event: any) => (event.targets || []).find((target: any) => target.type === 'User') || (event.targets || []).find((target: any) => /user/i.test(target.type || ''));
const actionOf = (event: any) => /(^|\.)(remove|delete)(\.|$)/i.test(event.eventType || '') ? 'revoked' : 'granted';

/** One user's application access: current apps (with who assigned them), System Log history, groups and access requests. */
export async function userAppAccess(identityId: string) {
  const identity = await Identity.findById(identityId).lean<any>();
  if (!identity) return null;
  const assignments = await Assignment.find({ identityId: identity._id }).lean<any[]>();
  const entitlementIds = assignments.map((assignment) => assignment.entitlementId);
  const entitlements = await Entitlement.find({ _id: { $in: entitlementIds } }).lean<any[]>();
  const entitlementMap = new Map(entitlements.map((entitlement) => [String(entitlement._id), entitlement]));
  const applications = await Application.find({}).lean<any[]>();
  const applicationMap = new Map(applications.map((application) => [String(application._id), application]));
  const [addEvents, requests, manager] = await Promise.all([
    identity.oktaId
      ? OktaEvent.find({ eventType: { $in: ['application.user_membership.add', 'group.user_membership.add'] }, 'targets.id': identity.oktaId }, { raw: 0 }).sort({ published: -1 }).lean<any[]>()
      : [],
    identity.oktaId ? accessRequestsFor(identity.oktaId) : [],
    identity.managerId ? Identity.findById(identity.managerId, { displayName: 1, email: 1 }).lean<any>() : null,
  ]);
  const directAppAssignments = assignments
    .map((assignment) => ({ assignment, entitlement: entitlementMap.get(String(assignment.entitlementId)) }))
    .filter(({ entitlement }) => entitlement?.kind === 'app')
    .map(({ assignment, entitlement }) => {
      const application = applicationMap.get(String(entitlement?.applicationId));
      return {
        id: String(assignment._id),
        application: application?.label || application?.name || 'Unknown application',
        applicationId: application?._id,
        role: entitlement?.name || 'Direct application assignment',
        access: 'granted',
        accessSource: 'Direct assignment',
        group: undefined,
        assignedAt: assignment.grantedAt || assignment.createdAt,
        lastUsedAt: assignment.lastUsedAt,
        reason: 'Current assignment from Okta sync',
        assignedBy: assignedByOf(addEvents, requests, application?.oktaId),
      };
    });
  const groupApplicationAssignments = assignments
    .map((assignment) => ({ assignment, entitlement: entitlementMap.get(String(assignment.entitlementId)) }))
    .filter(({ entitlement }) => entitlement?.kind === 'group' && entitlement.applicationId)
    .map(({ assignment, entitlement }) => {
      const application = applicationMap.get(String(entitlement?.applicationId));
      return {
        id: `${String(assignment._id)}:application`,
        application: application?.label || application?.name || 'Unknown application',
        applicationId: application?._id,
        role: entitlement?.name || 'Group-based application access',
        access: 'granted',
        accessSource: 'Group assignment',
        assignedAt: assignment.grantedAt || assignment.createdAt,
        lastUsedAt: assignment.lastUsedAt,
        reason: `Access inherited through ${entitlement?.name || 'Okta group'}`,
        group: entitlement?.name,
        assignedBy: assignedByOf(addEvents, requests, entitlement?.oktaId),
      };
    });
  const groupAssignments = assignments
    .map((assignment) => ({ assignment, entitlement: entitlementMap.get(String(assignment.entitlementId)) }))
    .filter(({ entitlement }) => entitlement?.kind === 'group')
    .map(({ assignment, entitlement }) => ({
      id: String(assignment._id),
      group: entitlement?.name || 'Unknown group',
      role: entitlement?.privileged ? 'Privileged group' : 'Group membership',
      accessSource: 'Group membership',
      joinedAt: assignment.grantedAt || assignment.createdAt,
      application: entitlement?.applicationId ? applicationMap.get(String(entitlement.applicationId))?.label || applicationMap.get(String(entitlement.applicationId))?.name : '',
    }));

  const currentApplications = [...directAppAssignments, ...groupApplicationAssignments].reduce((result: any[], row) => {
    const key = String(row.applicationId || row.application).toLowerCase();
    const existing = result.find((item) => String(item.applicationId || item.application).toLowerCase() === key);
    if (!existing) {
      result.push({ ...row, sources: [row.accessSource], roles: [row.role], groups: row.group ? [row.group] : [], assignedBy: [...row.assignedBy] });
    } else {
      existing.sources = Array.from(new Set([...existing.sources, row.accessSource]));
      existing.roles = Array.from(new Set([...existing.roles, row.role]));
      existing.groups = Array.from(new Set([...existing.groups, ...(row.group ? [row.group] : [])]));
      for (const person of row.assignedBy) {
        if (!existing.assignedBy.some((item: any) => item.name === person.name && item.role === person.role)) existing.assignedBy.push(person);
      }
      if (new Date(row.assignedAt || 0) < new Date(existing.assignedAt || 0)) existing.assignedAt = row.assignedAt;
    }
    return result;
  }, []);

  const events = identity.oktaId
    ? await OktaEvent.find({ category: 'app_access', userIds: identity.oktaId }).sort({ published: -1 }).limit(500).lean<any[]>()
    : [];
  const history = events.map((event) => {
    const target = appTarget(event);
    const application = target?.id ? applications.find((item) => item.oktaId === target.id) : null;
    return {
      id: event.uuid,
      application: application?.label || application?.name || nameOf(target) || 'Unknown application',
      role: 'Application access event',
      access: actionOf(event),
      accessSource: 'Okta System Log',
      assignedAt: event.published,
      reason: event.outcomeReason || 'Not provided by Okta',
      actor: nameOf(event.actor),
      eventType: event.eventType,
      outcome: event.outcome,
      targetUser: nameOf(userTarget(event)),
      targetUserId: userTarget(event)?.id,
    };
  });

  return {
    identity: {
      _id: identity._id, oktaId: identity.oktaId, displayName: identity.displayName, login: identity.login, email: identity.email,
      firstName: identity.firstName, lastName: identity.lastName, department: identity.department, title: identity.title,
      location: identity.location, employeeType: identity.employeeType, identityType: identity.identityType, status: identity.status, lifecycle: identity.lifecycle,
      lastLogin: identity.lastLogin, sourceCreatedAt: identity.sourceCreatedAt, riskLevel: identity.riskLevel, riskScore: identity.riskScore,
      manager: manager ? manager.displayName || manager.email : identity.managerRef || '',
    },
    currentApplications,
    history,
    groups: groupAssignments,
    requests,
  };
}
