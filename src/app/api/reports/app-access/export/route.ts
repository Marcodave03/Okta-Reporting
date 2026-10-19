import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { route, ADMIN_AUDITOR, HttpError, fileResponse } from '@/lib/api';
import { userAppAccess } from '@/lib/appAccess';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

type RGB = [number, number, number];
const BRAND: RGB = [22, 98, 221];
const TEXT: RGB = [30, 32, 38];
const MUTED: RGB = [110, 112, 122];
const GREEN: RGB = [22, 128, 61];
const RED: RGB = [200, 38, 38];
const AMBER: RGB = [180, 110, 0];
const TZ = process.env.TZ || 'Asia/Jakarta';
const MAX_HISTORY = 50;

const dateTime = (value?: any) => (value ? new Date(value).toLocaleString('id-ID', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '-');
const dateOnly = (value?: any) => (value ? new Date(value).toLocaleDateString('id-ID', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const text = (value?: any) => (value === undefined || value === null || value === '' ? '-' : String(value));
const TONE: Record<string, RGB> = { granted: GREEN, revoked: RED, resolved: GREEN, open: AMBER, canceled: MUTED, expired: MUTED, SUCCESS: GREEN, FAILURE: RED };

/** PDF report of one user's application access, meant to be read by reviewers and auditors. */
export const POST = route(async ({ body, user }) => {
  const report = await userAppAccess(body?.identityId);
  if (!report) throw new HttpError(404, 'User not found');
  const { identity, currentApplications: apps, groups, requests } = report;
  // only events that changed this user's own access (not actions the user performed on others)
  const history = report.history.filter((event) => event.targetUserId === identity.oktaId);
  const name = identity.displayName || identity.login || 'User';

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 36;
  let y = 0;

  // ---------- header ----------
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, pageWidth, 74, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold').setFontSize(17);
  doc.text('Application Access Report', margin, 34);
  doc.setFont('helvetica', 'normal').setFontSize(10);
  doc.text(`${name}  ·  ${identity.email || identity.login || ''}`, margin, 54);
  doc.setFontSize(8);
  doc.text(`Generated ${dateTime(new Date())}`, pageWidth - margin, 34, { align: 'right' });
  doc.text(`by ${user.email}`, pageWidth - margin, 46, { align: 'right' });
  y = 96;

  // ---------- summary ----------
  const stats: [string, number][] = [
    ['Current applications', apps.length],
    ['Direct assignment', apps.filter((app: any) => app.sources.includes('Direct assignment')).length],
    ['Through a group', apps.filter((app: any) => app.sources.includes('Group assignment')).length],
    ['Group memberships', groups.length],
    ['Access requests', requests.length],
  ];
  const gap = 8;
  const boxWidth = (pageWidth - margin * 2 - gap * (stats.length - 1)) / stats.length;
  stats.forEach(([label, value], index) => {
    const x = margin + index * (boxWidth + gap);
    doc.setFillColor(243, 246, 252).setDrawColor(220, 226, 240);
    doc.roundedRect(x, y, boxWidth, 48, 4, 4, 'FD');
    doc.setTextColor(...BRAND).setFont('helvetica', 'bold').setFontSize(17);
    doc.text(String(value), x + 10, y + 24);
    doc.setTextColor(...MUTED).setFont('helvetica', 'normal').setFontSize(7.5);
    doc.text(label, x + 10, y + 38);
  });
  y += 70;

  const heading = (title: string, subtitle?: string) => {
    if (y > pageHeight - 120) { doc.addPage(); y = 48; }
    doc.setTextColor(...TEXT).setFont('helvetica', 'bold').setFontSize(11.5);
    doc.text(title, margin, y);
    doc.setDrawColor(...BRAND).setLineWidth(1.2);
    doc.line(margin, y + 5, margin + 28, y + 5);
    y += 12;
    if (subtitle) {
      doc.setTextColor(...MUTED).setFont('helvetica', 'normal').setFontSize(8);
      doc.text(subtitle, margin, y + 4);
      y += 12;
    }
    y += 4;
  };
  const table = (head: string[], rows: string[][], empty: string, options: { columnStyles?: any; toneColumn?: number } = {}) => {
    if (!rows.length) {
      doc.setTextColor(...MUTED).setFont('helvetica', 'italic').setFontSize(8.5);
      doc.text(empty, margin, y + 6);
      y += 28;
      return;
    }
    autoTable(doc, {
      startY: y,
      head: [head],
      body: rows,
      theme: 'striped',
      styles: { fontSize: 7.8, cellPadding: 4, overflow: 'linebreak', textColor: TEXT, valign: 'top' },
      headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 249, 253] },
      columnStyles: options.columnStyles,
      margin: { left: margin, right: margin, top: 48, bottom: 44 },
      didParseCell: (cell) => {
        if (cell.section === 'body' && cell.column.index === options.toneColumn && TONE[String(cell.cell.raw)]) {
          cell.cell.styles.textColor = TONE[String(cell.cell.raw)];
          cell.cell.styles.fontStyle = 'bold';
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 22;
  };

  // ---------- user profile ----------
  heading('User profile', 'Attributes from the latest Okta sync');
  autoTable(doc, {
    startY: y,
    theme: 'plain',
    body: [
      ['Full name', text(name), 'Email', text(identity.email)],
      ['Login', text(identity.login), 'Okta user ID', text(identity.oktaId)],
      ['Title', text(identity.title), 'Department', text(identity.department)],
      ['Manager', text(identity.manager), 'Location', text(identity.location)],
      ['Employee type', text(identity.employeeType), 'Identity type', text(identity.identityType)],
      ['Okta status', text(identity.status), 'Lifecycle', text(identity.lifecycle)],
      ['Okta account created', dateOnly(identity.sourceCreatedAt), 'Last login', dateTime(identity.lastLogin)],
      ['Risk level', `${text(identity.riskLevel)} (score ${identity.riskScore ?? 0})`, '', ''],
    ],
    styles: { fontSize: 8.5, cellPadding: { top: 3, bottom: 3, left: 0, right: 6 }, textColor: TEXT },
    columnStyles: { 0: { textColor: MUTED, cellWidth: 92 }, 1: { fontStyle: 'bold' }, 2: { textColor: MUTED, cellWidth: 92 }, 3: { fontStyle: 'bold' } },
    margin: { left: margin, right: margin },
  });
  y = (doc as any).lastAutoTable.finalY + 24;

  // ---------- application ownership ----------
  heading('Application ownership', 'Applications the user can access today, how the access was granted, and by whom');
  table(
    ['#', 'Application', 'Role / entitlement', 'Access source', 'Assigned', 'Assigned / approved by', 'Last used'],
    apps.map((app: any, index: number) => [
      String(index + 1),
      app.application,
      (app.roles || [app.role]).join('\n'),
      app.sources.map((source: string) => (source === 'Group assignment' ? `Group: ${app.groups.join(', ')}` : 'Direct')).join('\n'),
      dateTime(app.assignedAt),
      app.assignedBy?.length ? app.assignedBy.map((person: any) => `${person.name} (${person.role})`).join('\n') : 'Not in System Log',
      dateOnly(app.lastUsedAt),
    ]),
    'The user has no application access in the latest Okta sync.',
    { columnStyles: { 0: { cellWidth: 18 }, 1: { fontStyle: 'bold', cellWidth: 82 }, 4: { cellWidth: 70 }, 6: { cellWidth: 52 } } },
  );

  // ---------- access requests ----------
  heading('Access requests', 'Okta Identity Governance requests made for this user, with every approval step in order');
  table(
    ['#', 'Request', 'Requested by', 'Approvers', 'Requested', 'Status'],
    requests.slice().reverse().map((request: any) => [
      Number(request.number) ? String(request.number) : '-',
      text(request.subject),
      text(request.requester?.name),
      request.approvers.length ? request.approvers.map((person: any) => `${person.role}: ${person.name}, ${dateTime(person.at)}`).join('\n') : '-',
      dateTime(request.createdAt),
      request.status,
    ]),
    'No access request found in the Okta System Log for this user.',
    { columnStyles: { 0: { cellWidth: 24 }, 4: { cellWidth: 70 }, 5: { cellWidth: 48 } }, toneColumn: 5 },
  );

  // ---------- groups ----------
  heading('Group memberships', 'Okta groups the user currently belongs to');
  table(
    ['Group', 'Type', 'Grants application', 'Joined'],
    groups.map((group: any) => [group.group, group.role, text(group.application), dateTime(group.joinedAt)]),
    'The user is not a member of any synced Okta group.',
    { columnStyles: { 0: { fontStyle: 'bold' }, 3: { cellWidth: 80 } } },
  );

  // ---------- history ----------
  heading('Access history', `Changes to this user's application access from the Okta System Log${history.length > MAX_HISTORY ? ` (latest ${MAX_HISTORY} of ${history.length})` : ''}`);
  table(
    ['Date', 'Application', 'Action', 'Performed by', 'Outcome'],
    history.slice(0, MAX_HISTORY).map((event: any) => [dateTime(event.assignedAt), event.application, event.access, text(event.actor), text(event.outcome)]),
    'No application access change found in the stored System Log (about 90 days).',
    { columnStyles: { 0: { cellWidth: 92 }, 1: { fontStyle: 'bold' }, 2: { cellWidth: 56 }, 4: { cellWidth: 60 } }, toneColumn: 2 },
  );

  // ---------- footer ----------
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(225, 228, 236).setLineWidth(0.5);
    doc.line(margin, pageHeight - 30, pageWidth - margin, pageHeight - 30);
    doc.setTextColor(...MUTED).setFont('helvetica', 'normal').setFontSize(7.5);
    doc.text(`Confidential · Application Access Report · ${name}`, margin, pageHeight - 18);
    doc.text(`Page ${page} of ${pages}`, pageWidth - margin, pageHeight - 18, { align: 'right' });
  }

  await audit(user.email, 'report.export', `App Access - ${name}`, { format: 'pdf', identityId: String(identity._id) });
  const filename = `App Access Report - ${name.replace(/[^\w .-]/g, '')} - ${new Date().toISOString().slice(0, 10)}.pdf`;
  return fileResponse(Buffer.from(doc.output('arraybuffer')), 'application/pdf', filename);
}, ADMIN_AUDITOR);
