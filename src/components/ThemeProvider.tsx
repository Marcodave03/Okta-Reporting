'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { DEFAULT_PREFS, Prefs, PREFS_KEY } from '@/lib/themes';

type Ctx = { prefs: Prefs; setPrefs: (p: Partial<Prefs>, persist?: boolean) => void; colors: ChartColors };
const ThemeCtx = createContext<Ctx>({ prefs: DEFAULT_PREFS, setPrefs: () => {}, colors: null as any });

function apply(p: Prefs) {
  const d = document.documentElement;
  d.dataset.theme = p.theme;
  d.dataset.font = p.font;
  d.dataset.design = p.design;
}

export type ChartColors = { cat: string[]; sev: Record<string, string>; grid: string; axis: string; surface: string; text: string; muted: string };
const EMPTY: ChartColors = { cat: [], sev: {}, grid: '#e1e1e5', axis: '#6e6e78', surface: '#fff', text: '#1d1d21', muted: '#6e6e78' };

function readColors(): ChartColors {
  if (typeof window === 'undefined') return EMPTY;
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    cat: Array.from({ length: 6 }, (_, i) => v(`--chart-${i + 1}`) || '#1662dd'),
    sev: { low: v('--sev-low'), medium: v('--sev-medium'), high: v('--sev-high'), critical: v('--sev-critical') },
    grid: v('--border'),
    axis: v('--text-muted'),
    surface: v('--surface'),
    text: v('--text'),
    muted: v('--text-muted'),
  };
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setState] = useState<Prefs>(DEFAULT_PREFS);
  const [colors, setColors] = useState<ChartColors>(EMPTY);

  useEffect(() => {
    let stored: Partial<Prefs> = {};
    try {
      stored = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    } catch {}
    const p = { ...DEFAULT_PREFS, ...stored };
    setState(p);
    apply(p);
    setColors(readColors());
  }, []);

  const setPrefs = useCallback((patch: Partial<Prefs>, persist = true) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      apply(next);
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {}
      if (persist) fetch('/api/me/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) }).catch(() => {});
      return next;
    });
    requestAnimationFrame(() => setColors(readColors()));
  }, []);

  return <ThemeCtx.Provider value={{ prefs, setPrefs, colors }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
