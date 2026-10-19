'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useApi } from '@/lib/client';
import { Badge, Button, Card, ErrorBox, Loading, PageHeader, RiskBadge, TypeBadge } from '@/components/ui';

type Node = any & { children: Node[] };

function TreeNode({ n, depth, expanded, toggle, highlight }: { n: Node; depth: number; expanded: Set<string>; toggle: (id: string) => void; highlight: string }) {
  const open = expanded.has(String(n._id));
  const match = highlight && (n.displayName || '').toLowerCase().includes(highlight.toLowerCase());
  return (
    <li>
      <div className="tree-node" style={match ? { background: 'var(--primary-soft)' } : undefined}>
        <button className="tree-toggle" onClick={() => toggle(String(n._id))} disabled={!n.children.length} aria-label="toggle">
          {n.children.length ? open ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : <span className="dot" style={{ background: 'var(--border-strong)' }} />}
        </button>
        <Link href={`/identities/${n._id}`} className="cell-title">{n.displayName}</Link>
        <span className="small muted truncate" style={{ maxWidth: 260 }}>{n.title}</span>
        {n.identityType !== 'human' && <TypeBadge type={n.identityType} />}
        {n.lifecycle === 'leaver' && <Badge tone="danger">leaver</Badge>}
        <span className="spacer" />
        {n.pendingReviews > 0 && <Badge tone="warning" title="Pending review sebagai reviewer">{n.pendingReviews} review</Badge>}
        {n.children.length > 0 && <span className="small muted">{n.children.length} reports</span>}
        <RiskBadge level={n.riskLevel} />
      </div>
      {open && n.children.length > 0 && (
        <ul className="tree">
          {n.children.map((c: Node) => <TreeNode key={c._id} n={c} depth={depth + 1} expanded={expanded} toggle={toggle} highlight={highlight} />)}
        </ul>
      )}
    </li>
  );
}

export default function HierarchyPage() {
  const { data, loading, error } = useApi<any>('/api/hierarchy');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');

  const { roots, byId, departments } = useMemo(() => {
    const nodes: Node[] = (data?.nodes || []).map((n: any) => ({ ...n, children: [] }));
    const byId = new Map(nodes.map((n) => [String(n._id), n]));
    const roots: Node[] = [];
    for (const n of nodes) {
      const p = n.managerId && byId.get(String(n.managerId));
      if (p) p.children.push(n);
      else roots.push(n);
    }
    const sort = (arr: Node[]) => { arr.sort((a, b) => b.children.length - a.children.length || a.displayName.localeCompare(b.displayName)); arr.forEach((x) => sort(x.children)); };
    sort(roots);
    return { roots, byId, departments: [...new Set(nodes.map((n) => n.department).filter(Boolean))].sort() as string[] };
  }, [data]);

  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const expandAll = () => setExpanded(new Set([...byId.keys()]));
  const search = (v: string) => {
    setQ(v);
    if (!v) return;
    // buka semua ancestor dari node yang cocok
    const open = new Set(expanded);
    for (const n of byId.values()) {
      if (!(n.displayName || '').toLowerCase().includes(v.toLowerCase())) continue;
      let p = n.managerId && byId.get(String(n.managerId));
      while (p && !open.has(String(p._id))) { open.add(String(p._id)); p = p.managerId && byId.get(String(p.managerId)); }
    }
    setExpanded(open);
  };
  const shown = dept ? roots.flatMap(function find(n: Node): Node[] { return n.department === dept && (!n.managerId || byId.get(String(n.managerId))?.department !== dept) ? [n] : n.children.flatMap(find); }) : roots;

  return (
    <>
      <PageHeader title="Org Hierarchy" subtitle="Hierarchy viewer — struktur manager dari Okta yang menjadi dasar reviewer hierarchy & eskalasi certification." />
      <Card
        flush
        actions={<><Button size="sm" onClick={expandAll}>Expand all</Button><Button size="sm" onClick={() => setExpanded(new Set())}>Collapse</Button></>}
        title={<div className="filters" style={{ margin: 0 }}><input className="input" placeholder="Cari nama…" value={q} onChange={(e) => search(e.target.value)} /><select className="select" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">Semua department</option>{departments.map((d) => <option key={d}>{d}</option>)}</select></div>}
      >
        {error && <ErrorBox error={error} />}
        {loading ? <Loading /> : (
          <div style={{ padding: 12, overflowX: 'auto' }}>
            <ul className="tree tree-root">
              {shown.map((r) => <TreeNode key={r._id} n={r} depth={0} expanded={expanded} toggle={toggle} highlight={q} />)}
            </ul>
          </div>
        )}
      </Card>
    </>
  );
}
