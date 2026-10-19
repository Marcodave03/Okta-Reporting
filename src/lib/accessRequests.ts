import { OktaEvent } from './models';

const nameOf = (value: any) => value?.displayName || value?.alternateId || value?.id || '';
export const hasTarget = (event: any, oktaId?: string) => !!oktaId && (event.targets || []).some((target: any) => target.id === oktaId);
const debugDataOf = (event: any) => { try { return JSON.parse(event.raw || '{}').debugContext?.debugData || {}; } catch { return {}; } };
export const personOf = (actor: any, role: string, at: Date) => ({ name: nameOf(actor), login: actor?.alternateId || '', role, at });

/**
 * Okta Identity Governance access requests made for a user, rebuilt from the System Log:
 * - `access.request.create`: requester (actor), requestedForId / requestedResourceId / accessRequestId in debugData
 * - `access.request.update` "Task … was resolved": one approval step, actor = approver
 * - `access.request.resolve` / `.cancel` / `.expire`: final state of the request
 */
export async function accessRequestsFor(oktaId: string) {
  const created = await OktaEvent.find({ eventType: 'access.request.create', raw: new RegExp(`"requestedForId":"${oktaId}"`) }).sort({ published: 1 }).lean<any[]>();
  const requests = created.map((event) => {
    const data = debugDataOf(event);
    return {
      id: data.accessRequestId as string,
      number: data.permalinkId as string,
      subject: (data.accessRequestSubject as string) || nameOf(event.targets?.[0]),
      resourceId: data.requestedResourceId as string,
      resourceType: data.requestedResourceType as string,
      requester: personOf(event.actor, 'Requester', event.published),
      createdAt: new Date(event.published),
      status: 'open',
      closedAt: undefined as Date | undefined,
      approvers: [] as any[],
    };
  }).filter((request) => request.id);
  if (!requests.length) return [];
  const ids = requests.map((request) => request.id);
  const [steps, closures] = await Promise.all([
    OktaEvent.find({ eventType: 'access.request.update', 'actor.type': 'User', 'targets.id': { $in: ids }, 'targets.displayName': /was resolved$/i }, { raw: 0 }).sort({ published: 1 }).lean<any[]>(),
    OktaEvent.find({ eventType: { $in: ['access.request.resolve', 'access.request.cancel', 'access.request.expire'] }, 'targets.id': { $in: ids } }, { raw: 0 }).sort({ published: 1 }).lean<any[]>(),
  ]);
  for (const request of requests) {
    for (const step of steps.filter((event) => hasTarget(event, request.id))) {
      request.approvers.push(personOf(step.actor, `Approver ${request.approvers.length + 1}`, step.published));
    }
    const closed = closures.filter((event) => hasTarget(event, request.id)).pop();
    if (closed) {
      request.status = closed.eventType.split('.').pop() === 'resolve' ? 'resolved' : closed.eventType.split('.').pop() === 'cancel' ? 'canceled' : 'expired';
      request.closedAt = closed.published;
    }
  }
  return requests;
}

/**
 * Who granted the current access: the approvers of the access request that led to it (multi-level approval
 * lists every approver), plus the actor of the latest membership-add event unless that was just Okta System
 * fulfilling the approved request. addEvents must be sorted newest first.
 */
export function assignedByOf(addEvents: any[], requests: any[], targetOktaId?: string) {
  const added = addEvents.find((event) => hasTarget(event, targetOktaId));
  if (!added) return [];
  // the approved request is provisioned within seconds; a 1h window keeps an older (e.g. rejected) request from being credited
  const at = new Date(added.published).getTime();
  const request = requests.filter((item) => {
    const lastApproval = item.approvers.length ? new Date(item.approvers[item.approvers.length - 1].at).getTime() : NaN;
    return item.resourceId === targetOktaId && lastApproval <= at + 5 * 60000 && lastApproval >= at - 3600000;
  }).pop();
  const people = request ? [...request.approvers] : [];
  if (!request || added.actor?.type === 'User') people.push(personOf(added.actor, 'Assigned in Okta', added.published));
  return people;
}
