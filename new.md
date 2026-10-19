# App Access Activity: Okta data mapping

## Purpose

The **App Access Activity** report is a user-centered view of application access. An administrator or auditor selects one identity and can review:

- Identity attributes stored from Okta.
- Current application assignments and the entitlement/role associated with each assignment.
- Historical app-assignment events showing granted or revoked access, timestamp, actor, reason/outcome, and Okta event type.
- Current Okta group memberships.

The report is implemented at `/reports/app-access` and uses the protected API route `/api/reports/app-access`.

## How data is pulled

### Okta sync data

The Okta sync calls these Okta APIs:

1. `GET /api/v1/users` populates the `Identity` collection.
2. `GET /api/v1/apps` populates `Application` records and one app entitlement per application.
3. `GET /api/v1/apps/{appId}/users` creates current `Assignment` records for users assigned to an application.
4. `GET /api/v1/apps/{appId}/groups` maps an Okta application to the groups assigned to that application.
5. `GET /api/v1/groups` populates group entitlements.
6. `GET /api/v1/groups/{groupId}/users` creates current `Assignment` records for group membership.
7. Okta System Log pagination pulls audit events and stores them as `OktaEvent` records.

The sync is incremental for System Log events and deduplicates events by Okta `uuid`. Current assignments are refreshed using a sync token; stale Okta assignments are removed during cleanup.

### System Log events

The event pull stores:

| Okta field | Stored field | Use in report |
|---|---|---|
| `uuid` | `OktaEvent.uuid` | Stable event row key and deduplication |
| `published` | `OktaEvent.published` | Assignment/revocation timestamp |
| `eventType` | `OktaEvent.eventType` | Determine app-assignment event and grant/revoke action |
| `displayMessage` | `OktaEvent.displayMessage` | Event description |
| `actor` | `OktaEvent.actor` | Assignee/actor who performed the change |
| `target[]` | `OktaEvent.targets` | Affected user and application |
| `outcome.result` | `OktaEvent.outcome` | Success/failure outcome |
| `outcome.reason` | `OktaEvent.outcomeReason` | Reason supplied by Okta |
| `client.ipAddress` | `OktaEvent.ipAddress` | Source context available in the general event view |
| raw event | `OktaEvent.raw` | Original event for future detail/audit needs |

Events whose type begins with `application.user_membership` or `app.user_membership` are classified as `app_access`.

## How the report maps data

### Selected user

The user selector searches `Identity.displayName`, `Identity.login`, and `Identity.email`. After selection, the API loads the identity by its MongoDB `_id` and returns only presentation-safe attributes such as name, email, department, title, status, lifecycle, location, employee type, last login, and risk.

### Current application access

`Assignment.identityId` identifies the selected user. Its `entitlementId` is joined to `Entitlement`:

- `Entitlement.kind = app` means the assignment is an application access record.
- `Entitlement.applicationId` joins to `Application`.
- `Entitlement.name` is shown as the role/entitlement.
- `Assignment.grantedAt` (or the assignment creation time) is shown as the assigned timestamp.
- Because current assignment data does not contain an approval reason, the report labels it **Current assignment from Okta sync**.

The report also resolves group-based application access. If a user's current group entitlement has an `applicationId`, that group is mapped to the real `Application` record and displayed as an effective application with. The `applicationId` is populated from Okta's app-to-group relationship (`GET /api/v1/apps/{appId}/groups`), not inferred from a group name:

- The Okta application label/name, such as `HR` or `Core Banking`.
- The group name as the role/entitlement.
- `Group assignment` as the assignment source.
- The group assignment timestamp.
- A reason stating that access is inherited through the Okta group.

This prevents the report from showing only the group name while hiding the actual Okta application the user can access.

### Historical granted and revoked access

The API queries `OktaEvent` where:

```text
category = app_access
userIds contains Identity.oktaId
```

The affected application is resolved from the event target's Okta ID against `Application.oktaId`. The action is mapped as:

- Event type containing `.remove` or `.delete` → `revoked`
- Other app-membership event types → `granted`

The event actor becomes the assignee/actor, `published` becomes the timestamp, and `outcomeReason` becomes the reason. If Okta does not provide an outcome reason, the UI displays **Not provided by Okta** rather than inventing a reason.

### Group membership table

The same selected-user assignments are joined to `Entitlement` records where `kind = group`. The report shows the group name, membership type, optional application context, and assignment timestamp.

### Direct versus effective application access

The application table distinguishes three sources:

- **Direct assignment**: the user is assigned directly to the app entitlement created from `GET /api/v1/apps/{appId}/users`.
- **Group assignment**: the user receives access through a group whose Okta group record is associated with an application.
- **Okta System Log**: a historical grant/revoke event, including actor, timestamp, event type, outcome, and reason.

The first two sources describe current effective access. A revoked event remains historical evidence and is not treated as current access.

## Important limitations

- Okta System Log retention depends on the Okta org and plan; the application stores pulled events permanently after ingestion.
- Okta does not guarantee a business justification or approval reason for every assignment event. The report displays the Okta outcome reason when present and explicitly shows when it is unavailable.
- Current assignments represent the latest successful Okta sync. Historical revocations come from stored System Log events and are not inferred from a missing current assignment.
- A group-based application assignment appears in the group table and may also represent effective application access, depending on the Okta application's assignment model.
