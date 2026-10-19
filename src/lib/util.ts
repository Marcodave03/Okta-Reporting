export const DAY = 86400000;

export const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

export function addMonths(d: Date, n: number) {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

export const fmtDate = (d?: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');

export const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'] as const;

export function render(template: string, vars: Record<string, any>) {
  return (template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] ?? '').toString());
}

export const escapeHtml = (s: any) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function countBy<T>(arr: T[], fn: (x: T) => string) {
  const m: Record<string, number> = {};
  for (const x of arr) {
    const k = fn(x);
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}
