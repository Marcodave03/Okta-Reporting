'use client';

import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Download, RefreshCw, Search, X } from 'lucide-react';
import { download, fmtDate, fmtDateTime, qs, useApi } from '@/lib/client';
import { Badge, Button, Card, Empty, ErrorBox, Loading, Modal, PageHeader, toast, toastError } from '@/components/ui';
import { AppAccessDetail } from '@/components/AppAccessDetail';

const who = (actor: any) => actor?.displayName || actor?.alternateId || actor?.id || '—';

const VISIBLE_ROWS = 8;

// Caps the table height to the header plus the first VISIBLE_ROWS rows; the rest scroll inside the wrapper.
function RowLimitedTable({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<number>();
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      const head = el?.querySelector('thead');
      const rows = el?.querySelectorAll('tbody > tr');
      if (!el || !head || !rows || rows.length <= VISIBLE_ROWS) return setMaxHeight(undefined);
      const last = rows[VISIBLE_ROWS - 1] as HTMLElement;
      setMaxHeight(last.getBoundingClientRect().bottom - head.getBoundingClientRect().top);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [children]);
  return <div ref={ref} className="table-wrap" style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>{children}</div>;
}

export default function AppAccessActivityPage() {
  const [userQuery, setUserQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [selectedApplication, setSelectedApplication] = useState<any>(null);
  const users = useApi<any>(`/api/reports/app-access?${qs({ q: userQuery })}`);
  const detail = useApi<any>(selectedId ? `/api/reports/app-access?identityId=${encodeURIComponent(selectedId)}` : null);
  const identity = detail.data?.identity;
  const currentApplications = detail.data?.currentApplications || [];
  const history = detail.data?.history || [];
  const groups = detail.data?.groups || [];
  const selectedName = identity?.displayName || identity?.email || 'Select a user';
  const currentAccess = currentApplications.length;
  const applications = useMemo(() => currentApplications.map((row: any) => row.application).filter(Boolean).sort(), [currentApplications]);

  const [exporting, setExporting] = useState(false);
  const exportUser = () => {
    if (!selectedId) return;
    setExporting(true);
    download('/api/reports/app-access/export', { identityId: selectedId })
      .then(() => toast('Export PDF siap', 'success')).catch(toastError).finally(() => setExporting(false));
  };

  return (
    <>
      <PageHeader title="App Access Activity" subtitle="Select a user to review their attributes, application access history, and group memberships from Okta." actions={selectedId && <><Button size="sm" icon={<Download size={13} />} onClick={exportUser} disabled={exporting}>{exporting ? 'Exporting…' : 'Export PDF'}</Button><Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={detail.reload}>Refresh</Button></>} />
      <Card className="mb">
        <div className="filters" style={{ marginBottom: 0 }}>
          <Search size={16} className="muted" />
          <input className="input grow" placeholder="Search and select a user by name, email or login…" value={userQuery} onChange={(event) => { setUserQuery(event.target.value); setSelectedId(''); }} />
          {userQuery && <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => setUserQuery('')}>Clear</Button>}
        </div>
        {!selectedId && <div className="table-wrap" style={{ marginTop: 12 }}>
          {users.loading ? <Loading /> : users.error ? <ErrorBox error={users.error} /> : (users.data?.users || []).length === 0 ? <Empty title="No users found" desc="Try a different name, email or login." /> : (
            <table className="table"><thead><tr><th>User</th><th>Email</th><th>Status</th><th /></tr></thead><tbody>
              {(users.data?.users || []).map((user: any) => <tr key={user._id} className="clickable" onClick={() => setSelectedId(String(user._id))}><td className="cell-title">{user.displayName || user.login}</td><td>{user.email || user.login}</td><td><Badge tone={user.status === 'ACTIVE' ? 'success' : 'neutral'}>{user.status}</Badge></td><td>View</td></tr>)}
            </tbody></table>
          )}
        </div>}
      </Card>
      {selectedId && (detail.loading && !detail.data ? <Loading /> : detail.error ? <ErrorBox error={detail.error} /> : identity && <>
        <div className="row mb" style={{ justifyContent: 'space-between' }}><Button size="sm" variant="ghost" onClick={() => setSelectedId('')}>← Choose another user</Button><span className="small muted">Data source: Okta sync and Okta System Log</span></div>
        <Card className="mb" title={selectedName} sub={`${identity.email || identity.login} · ${identity.title || 'No title'} · ${identity.department || 'No department'}`}>
          <div className="grid grid-3">
            <div><div className="small muted">Status / lifecycle</div><strong>{identity.status} · {identity.lifecycle}</strong></div>
            <div><div className="small muted">Location / employee type</div><strong>{identity.location || '—'} · {identity.employeeType || '—'}</strong></div>
            <div><div className="small muted">Last login / risk</div><strong>{fmtDate(identity.lastLogin)} · {identity.riskLevel || '—'} ({identity.riskScore ?? 0})</strong></div>
          </div>
        </Card>
        <Card flush className="mb" title={`Current Applications (${currentAccess})`} sub="Unique Okta applications currently assigned directly or through a group">
          {currentApplications.length === 0 ? <Empty title="No current application access" desc="This user has no active direct or group-based application assignment in the latest Okta sync." /> : <RowLimitedTable><table className="table"><thead><tr><th>Okta application</th><th>Role / entitlement</th><th>Access</th><th>Assignment source</th><th>Assigned by</th><th>Assigned</th><th>Reason</th></tr></thead><tbody>
            {currentApplications.map((row: any) => <tr key={row.applicationId || row.application} className="clickable" onClick={() => setSelectedApplication(row)}><td className="cell-title">{row.application}</td><td>{row.roles?.join(', ') || row.role}</td><td><Badge tone="success">granted</Badge></td><td>{row.sources?.join(', ') || row.accessSource}{row.groups?.length ? <div className="cell-sub">via {row.groups.join(', ')}</div> : null}</td><td>{row.assignedBy?.length ? row.assignedBy.map((person: any) => <div key={`${person.role}:${person.name}`} title={person.login}>{person.name}<div className="cell-sub">{person.role}{person.at ? ` · ${fmtDateTime(person.at)}` : ''}</div></div>) : <span className="muted">Not in System Log</span>}</td><td className="nowrap">{fmtDateTime(row.assignedAt)}</td><td className="small">{row.reason}</td></tr>)}
          </tbody></table></RowLimitedTable>}
        </Card>
        <Card flush className="mb" title={`Access History (${history.length})`} sub="Historical grant and revoke events from the Okta System Log">
          {history.length === 0 ? <Empty title="No access history found" desc="No stored app-assignment events were found for this user." /> : <RowLimitedTable><table className="table"><thead><tr><th>Okta application</th><th>Action</th><th>Timestamp</th><th>Assignee</th><th>Reason / outcome</th><th>Event type</th></tr></thead><tbody>
            {history.map((row: any) => <tr key={row.id} className="clickable" onClick={() => setSelectedEvent(row)}><td className="cell-title">{row.application}</td><td><Badge tone={row.access === 'granted' ? 'success' : 'danger'}>{row.access}</Badge></td><td className="nowrap">{fmtDateTime(row.assignedAt)}</td><td>{row.actor || '—'}</td><td className="small">{row.reason}{row.outcome ? ` · ${row.outcome}` : ''}</td><td className="mono small">{row.eventType}</td></tr>)}
          </tbody></table></RowLimitedTable>}
        </Card>
        <Card flush title={`Groups (${groups.length})`} sub="Groups currently associated with this user from Okta sync">
          {groups.length === 0 ? <Empty title="No group memberships found" desc="This user is not currently assigned to a synced Okta group." /> : <RowLimitedTable><table className="table"><thead><tr><th>Group</th><th>Membership type</th><th>Application context</th><th>Joined</th></tr></thead><tbody>{groups.map((group: any) => <tr key={group.id}><td className="cell-title">{group.group}</td><td>{group.role}</td><td>{group.application || 'General group'}</td><td className="nowrap">{fmtDateTime(group.joinedAt)}</td></tr>)}</tbody></table></RowLimitedTable>}
        </Card>
      </>)}
      {selectedApplication && <AppAccessDetail identityId={selectedId} row={selectedApplication} onClose={() => setSelectedApplication(null)} />}
      <Modal open={!!selectedEvent} title={selectedEvent?.application || 'Application access event'} onClose={() => setSelectedEvent(null)} width={700}>{selectedEvent && <dl className="kv"><dt>Okta application</dt><dd>{selectedEvent.application}</dd><dt>Access status</dt><dd>{selectedEvent.access}</dd><dt>Assignment source</dt><dd>{selectedEvent.accessSource}</dd><dt>Timestamp</dt><dd>{fmtDateTime(selectedEvent.assignedAt)}</dd><dt>Actor / assignee</dt><dd>{selectedEvent.actor || '—'}</dd><dt>Reason / outcome</dt><dd>{selectedEvent.reason}{selectedEvent.outcome ? ` · ${selectedEvent.outcome}` : ''}</dd><dt>Event type</dt><dd className="mono">{selectedEvent.eventType || 'Current assignment'}</dd></dl>}</Modal>
    </>
  );
}
