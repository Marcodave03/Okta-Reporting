'use client';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTheme } from './ThemeProvider';

export type Series = { key: string; label: string; color?: string };

/** Warna: kategorikal berurutan tetap; severity/risk memakai token status (bukan kategorikal). */
export function useColors() {
  const { colors } = useTheme();
  const cat = colors?.cat?.length ? colors.cat : ['#1662dd', '#c27c00', '#00a3a6', '#d1242f', '#6d4ed1', '#16884a'];
  const status: Record<string, string> = {
    low: colors?.sev?.low || '#2b8a3e',
    medium: colors?.sev?.medium || '#c27c00',
    high: colors?.sev?.high || '#e8590c',
    critical: colors?.sev?.critical || '#c92a2a',
    approved: colors?.sev?.low || '#2b8a3e',
    revoked: colors?.sev?.critical || '#c92a2a',
    pending: colors?.sev?.medium || '#c27c00',
    open: colors?.sev?.critical || '#c92a2a',
    mitigated: cat[0],
    accepted: cat[4] || cat[1],
    remediated: colors?.sev?.low || '#2b8a3e',
  };
  return { cat, status, grid: colors?.grid || '#e1e1e5', axis: colors?.axis || '#6e6e78', surface: colors?.surface || '#fff', text: colors?.text || '#1d1d21' };
}

function TooltipBox({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', boxShadow: 'var(--shadow-lg)', fontSize: 12, minWidth: 120 }}>
      {label !== undefined && <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>{label}</div>}
      {payload.map((p: any) => (
        <div key={p.dataKey || p.name} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text)' }}>
          <span className="dot" style={{ background: p.color || p.payload?.fill }} />
          <span style={{ color: 'var(--text-muted)' }}>{p.name}</span>
          <span style={{ marginLeft: 'auto', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; value?: any }[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
      {items.map((i) => (
        <span key={i.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="dot" style={{ background: i.color, borderRadius: 2 }} />
          {i.label}
          {i.value !== undefined && <b style={{ color: 'var(--text)' }}>{i.value}</b>}
        </span>
      ))}
    </div>
  );
}

const axisProps = (c: string) => ({ tick: { fontSize: 11, fill: c }, tickLine: false, axisLine: false });

export function Donut({ data, colorFor, height = 200, center }: { data: { name: string; value: number }[]; colorFor?: (name: string, i: number) => string; height?: number; center?: { value: any; label: string } }) {
  const c = useColors();
  const color = (n: string, i: number) => colorFor?.(n, i) || c.cat[i % c.cat.length];
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div style={{ position: 'relative', height }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={data.filter((d) => d.value).length > 1 ? 2 : 0} stroke={c.surface} strokeWidth={2} isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={d.name} fill={color(d.name, i)} />
              ))}
            </Pie>
            <Tooltip content={<TooltipBox />} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{center?.value ?? total}</div>
            <div className="small muted">{center?.label ?? 'total'}</div>
          </div>
        </div>
      </div>
      <Legend items={data.map((d, i) => ({ label: d.name, color: color(d.name, i), value: d.value }))} />
    </div>
  );
}

export function Bars({ data, x = 'name', series, horizontal, stacked, height = 260, colorFor }: { data: any[]; x?: string; series: Series[]; horizontal?: boolean; stacked?: boolean; height?: number; colorFor?: (row: any, i: number) => string }) {
  const c = useColors();
  const s = series.map((se, i) => ({ ...se, color: se.color || c.cat[i % c.cat.length] }));
  const radius: any = horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div style={{ height: horizontal ? Math.max(height, data.length * 30 + 30) : height }}>
        <ResponsiveContainer>
          <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 6, right: 12, left: horizontal ? 8 : -12, bottom: 0 }} barCategoryGap="22%" barGap={2}>
            <CartesianGrid stroke={c.grid} strokeDasharray="0" vertical={!!horizontal} horizontal={!horizontal} />
            {horizontal ? (
              <>
                <XAxis type="number" {...axisProps(c.axis)} allowDecimals={false} />
                <YAxis type="category" dataKey={x} {...axisProps(c.axis)} width={150} />
              </>
            ) : (
              <>
                <XAxis dataKey={x} {...axisProps(c.axis)} interval="preserveStartEnd" />
                <YAxis {...axisProps(c.axis)} allowDecimals={false} />
              </>
            )}
            <Tooltip content={<TooltipBox />} cursor={{ fill: 'var(--surface-3)', opacity: 0.6 }} />
            {s.map((se, si) => (
              <Bar key={se.key} dataKey={se.key} name={se.label} fill={se.color} stackId={stacked ? 'a' : undefined} radius={stacked && si < s.length - 1 ? 0 : radius} maxBarSize={36} stroke={stacked ? c.surface : undefined} strokeWidth={stacked ? 1 : 0} isAnimationActive={false}>
                {colorFor && s.length === 1 && data.map((row, i) => <Cell key={i} fill={colorFor(row, i)} />)}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {s.length > 1 && <Legend items={s.map((se) => ({ label: se.label, color: se.color! }))} />}
    </div>
  );
}

export function Lines({ data, x = 'day', series, height = 260 }: { data: any[]; x?: string; series: Series[]; height?: number }) {
  const c = useColors();
  const s = series.map((se, i) => ({ ...se, color: se.color || c.cat[i % c.cat.length] }));
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div style={{ height }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 6, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis dataKey={x} {...axisProps(c.axis)} interval="preserveStartEnd" minTickGap={24} />
            <YAxis {...axisProps(c.axis)} allowDecimals={false} />
            <Tooltip content={<TooltipBox />} cursor={{ stroke: c.axis, strokeDasharray: '3 3' }} />
            {s.map((se) => (
              <Line key={se.key} type="monotone" dataKey={se.key} name={se.label} stroke={se.color} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {s.length > 1 && <Legend items={s.map((se) => ({ label: se.label, color: se.color! }))} />}
    </div>
  );
}

export function StackedArea({ data, x = 'day', series, height = 260 }: { data: any[]; x?: string; series: Series[]; height?: number }) {
  const c = useColors();
  const s = series.map((se, i) => ({ ...se, color: se.color || c.cat[i % c.cat.length] }));
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div style={{ height }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 6, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis dataKey={x} {...axisProps(c.axis)} interval="preserveStartEnd" minTickGap={24} />
            <YAxis {...axisProps(c.axis)} allowDecimals={false} />
            <Tooltip content={<TooltipBox />} cursor={{ stroke: c.axis, strokeDasharray: '3 3' }} />
            {s.map((se) => (
              <Area key={se.key} type="monotone" dataKey={se.key} name={se.label} stackId="1" stroke={c.surface} strokeWidth={1.5} fill={se.color} fillOpacity={0.9} isAnimationActive={false} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {s.length > 1 && <Legend items={s.map((se) => ({ label: se.label, color: se.color! }))} />}
    </div>
  );
}
