'use client';

import { Fragment, type ReactNode, useState } from 'react';
import { fmtDateTime, useApi } from '@/lib/client';
import { Badge, Button, Empty, ErrorBox, Loading, Modal } from '@/components/ui';

const SEVERITY_TONE: Record<string, string> = { critical: 'danger', high: 'danger', medium: 'warning', low: 'neutral' };
const DECISION_TONE: Record<string, string> = { approved: 'success', revoked: 'danger', pending: 'warning' };
const REQUEST_TONE: Record<string, string> = { resolved: 'success', open: 'warning', canceled: 'neutral', expired: 'neutral' };
const preStyle = { maxHeight: 240, overflow: 'auto', background: 'var(--surface-3)', padding: 12, borderRadius: 8, margin: 0 } as const;

const show = (value: any) => (value === undefined || value === null || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value));

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section>
      <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>{title}{count !== undefined && <span className="muted"> ({count})</span>}</h4>
      {children}
    </section>
  );
}

function MiniTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="table-wrap" style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
      <table className="table"><thead><tr>{head.map((label) => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{rows.map((cells, index) => <tr key={index}>{cells.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** Detail of one user's access to one application, with every data source and its JSON. */
export function AppAccessDetail({ identityId, row, onClose }: { identityId: string; row: any; onClose: () => void }) {
  const url = row?.applicationId ? `/api/reports/app-access/detail?identityId=${encodeURIComponent(identityId)}&applicationId=${encodeURIComponent(row.applicationId)}` : null;
  const detail = useApi<any>(url);
  const [showJson, setShowJson] = useState(false);
  const full = useApi<any>(showJson && url ? `${url}&json=1` : null);
  const data = detail.data;

  return (
    <Modal open={!!row} title={row?.application || 'Application access'} onClose={onClose} width={900}>
      {!row?.applicationId ? <Empty title="No application record" desc="This row is not linked to a synced Okta application." />
        : detail.loading && !data ? <Loading /> : detail.error ? <ErrorBox error={detail.error} /> : data && (
          <div style={{ maxHeight: '70vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18, paddingRight: 4 }}>
            <Section title="Access summary">
              <dl className="kv">
                <dt>Okta application</dt><dd>{data.application.label} <span className="mono muted">{data.application.oktaId}</span></dd>
                <dt>App status / sign-on</dt><dd>{show(data.application.status)} · {show(data.application.signOnMode)}</dd>
                <dt>Role / entitlement</dt><dd>{row.roles?.join(', ') || row.role}</dd>
                <dt>Assignment source</dt><dd>{row.sources?.join(', ') || row.accessSource}{row.groups?.length ? ` (via ${row.groups.join(', ')})` : ''}</dd>
                <dt>Assigned by</dt><dd>{row.assignedBy?.length ? row.assignedBy.map((person: any) => `${person.name} (${person.role})`).join(' → ') : '—'}</dd>
                <dt>Assigned</dt><dd>{fmtDateTime(row.assignedAt)}</dd>
                <dt>Last used / SSO 30d</dt><dd>{fmtDateTime(data.usage.lastUsedAt)} · {data.usage.sso30d} sign-ins</dd>
                <dt>App owner / risk</dt><dd>{show(data.application.owner)} · {show(data.application.riskLevel)}</dd>
                {data.application.features?.length > 0 && <><dt>Provisioning features</dt><dd>{data.application.features.join(', ')}</dd></>}
              </dl>
            </Section>

            <Section title="App account in Okta">
              {!data.account ? <div className="small muted">Not available — see the Okta API source below.</div> : <dl className="kv">
                <dt>Username</dt><dd>{show(data.account.userName)}</dd>
                <dt>Scope</dt><dd>{data.account.scope === 'GROUP' ? `Group${data.account.viaGroup ? ` (${data.account.viaGroup})` : ''}` : show(data.account.scope)}</dd>
                <dt>Status / sync</dt><dd>{show(data.account.status)} · {show(data.account.syncState)}</dd>
                <dt>External ID</dt><dd className="mono">{show(data.account.externalId)}</dd>
                <dt>Created / updated</dt><dd>{fmtDateTime(data.account.created)} · {fmtDateTime(data.account.lastUpdated)}</dd>
                <dt>Last provisioning sync</dt><dd>{fmtDateTime(data.account.lastSync)}</dd>
                {Object.entries(data.account.profile).filter(([, value]) => value !== null && value !== '').map(([key, value]) => <Fragment key={key}><dt className="mono">profile.{key}</dt><dd>{show(value)}</dd></Fragment>)}
              </dl>}
            </Section>

            <Section title="Groups granting this app" count={data.groups.length}>
              {data.groups.length === 0 ? <div className="small muted">No group grants this app to the user — access is direct only.</div>
                : <MiniTable head={['Group', 'Priority', 'Group app attributes']} rows={data.groups.map((group: any) => [<span className="cell-title">{group.name}</span>, show(group.priority), <span className="small">{Object.keys(group.profile).length ? Object.entries(group.profile).map(([key, value]) => `${key}: ${show(value)}`).join(' · ') : '—'}</span>])} />}
            </Section>

            <Section title="Entitlements (Okta Identity Governance)" count={data.entitlements.length}>
              {data.entitlements.length === 0 ? <div className="small muted">No governance entitlements returned for this user in the app.</div>
                : <MiniTable head={['Entitlement', 'Values', 'Grant type']} rows={data.entitlements.map((item: any) => [<span className="cell-title">{item.name}</span>, item.values.join(', ') || '—', show(item.grantType)])} />}
            </Section>

            <Section title="Separation of Duties" count={data.sod.length}>
              {data.sod.length === 0 ? <div className="small muted">No SoD violation involves this app for this user.</div>
                : <MiniTable head={['Policy', 'Severity', 'Status', 'Conflict', 'Detected']} rows={data.sod.map((item: any) => [
                  <span className="cell-title">{item.policy}</span>, <Badge tone={SEVERITY_TONE[item.severity] || 'neutral'}>{item.severity}</Badge>, item.status,
                  <span className="small">{item.sideA.label || 'A'}: {item.sideA.entitlements.join(', ')} ⟷ {item.sideB.label || 'B'}: {item.sideB.entitlements.join(', ')}</span>,
                  <span className="nowrap">{fmtDateTime(item.detectedAt)}</span>])} />}
            </Section>

            <Section title="Access requests" count={data.requests.length}>
              {data.requests.length === 0 ? <div className="small muted">No Okta access request found for this app.</div>
                : <MiniTable head={['#', 'Request', 'Requester', 'Approvers', 'Created', 'Status']} rows={data.requests.map((request: any) => [
                  request.number, request.subject, request.requester.name,
                  request.approvers.length ? request.approvers.map((person: any) => <div key={person.role}>{person.name}<div className="cell-sub">{person.role} · {fmtDateTime(person.at)}</div></div>) : '—',
                  <span className="nowrap">{fmtDateTime(request.createdAt)}</span>, <Badge tone={REQUEST_TONE[request.status] || 'neutral'}>{request.status}</Badge>])} />}
            </Section>

            <Section title="Certifications" count={data.certifications.length}>
              {data.certifications.length === 0 ? <div className="small muted">This access has not been reviewed in a certification campaign.</div>
                : <MiniTable head={['Campaign', 'Decision', 'Reviewer', 'Decided', 'Comment']} rows={data.certifications.map((item: any) => [
                  <span className="cell-title">{item.campaign}</span>, <Badge tone={DECISION_TONE[item.decision] || 'neutral'}>{item.decision}</Badge>, item.decidedBy || item.reviewer,
                  <span className="nowrap">{fmtDateTime(item.decidedAt)}</span>, <span className="small">{item.comment || '—'}</span>])} />}
            </Section>

            {data.roles.length > 0 && <Section title="Roles that include this app" count={data.roles.length}>
              <div className="chip-list">{data.roles.map((role: any) => <span key={role._id} className="chip">{role.name} · {role.status}</span>)}</div>
            </Section>}

            <Section title="Recent System Log events" count={data.events.length}>
              {data.events.length === 0 ? <div className="small muted">No stored events for this user and app.</div>
                : <MiniTable head={['Time', 'Event', 'Actor', 'Outcome']} rows={data.events.map((event: any) => [
                  <span className="nowrap">{fmtDateTime(event.published)}</span>, <><div>{event.message}</div><div className="cell-sub mono">{event.eventType}</div></>, event.actor || '—', show(event.outcome)])} />}
            </Section>

            <Section title="Data sources & JSON" count={data.sources.length}>
              {!showJson ? <div><Button size="sm" variant="ghost" onClick={() => setShowJson(true)}>View more — endpoints & JSON</Button></div>
                : full.loading && !full.data ? <Loading /> : full.error ? <ErrorBox error={full.error} /> : full.data && <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {full.data.sources.map((source: any, index: number) => (
                  <details key={index} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
                    <summary style={{ cursor: 'pointer' }}>
                      <Badge tone={source.kind === 'okta' ? 'info' : 'neutral'}>{source.kind === 'okta' ? 'Okta API' : 'MongoDB'}</Badge>{' '}
                      <span className="mono">{source.endpoint}</span>{' '}
                      <Badge tone={source.ok ? 'success' : 'danger'}>{source.ok ? 'ok' : 'error'}</Badge>
                      <div className="cell-sub">{source.description}</div>
                    </summary>
                    <pre className="mono small" style={{ ...preStyle, marginTop: 8 }}>{source.ok ? JSON.stringify(source.data, null, 2) : source.error}</pre>
                  </details>
                ))}
              </div>
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: 'pointer' }} className="small">Full response JSON</summary>
                <pre className="mono small" style={{ ...preStyle, marginTop: 8 }}>{JSON.stringify({ ...full.data, sources: undefined }, null, 2)}</pre>
              </details>
              </>}
            </Section>
          </div>
        )}
    </Modal>
  );
}
