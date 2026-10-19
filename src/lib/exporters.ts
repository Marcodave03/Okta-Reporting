import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { escapeHtml } from './util';

export const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf', 'json', 'html'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
type Col = { key: string; label: string };

const MIME: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  json: 'application/json',
  html: 'text/html; charset=utf-8',
};

const csvCell = (v: any) => {
  const s = String(v ?? '');
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function exportData(format: ExportFormat, title: string, cols: Col[], rows: any[]): Promise<{ buffer: Buffer; mime: string; ext: string }> {
  let buffer: Buffer;
  switch (format) {
    case 'csv': {
      const lines = [cols.map((c) => csvCell(c.label)).join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c.key])).join(','))];
      buffer = Buffer.from('﻿' + lines.join('\r\n'), 'utf8');
      break;
    }
    case 'xlsx': {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'IGA Platform';
      const ws = wb.addWorksheet(title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
      ws.columns = cols.map((c) => ({ header: c.label, key: c.key, width: Math.min(Math.max(c.label.length + 4, 14), 45) }));
      ws.addRows(rows);
      const header = ws.getRow(1);
      header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1662DD' } };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
      buffer = Buffer.from(await wb.xlsx.writeBuffer());
      break;
    }
    case 'pdf': {
      const doc = new jsPDF({ orientation: cols.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
      doc.setFontSize(14);
      doc.setTextColor(22, 98, 221);
      doc.text(title, 40, 40);
      doc.setFontSize(9);
      doc.setTextColor(110, 110, 120);
      doc.text(`Generated ${new Date().toLocaleString('id-ID')} · ${rows.length} rows · IGA Platform`, 40, 56);
      autoTable(doc, {
        startY: 68,
        head: [cols.map((c) => c.label)],
        body: rows.map((r) => cols.map((c) => String(r[c.key] ?? ''))),
        styles: { fontSize: cols.length > 10 ? 6 : 7.5, cellPadding: 3, overflow: 'linebreak' },
        headStyles: { fillColor: [22, 98, 221], textColor: 255 },
        alternateRowStyles: { fillColor: [245, 247, 252] },
        margin: { left: 30, right: 30 },
      });
      buffer = Buffer.from(doc.output('arraybuffer'));
      break;
    }
    case 'json':
      buffer = Buffer.from(JSON.stringify({ title, generatedAt: new Date(), columns: cols, rows }, null, 2));
      break;
    case 'html': {
      const th = cols.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('');
      const tr = rows.map((r) => `<tr>${cols.map((c) => `<td>${escapeHtml(r[c.key])}</td>`).join('')}</tr>`).join('');
      buffer = Buffer.from(
        `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Segoe UI,Arial;padding:24px}table{border-collapse:collapse;width:100%;font-size:12px}th{background:#1662dd;color:#fff;text-align:left}th,td{padding:6px 8px;border-bottom:1px solid #e5e5e5}</style><h2>${escapeHtml(title)}</h2><p>${rows.length} rows · ${new Date().toISOString()}</p><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`,
      );
      break;
    }
    default:
      throw new Error(`Format tidak didukung: ${format}`);
  }
  return { buffer, mime: MIME[format], ext: format };
}
