import { route, HttpError } from '@/lib/api';
import { ReportDef } from '@/lib/models';
import { runReport } from '@/lib/reports';

export const dynamic = 'force-dynamic';

/** Preview report: body { reportId } atau { def } (definisi ad-hoc dari builder). */
export const POST = route(async ({ body }) => {
  const def = body?.reportId ? await ReportDef.findById(body.reportId).lean() : body?.def;
  if (!def) throw new HttpError(400, 'Report tidak ditemukan');
  const r = await runReport(def);
  return { ...r, rows: r.rows.slice(0, Number(body?.previewLimit) || 500) };
});
