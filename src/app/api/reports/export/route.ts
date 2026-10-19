import { route, HttpError, fileResponse } from '@/lib/api';
import { ReportDef, ReportRun } from '@/lib/models';
import { runReport } from '@/lib/reports';
import { exportData, EXPORT_FORMATS } from '@/lib/exporters';
import { audit } from '@/lib/audit';
import { fmtDate } from '@/lib/util';

export const dynamic = 'force-dynamic';

/** Export report ke csv | xlsx | pdf | json | html. body { reportId | def, format } */
export const POST = route(async ({ body, user }) => {
  const format = body?.format;
  if (!EXPORT_FORMATS.includes(format)) throw new HttpError(400, 'Format tidak didukung');
  const def: any = body?.reportId ? await ReportDef.findById(body.reportId).lean() : body?.def;
  if (!def) throw new HttpError(400, 'Report tidak ditemukan');
  const title = def.name || 'Report';
  const result = await runReport(def);
  const file = await exportData(format, title, result.columns, result.rows);
  await ReportRun.create({ reportId: def._id, reportName: title, ranAt: new Date(), rows: result.total, formats: [format], status: 'success', trigger: `manual:${user.email}` });
  await audit(user.email, 'report.export', title, { format, rows: result.total });
  const name = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${fmtDate(new Date())}.${file.ext}`;
  return fileResponse(file.buffer, file.mime, name);
});
