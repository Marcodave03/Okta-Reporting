'use client';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';

/* ---------------- Toast ---------------- */
type ToastMsg = { id: number; text: string; tone: 'info' | 'success' | 'error' };
let toastId = 0;
export function toast(text: string, tone: ToastMsg['tone'] = 'info') {
  window.dispatchEvent(new CustomEvent('iga-toast', { detail: { id: ++toastId, text, tone } }));
}
export const toastError = (e: any) => toast(e?.message || String(e), 'error');
export function Toaster() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  useEffect(() => {
    const h = (e: any) => {
      const t = e.detail as ToastMsg;
      setItems((x) => [...x, t]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), t.tone === 'error' ? 6000 : 3500);
    };
    window.addEventListener('iga-toast', h);
    return () => window.removeEventListener('iga-toast', h);
  }, []);
  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Layout primitives ---------------- */
export function PageHeader({ title, subtitle, actions, crumbs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumbs?: { label: string; href?: string }[] }) {
  return (
    <div className="page-header">
      <div>
        {crumbs && (
          <div className="crumbs">
            {crumbs.map((c, i) => (
              <span key={i}>
                {c.href ? <Link href={c.href}>{c.label}</Link> : c.label}
                {i < crumbs.length - 1 && ' / '}
              </span>
            ))}
          </div>
        )}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, sub, actions, children, flush, className = '', style }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode; flush?: boolean; className?: string; style?: any }) {
  return (
    <div className={`card ${className}`} style={style}>
      {(title || actions) && (
        <div className="card-header">
          <div>
            {title && <h3>{title}</h3>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      <div className={`card-body ${flush ? 'flush' : ''}`}>{children}</div>
    </div>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'; size?: 'sm' | 'md'; icon?: ReactNode; loading?: boolean };
export function Button({ variant = 'secondary', size = 'md', icon, loading, children, className = '', disabled, ...rest }: BtnProps) {
  return (
    <button className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${!children ? 'btn-icon' : ''} ${className}`} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : icon}
      {children}
    </button>
  );
}

export function Badge({ tone = 'neutral', children, title }: { tone?: string; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${tone}`} title={title}>
      {children}
    </span>
  );
}

const RISK_TONE: Record<string, string> = { low: 'success', medium: 'warning', high: 'danger', critical: 'solid-danger' };
export const RiskBadge = ({ level }: { level?: string }) => <Badge tone={RISK_TONE[level || 'low'] || 'neutral'}>{level || 'low'}</Badge>;

const STATUS_TONE: Record<string, string> = {
  active: 'info', completed: 'success', scheduled: 'purple', draft: 'neutral', cancelled: 'neutral',
  pending: 'warning', approved: 'success', revoked: 'danger',
  open: 'danger', mitigated: 'info', accepted: 'purple', remediated: 'success',
  ACTIVE: 'success', SUSPENDED: 'warning', DEPROVISIONED: 'danger', STAGED: 'neutral', PROVISIONED: 'info', LOCKED_OUT: 'danger', PASSWORD_EXPIRED: 'warning', RECOVERY: 'warning',
  candidate: 'purple', deprecated: 'neutral',
  success: 'success', failed: 'danger', sent: 'success', skipped: 'neutral',
  joiner: 'info', mover: 'purple', leaver: 'danger', inactive: 'warning',
  done: 'success', none: 'neutral',
};
export const StatusBadge = ({ status }: { status?: string }) => <Badge tone={STATUS_TONE[status || ''] || 'neutral'}>{(status || '—').replace(/_/g, ' ').toLowerCase()}</Badge>;

const TYPE_TONE: Record<string, string> = { human: 'info', service: 'purple', bot: 'warning', api: 'primary' };
export const TypeBadge = ({ type }: { type?: string }) => <Badge tone={TYPE_TONE[type || 'human']}>{type === 'api' ? 'API' : type || 'human'}</Badge>;

export function Progress({ value, tone }: { value: number; tone?: string }) {
  const t = tone || (value >= 90 ? 'success' : value >= 50 ? '' : value >= 25 ? 'warning' : 'danger');
  return (
    <div className={`progress ${t}`} title={`${Math.round(value)}%`}>
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Stat({ label, value, hint, color, icon }: { label: string; value: ReactNode; hint?: ReactNode; color?: string; icon?: ReactNode }) {
  return (
    <div className="card kpi">
      {color && <span className="kpi-accent" style={{ background: color }} />}
      <div className="kpi-label">
        {icon}
        {label}
      </div>
      <div className="kpi-value">{value}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  );
}

export function Loading({ text = 'Memuat…' }: { text?: string }) {
  return (
    <div className="loading">
      <span className="spinner" /> {text}
    </div>
  );
}

export function Empty({ title = 'Tidak ada data', desc, action }: { title?: string; desc?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h4>{title}</h4>
      {desc && <div>{desc}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: string }) {
  return <div className="callout danger">⚠ {error}</div>;
}

/* ---------------- Forms ---------------- */
export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} disabled={disabled} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} />;
}

export function CheckList({ options, value, onChange, placeholder = 'Cari…', height }: { options: { value: string; label: string; sub?: string }[]; value: string[]; onChange: (v: string[]) => void; placeholder?: string; height?: number }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => options.filter((o) => (o.label + ' ' + (o.sub || '')).toLowerCase().includes(q.toLowerCase())), [options, q]);
  const set = new Set(value);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <input className="input" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="checklist" style={height ? { maxHeight: height } : undefined}>
        {filtered.map((o) => (
          <label key={o.value}>
            <input
              type="checkbox"
              checked={set.has(o.value)}
              onChange={(e) => {
                const n = new Set(set);
                e.target.checked ? n.add(o.value) : n.delete(o.value);
                onChange([...n]);
              }}
            />
            <span className="truncate">{o.label}</span>
            {o.sub && <span className="muted small" style={{ marginLeft: 'auto' }}>{o.sub}</span>}
          </label>
        ))}
        {!filtered.length && <div className="muted small" style={{ padding: 10 }}>Tidak ada opsi</div>}
      </div>
      <div className="small muted">{value.length} dipilih</div>
    </div>
  );
}

export function TagInput({ value, onChange, placeholder = 'ketik lalu Enter' }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [v, setV] = useState('');
  const add = () => {
    const parts = v.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
    setV('');
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <input className="input" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ',') && (e.preventDefault(), add())} onBlur={add} />
      {!!value.length && (
        <div className="chip-list">
          {value.map((t) => (
            <span key={t} className="chip">
              {t}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== t))}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Modal ---------------- */
export function Modal({ open, title, onClose, children, footer, width = 560 }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h3>{title}</h3>
          <Button variant="ghost" size="sm" icon={<X size={16} />} onClick={onClose} aria-label="Tutup" />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/** Dialog konfirmasi (pengganti window.confirm) */
export function useConfirm() {
  const [state, setState] = useState<{ title: string; message: ReactNode; danger?: boolean; resolve: (v: boolean) => void } | null>(null);
  const confirm = (title: string, message: ReactNode, danger = false) => new Promise<boolean>((resolve) => setState({ title, message, danger, resolve }));
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  const dialog = (
    <Modal
      open={!!state}
      title={state?.title}
      onClose={() => close(false)}
      width={440}
      footer={
        <>
          <Button onClick={() => close(false)}>Batal</Button>
          <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
            Ya, lanjutkan
          </Button>
        </>
      }
    >
      <div>{state?.message}</div>
    </Modal>
  );
  return { confirm, dialog };
}

/* ---------------- Tabs ---------------- */
export function Tabs({ tabs, value, onChange }: { tabs: { key: string; label: ReactNode; count?: number }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div>
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" className={`tab ${value === t.key ? 'active' : ''}`} onClick={() => onChange(t.key)}>
            {t.label}
            {t.count !== undefined && <Badge>{t.count}</Badge>}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Table ---------------- */
export type Column<T> = { key: string; label: ReactNode; render?: (row: T) => ReactNode; width?: number | string; className?: string };
export function DataTable<T extends { _id?: any }>({
  columns, rows, onRowClick, selectable, selected, onSelect, empty, rowKey,
}: {
  columns: Column<T>[]; rows: T[]; onRowClick?: (r: T) => void; selectable?: boolean; selected?: string[]; onSelect?: (ids: string[]) => void; empty?: ReactNode; rowKey?: (r: T) => string;
}) {
  const key = rowKey || ((r: any) => String(r._id));
  const sel = new Set(selected || []);
  const allSel = rows.length > 0 && rows.every((r) => sel.has(key(r)));
  if (!rows.length) return <>{empty || <Empty />}</>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {selectable && (
              <th style={{ width: 36 }}>
                <input type="checkbox" checked={allSel} onChange={() => onSelect?.(allSel ? [] : rows.map(key))} aria-label="Pilih semua" />
              </th>
            )}
            {columns.map((c) => (
              <th key={c.key} style={{ width: c.width }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = key(r);
            return (
              <tr key={k} className={`${onRowClick ? 'clickable' : ''} ${sel.has(k) ? 'selected' : ''}`} onClick={() => onRowClick?.(r)}>
                {selectable && (
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={sel.has(k)}
                      onChange={(e) => {
                        const n = new Set(sel);
                        e.target.checked ? n.add(k) : n.delete(k);
                        onSelect?.([...n]);
                      }}
                    />
                  </td>
                )}
                {columns.map((c) => (
                  <td key={c.key} className={c.className}>
                    {c.render ? c.render(r) : ((r as any)[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, total, limit, onChange }: { page: number; total: number; limit: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="pagination">
      <span>
        {total ? (page - 1) * limit + 1 : 0}–{Math.min(page * limit, total)} dari {total}
      </span>
      <div className="row">
        <Button size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          ‹ Prev
        </Button>
        <span>
          {page} / {pages}
        </span>
        <Button size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          Next ›
        </Button>
      </div>
    </div>
  );
}
