/**
 * Document store di atas PostgreSQL (JSONB) dengan API bergaya Mongoose.
 * Setiap model = satu tabel `(_id text primary key, doc jsonb)`. Filter diterjemahkan ke jsonpath,
 * sehingga kode aplikasi (find/populate/aggregate/bulkWrite/save) tetap bisa dipakai apa adanya.
 */
import { randomBytes } from 'crypto';
import { sql } from './pg';

const OID = Symbol('ObjectId');
const MIXED = Symbol('Mixed');

/* ============================== Schema ============================== */
type Opts = Record<string, any>;
type Node =
  | { kind: 'scalar'; t: 'string' | 'number' | 'boolean' | 'date' | 'oid' | 'mixed'; o: Opts }
  | { kind: 'object'; fields: Fields; sub: boolean; o: Opts }
  | { kind: 'array'; of: Node; o: Opts };
type Fields = Record<string, Node>;

export class Schema {
  static Types = { ObjectId: OID as any, Mixed: MIXED as any };
  fields: Fields;
  indexes: { keys: Record<string, any>; unique: boolean }[] = [];
  constructor(def: Record<string, any>, public opts: Opts = {}) {
    this.fields = parseFields(def);
  }
  index(keys: Record<string, any>, opts: Opts = {}) {
    this.indexes.push({ keys, unique: !!opts.unique });
    return this;
  }
}

const isTypeLike = (x: any) => typeof x === 'function' || x === OID || x === MIXED || Array.isArray(x) || x instanceof Schema;

function scalarOf(t: any, o: Opts): Node {
  const k = t === String ? 'string' : t === Number ? 'number' : t === Boolean ? 'boolean' : t === Date ? 'date' : t === OID ? 'oid' : 'mixed';
  return { kind: 'scalar', t: k, o };
}

function parseNode(d: any, o: Opts = {}): Node {
  if (d instanceof Schema) return { kind: 'object', fields: d.fields, sub: true, o };
  if (Array.isArray(d)) return { kind: 'array', of: d.length ? parseNode(d[0]) : scalarOf(MIXED, {}), o };
  if (typeof d === 'function' || d === OID || d === MIXED) return scalarOf(d, o);
  if (d && typeof d === 'object') {
    if (isTypeLike(d.type)) {
      const { type, ...rest } = d;
      return parseNode(type, rest);
    }
    return { kind: 'object', fields: parseFields(d), sub: false, o };
  }
  return scalarOf(MIXED, o);
}

function parseFields(def: Record<string, any>): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(def)) if (k !== '_id') out[k] = parseNode(v);
  return out;
}

const META_FIELDS: Fields = {
  _id: { kind: 'scalar', t: 'oid', o: {} },
  createdAt: { kind: 'scalar', t: 'date', o: {} },
  updatedAt: { kind: 'scalar', t: 'date', o: {} },
};

function nodeAt(fields: Fields, path: string): Node | undefined {
  let node: Node | undefined = { kind: 'object', fields: { ...fields, ...META_FIELDS }, sub: false, o: {} };
  for (const seg of path.split('.')) {
    while (node && node.kind === 'array') node = node.of;
    if (!node) return undefined;
    if (node.kind === 'scalar') return node.t === 'mixed' ? node : undefined;
    if (/^\d+$/.test(seg)) continue;
    node = (node as Extract<Node, { kind: 'object' }>).fields[seg];
  }
  return node;
}

/* ============================== Casting ============================== */
export class CastError extends Error {
  name = 'CastError';
}

function castScalar(t: string, v: any, o: Opts): any {
  if (v === null || v === undefined) return v;
  switch (t) {
    case 'string': {
      if (typeof v === 'object' && !(v instanceof Date) && v._id !== undefined) v = v._id;
      let s = String(v);
      if (o.trim) s = s.trim();
      if (o.lowercase) s = s.toLowerCase();
      return s;
    }
    case 'number': {
      if (v === '') return null;
      const n = Number(v);
      if (Number.isNaN(n)) throw new CastError(`Cast to Number failed for value "${v}"`);
      return n;
    }
    case 'boolean':
      if (v === 'false' || v === '0' || v === 'no' || v === 0) return false;
      return Boolean(v);
    case 'date': {
      if (v === '') return null;
      const d = v instanceof Date ? v : new Date(typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v);
      if (Number.isNaN(d.getTime())) throw new CastError(`Cast to Date failed for value "${v}"`);
      return d;
    }
    case 'oid':
      if (typeof v === 'object' && v._id !== undefined) return String(v._id);
      return v === '' ? null : String(v);
    default:
      return v;
  }
}

function cast(node: Node, v: any): any {
  if (v === null || v === undefined) return v;
  if (node.kind === 'scalar') return castScalar(node.t, v, node.o);
  if (node.kind === 'array') return (Array.isArray(v) ? v : [v]).map((x) => cast(node.of, x));
  if (typeof v !== 'object' || v instanceof Date || Array.isArray(v)) return v;
  return castObject(node.fields, v);
}

function castObject(fields: Fields, v: any): any {
  const out: any = {};
  for (const k of Object.keys(fields)) if (v[k] !== undefined) out[k] = cast(fields[k], v[k]);
  return out;
}

function withDefaults(fields: Fields, v: any): any {
  for (const [k, n] of Object.entries(fields)) {
    if (v[k] === undefined) {
      if (n.o.default !== undefined) v[k] = cast(n, typeof n.o.default === 'function' ? n.o.default() : clone(n.o.default));
      else if (n.kind === 'array') v[k] = [];
      else if (n.kind === 'object' && !n.sub) {
        const sub = withDefaults(n.fields, {});
        if (Object.keys(sub).length) v[k] = sub;
      }
    } else if (n.kind === 'object' && v[k] && typeof v[k] === 'object' && !Array.isArray(v[k])) withDefaults(n.fields, v[k]);
    else if (n.kind === 'array' && n.of.kind === 'object' && Array.isArray(v[k])) {
      const f = n.of.fields;
      v[k].forEach((x: any) => x && typeof x === 'object' && withDefaults(f, x));
    }
  }
  return v;
}

function clone<T>(v: T): T {
  if (v instanceof Date) return new Date(v.getTime()) as any;
  if (Array.isArray(v)) return v.map(clone) as any;
  if (v && typeof v === 'object') {
    const out: any = {};
    for (const [k, x] of Object.entries(v)) if (typeof x !== 'function') out[k] = clone(x);
    return out;
  }
  return v;
}

const newId = () => Math.floor(Date.now() / 1000).toString(16).padStart(8, '0') + randomBytes(8).toString('hex');

/** Nilai filter → bentuk JSON (Date → ISO, dokumen → _id). */
function plain(v: any): any {
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof RegExp) && v._id !== undefined) return String(v._id);
  return v;
}

/* ============================== Path helpers ============================== */
function getPath(obj: any, path: string): any {
  let cur = obj;
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur) && !/^\d+$/.test(seg)) {
      const vals = cur.map((x) => (x && typeof x === 'object' ? x[seg] : undefined)).filter((x) => x !== undefined);
      cur = vals.flat();
      continue;
    }
    cur = cur[seg];
  }
  return cur;
}

function setPath(obj: any, path: string, val: any) {
  const segs = path.split('.');
  let cur = obj;
  for (const seg of segs.slice(0, -1)) {
    if (cur[seg] === null || typeof cur[seg] !== 'object') cur[seg] = {};
    cur = cur[seg];
  }
  cur[segs[segs.length - 1]] = val;
}

function unsetPath(obj: any, path: string) {
  const segs = path.split('.');
  let cur = obj;
  for (const seg of segs.slice(0, -1)) {
    cur = cur?.[seg];
    if (!cur || typeof cur !== 'object') return;
  }
  delete cur[segs[segs.length - 1]];
}

const SAFE_KEY = /^[A-Za-z0-9_]+$/;
function sqlPath(path: string): string {
  const segs = path.split('.');
  if (!segs.every((s) => SAFE_KEY.test(s))) throw new Error(`Path tidak valid: ${path}`);
  return segs.length === 1 ? `doc->'${segs[0]}'` : `doc#>'{${segs.join(',')}}'`;
}

const jp = (path: string, base = '$') => base + path.split('.').map((s) => (/^\d+$/.test(s) ? `[${s}]` : '.' + JSON.stringify(s))).join('');

/* ============================== Filter → SQL ============================== */
class Params {
  list: any[] = [];
  add(v: any) {
    this.list.push(v);
    return `$${this.list.length}`;
  }
}

function lit(v: any): string {
  v = plain(v);
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new CastError(`Nilai angka tidak valid: ${v}`);
    return String(v);
  }
  if (typeof v === 'boolean') return String(v);
  throw new CastError(`Nilai filter tidak didukung: ${JSON.stringify(v)}`);
}

const rxPred = (rx: RegExp) => {
  const flags = rx.flags.replace(/[^ims]/g, '');
  return `@ like_regex ${JSON.stringify(rx.source)}${flags ? ` flag ${JSON.stringify(flags)}` : ''}`;
};
const isOpObject = (v: any) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof RegExp) && v._id === undefined && Object.keys(v).length > 0 && Object.keys(v).every((k) => k.startsWith('$'));
const isScalar = (v: any) => ['string', 'number', 'boolean'].includes(typeof plain(v));
const CMP: Record<string, string> = { $gt: '>', $gte: '>=', $lt: '<', $lte: '<=' };

function where(filter: any, p: Params): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(filter || {})) {
    if (v === undefined || k === '$comment') continue;
    if (k === '$or' || k === '$nor') {
      const subs = (v as any[]).map((f) => `(${where(f, p)})`);
      const any = subs.length ? subs.join(' OR ') : 'FALSE';
      parts.push(k === '$or' ? `(${any})` : `NOT (${any})`);
    } else if (k === '$and') (v as any[]).forEach((f) => parts.push(`(${where(f, p)})`));
    else if (k.startsWith('$')) throw new Error(`Operator ${k} tidak didukung`);
    else parts.push(fieldCond(k, v, p));
  }
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

function test(p: Params, path: string, pred?: string) {
  return `doc @? ${p.add(pred ? `${jp(path)} ? (${pred})` : jp(path))}::jsonpath`;
}

function eqCond(path: string, v: any, p: Params): string {
  if (v instanceof RegExp) return test(p, path, rxPred(v));
  v = plain(v);
  if (v === null || v === undefined) return `NOT ${test(p, path, '@ != null')}`;
  if (typeof v === 'object') return `doc#>${p.add(path.split('.'))}::text[] = ${p.add(JSON.stringify(v))}::jsonb`;
  if (path === '_id') return `_id = ${p.add(String(v))}`;
  return test(p, path, `@ == ${lit(v)}`);
}

function inCond(path: string, vals: any[], p: Params): string {
  if (!Array.isArray(vals)) throw new CastError(`$in membutuhkan array`);
  const scalars = vals.filter(isScalar).map(plain);
  const parts: string[] = [];
  if (scalars.length) {
    if (path === '_id') parts.push(`_id = ANY(${p.add(scalars.map(String))}::text[])`);
    else parts.push(`jsonb_path_exists(doc, ${p.add(`${jp(path)} ? (@ == $v[*])`)}::jsonpath, ${p.add(JSON.stringify({ v: scalars }))}::jsonb)`);
  }
  for (const v of vals) if (!isScalar(v)) parts.push(eqCond(path, v, p));
  return parts.length ? `(${parts.join(' OR ')})` : 'FALSE';
}

function fieldCond(path: string, v: any, p: Params): string {
  if (!isOpObject(v)) return eqCond(path, v, p);
  const parts: string[] = [];
  for (const [op, val] of Object.entries(v)) {
    if (CMP[op]) parts.push(val === null ? 'FALSE' : test(p, path, `@ ${CMP[op]} ${lit(val)}`));
    else if (op === '$eq') parts.push(eqCond(path, val, p));
    else if (op === '$ne') parts.push(`NOT (${eqCond(path, val, p)})`);
    else if (op === '$in') parts.push(inCond(path, val as any[], p));
    else if (op === '$nin') parts.push(`NOT ${inCond(path, val as any[], p)}`);
    else if (op === '$exists') parts.push(val ? test(p, path) : `NOT ${test(p, path)}`);
    else if (op === '$all') parts.push((val as any[]).length ? (val as any[]).map((x) => eqCond(path, x, p)).join(' AND ') : 'FALSE');
    else if (op === '$elemMatch') parts.push(test(p, path, relPred(val)));
    else if (op === '$size') {
      const a = p.add(path.split('.'));
      parts.push(`(jsonb_typeof(doc#>${a}::text[]) = 'array' AND jsonb_array_length(doc#>${a}::text[]) = ${Number(val)})`);
    } else if (op === '$regex') parts.push(test(p, path, rxPred(val instanceof RegExp ? val : new RegExp(String(val), (v as any).$options || ''))));
    else if (op === '$options') continue;
    else if (op === '$not') parts.push(`NOT (${val instanceof RegExp ? test(p, path, rxPred(val)) : fieldCond(path, val, p)})`);
    else throw new Error(`Operator ${op} tidak didukung`);
  }
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

/** Predikat jsonpath relatif terhadap elemen array (untuk $elemMatch). */
function relPred(filter: any): string {
  if (isOpObject(filter) && !('$or' in filter) && !('$and' in filter)) return relField('', filter);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(filter || {})) {
    if (k === '$or' || k === '$and') {
      const subs = (v as any[]).map((f) => `(${relPred(f)})`);
      parts.push(`(${subs.join(k === '$or' ? ' || ' : ' && ')})`);
    } else parts.push(relField(k, v));
  }
  return parts.length ? parts.join(' && ') : 'exists(@)';
}

function relField(path: string, v: any): string {
  const at = path ? jp(path, '@') : '@';
  const ex = (pred: string) => `exists(${at} ? (${pred}))`;
  const eq = (x: any) => (x instanceof RegExp ? ex(rxPred(x)) : plain(x) === null || x === undefined ? `!exists(${at} ? (@ != null))` : ex(`@ == ${lit(x)}`));
  if (!isOpObject(v)) return eq(v);
  const parts: string[] = [];
  for (const [op, val] of Object.entries(v)) {
    if (CMP[op]) parts.push(ex(`@ ${CMP[op]} ${lit(val)}`));
    else if (op === '$eq') parts.push(eq(val));
    else if (op === '$ne') parts.push(`!(${eq(val)})`);
    else if (op === '$in') parts.push(`(${(val as any[]).map(eq).join(' || ') || 'false'})`);
    else if (op === '$nin') parts.push(`!(${(val as any[]).map(eq).join(' || ') || 'false'})`);
    else if (op === '$exists') parts.push(val ? `exists(${at})` : `!exists(${at})`);
    else if (op === '$regex') parts.push(ex(rxPred(val instanceof RegExp ? val : new RegExp(String(val), v.$options || ''))));
    else if (op === '$options') continue;
    else throw new Error(`Operator ${op} tidak didukung dalam $elemMatch`);
  }
  return parts.join(' && ') || 'exists(@)';
}

function orderBy(sort: any): string {
  if (!sort) return '';
  const entries: [string, number][] =
    typeof sort === 'string' ? sort.split(/\s+/).filter(Boolean).map((s) => (s.startsWith('-') ? [s.slice(1), -1] : [s, 1])) : Object.entries(sort).map(([k, d]) => [k, d === 'desc' || d === 'descending' || Number(d) < 0 ? -1 : 1]);
  if (!entries.length) return '';
  return ' ORDER BY ' + entries.map(([k, d]) => `${k === '_id' ? '_id' : sqlPath(k)} ${d < 0 ? 'DESC NULLS LAST' : 'ASC NULLS FIRST'}`).join(', ');
}

/* ============================== Projection ============================== */
function parseSelect(sel: any): Record<string, number> | undefined {
  if (!sel) return undefined;
  if (typeof sel !== 'string') return sel;
  const out: Record<string, number> = {};
  sel.split(/\s+/).filter(Boolean).forEach((s) => (s.startsWith('-') ? (out[s.slice(1)] = 0) : (out[s] = 1)));
  return out;
}

function projSql(proj: Record<string, any> | undefined, p: Params): string {
  if (!proj || !Object.keys(proj).length) return 'doc';
  const incl = Object.keys(proj).filter((k) => k !== '_id' && proj[k]);
  if (incl.length || (proj._id && Object.keys(proj).length === 1)) {
    const roots = [...new Set(incl.map((k) => k.split('.')[0]))];
    if (proj._id !== 0 && proj._id !== false) roots.push('_id');
    return `(SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb) FROM jsonb_each(doc) e WHERE e.key = ANY(${p.add(roots)}::text[]))`;
  }
  const excl = Object.keys(proj).filter((k) => !proj[k] && !k.includes('.'));
  return excl.length ? `doc - ${p.add(excl)}::text[]` : 'doc';
}

/** Rapikan projection bertingkat ("sideA.label") yang tidak bisa dilakukan di SQL. */
function trimNested(rows: any[], proj: Record<string, any> | undefined) {
  if (!proj) return;
  const incl = Object.keys(proj).filter((k) => proj[k] && k.includes('.'));
  const whole = new Set(Object.keys(proj).filter((k) => proj[k] && !k.includes('.')));
  const byRoot = new Map<string, string[]>();
  incl.forEach((k) => {
    const [root, ...rest] = k.split('.');
    if (!whole.has(root)) byRoot.set(root, [...(byRoot.get(root) || []), rest.join('.')]);
  });
  const excl = Object.keys(proj).filter((k) => !proj[k] && k.includes('.'));
  const keep = (v: any, paths: string[]): any => {
    if (Array.isArray(v)) return v.map((x) => keep(x, paths));
    if (!v || typeof v !== 'object') return v;
    const out: any = {};
    for (const path of paths) {
      const [h, ...r] = path.split('.');
      if (v[h] === undefined) continue;
      out[h] = r.length ? { ...(out[h] || {}), ...keep(v[h], [r.join('.')]) } : v[h];
    }
    return out;
  };
  for (const row of rows) {
    for (const [root, paths] of byRoot) if (row[root] !== undefined) row[root] = keep(row[root], paths);
    excl.forEach((k) => unsetPath(row, k));
  }
}

/* ============================== Updates ============================== */
function applyUpdate(m: Meta, doc: any, update: any, inserting: boolean) {
  const ops = Object.keys(update || {}).some((k) => k.startsWith('$')) ? update : { $set: update };
  const castAt = (path: string, v: any, elem = false) => {
    const n = nodeAt(m.schema.fields, path);
    if (!n) return undefined;
    return cast(elem && n.kind === 'array' ? n.of : n, v);
  };
  const known = (path: string) => !!nodeAt(m.schema.fields, path);
  for (const [op, fields] of Object.entries<any>(ops)) {
    if (op === '$setOnInsert' && !inserting) continue;
    for (const [path, val] of Object.entries<any>(fields || {})) {
      if (path === '_id' || (val === undefined && op !== '$unset') || !known(path)) continue;
      switch (op) {
        case '$set':
        case '$setOnInsert':
          setPath(doc, path, castAt(path, val));
          break;
        case '$unset':
          unsetPath(doc, path);
          break;
        case '$inc':
          setPath(doc, path, (Number(getPath(doc, path)) || 0) + Number(val));
          break;
        case '$min':
        case '$max': {
          const cur = getPath(doc, path);
          const v = castAt(path, val);
          if (cur === undefined || cur === null || (op === '$min' ? compare(v, cur) < 0 : compare(v, cur) > 0)) setPath(doc, path, v);
          break;
        }
        case '$push':
        case '$addToSet': {
          const arr = Array.isArray(getPath(doc, path)) ? getPath(doc, path) : [];
          const items = val && typeof val === 'object' && Array.isArray(val.$each) ? val.$each : [val];
          for (const it of items) {
            const v = castAt(path, it, true);
            if (op === '$push' || !arr.some((x: any) => JSON.stringify(x) === JSON.stringify(v))) arr.push(v);
          }
          setPath(doc, path, arr);
          break;
        }
        case '$pull': {
          const arr = getPath(doc, path);
          if (!Array.isArray(arr)) break;
          const v = plain(val);
          setPath(doc, path, arr.filter((x: any) => (v && typeof v === 'object' ? !Object.entries(v).every(([k, y]) => String(plain(x?.[k])) === String(plain(y))) : String(plain(x)) !== String(v))));
          break;
        }
        default:
          throw new Error(`Update operator ${op} tidak didukung`);
      }
    }
  }
  const now = new Date();
  if (inserting && !doc.createdAt) doc.createdAt = now;
  doc.updatedAt = now;
  return doc;
}

/** Dokumen baru dari upsert: field kesetaraan di filter + update + default. */
function upsertDoc(m: Meta, filter: any, update: any) {
  const base: any = {};
  for (const [k, v] of Object.entries(filter || {})) {
    if (k.startsWith('$') || v === undefined || v instanceof RegExp) continue;
    if (isOpObject(v)) {
      if ('$eq' in (v as any)) setPath(base, k, (v as any).$eq);
      continue;
    }
    setPath(base, k, v);
  }
  applyUpdate(m, base, update, true);
  return finalizeNew(m, base);
}

function finalizeNew(m: Meta, data: any) {
  const v = castObject(m.schema.fields, withDefaults(m.schema.fields, { ...data }));
  v._id = data._id !== undefined && data._id !== null ? String(plain(data._id)) : newId();
  if (data.createdAt) v.createdAt = castScalar('date', data.createdAt, {});
  if (data.updatedAt) v.updatedAt = castScalar('date', data.updatedAt, {});
  return v;
}

function validateRequired(m: Meta, obj: any) {
  for (const [k, n] of Object.entries(m.schema.fields)) {
    if (n.o.required && (obj[k] === undefined || obj[k] === null || obj[k] === '')) {
      const e = new Error(`Path \`${k}\` is required.`);
      e.name = 'ValidationError';
      throw e;
    }
  }
}

/** Bentuk yang disimpan ke kolom doc. */
function toStore(m: Meta, obj: any) {
  const v = castObject(m.schema.fields, obj);
  v._id = String(obj._id);
  if (obj.createdAt) v.createdAt = castScalar('date', obj.createdAt, {});
  if (obj.updatedAt) v.updatedAt = castScalar('date', obj.updatedAt, {});
  return v;
}

const snapshot = (d: any) => JSON.stringify({ ...d, updatedAt: undefined });

/* ============================== Aggregation ============================== */
const typeRank = (v: any) => (v === null || v === undefined ? 1 : typeof v === 'number' ? 2 : typeof v === 'string' ? 3 : v instanceof Date ? 9 : typeof v === 'boolean' ? 8 : Array.isArray(v) ? 5 : 4);

function compare(a: any, b: any): number {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 1) return 0;
  if (a instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'object') {
    const sa = JSON.stringify(a);
    const sb = JSON.stringify(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function evalExpr(doc: any, e: any): any {
  if (typeof e === 'string') return e.startsWith('$') ? getPath(doc, e.slice(1)) : e;
  if (Array.isArray(e)) return e.map((x) => evalExpr(doc, x));
  if (!e || typeof e !== 'object' || e instanceof Date) return e;
  const keys = Object.keys(e);
  if (keys.length !== 1 || !keys[0].startsWith('$')) {
    const out: any = {};
    for (const k of keys) out[k] = evalExpr(doc, e[k]);
    return out;
  }
  const op = keys[0];
  const arg = e[op];
  const args = () => (Array.isArray(arg) ? arg : [arg]).map((x: any) => evalExpr(doc, x));
  const num = (x: any) => (x instanceof Date ? x.getTime() : Number(x) || 0);
  switch (op) {
    case '$cond': {
      const [c, t, f] = Array.isArray(arg) ? arg : [arg.if, arg.then, arg.else];
      return evalExpr(doc, c) ? evalExpr(doc, t) : evalExpr(doc, f);
    }
    case '$eq': { const [a, b] = args(); return compare(a, b) === 0; }
    case '$ne': { const [a, b] = args(); return compare(a, b) !== 0; }
    case '$gt': { const [a, b] = args(); return compare(a, b) > 0; }
    case '$gte': { const [a, b] = args(); return compare(a, b) >= 0; }
    case '$lt': { const [a, b] = args(); return compare(a, b) < 0; }
    case '$lte': { const [a, b] = args(); return compare(a, b) <= 0; }
    case '$and': return args().every(Boolean);
    case '$or': return args().some(Boolean);
    case '$not': return !args()[0];
    case '$ifNull': { const v = args(); return v.find((x) => x !== null && x !== undefined) ?? null; }
    case '$in': { const [a, arr] = args(); return (arr || []).some((x: any) => compare(a, x) === 0); }
    case '$size': { const [a] = args(); return Array.isArray(a) ? a.length : 0; }
    case '$add': return args().reduce((s: number, x: any) => s + num(x), 0);
    case '$subtract': { const [a, b] = args(); return num(a) - num(b); }
    case '$multiply': return args().reduce((s: number, x: any) => s * num(x), 1);
    case '$divide': { const [a, b] = args(); return num(b) ? num(a) / num(b) : null; }
    case '$concat': return args().map((x) => x ?? '').join('');
    case '$toString': { const [a] = args(); return a === null || a === undefined ? null : a instanceof Date ? a.toISOString() : String(a); }
    case '$dateToString': {
      const d = evalExpr(doc, arg.date);
      if (!d) return null;
      const dt = d instanceof Date ? d : new Date(d);
      const pad = (n: number, l = 2) => String(n).padStart(l, '0');
      const map: Record<string, string> = { Y: String(dt.getUTCFullYear()), m: pad(dt.getUTCMonth() + 1), d: pad(dt.getUTCDate()), H: pad(dt.getUTCHours()), M: pad(dt.getUTCMinutes()), S: pad(dt.getUTCSeconds()), L: pad(dt.getUTCMilliseconds(), 3) };
      return String(arg.format || '%Y-%m-%dT%H:%M:%S.%LZ').replace(/%([YmdHMSL%])/g, (_m, c) => (c === '%' ? '%' : map[c]));
    }
    case '$literal': return arg;
    default:
      throw new Error(`Expression ${op} tidak didukung`);
  }
}

function groupStage(rows: any[], spec: any): any[] {
  const groups = new Map<string, { _id: any; acc: Record<string, any> }>();
  const fields = Object.entries<any>(spec).filter(([k]) => k !== '_id');
  for (const row of rows) {
    const id = evalExpr(row, spec._id ?? null) ?? null;
    const key = JSON.stringify(id);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { _id: id, acc: {} }));
    for (const [name, accSpec] of fields) {
      const [op, ex] = Object.entries<any>(accSpec)[0];
      const v = evalExpr(row, ex);
      const a = g.acc;
      switch (op) {
        case '$sum': a[name] = (a[name] || 0) + (typeof v === 'number' ? v : 0); break;
        case '$avg': a[name] = a[name] || { s: 0, n: 0 }; if (typeof v === 'number') { a[name].s += v; a[name].n++; } break;
        case '$min': if (v !== null && v !== undefined && (a[name] === undefined || compare(v, a[name]) < 0)) a[name] = v; break;
        case '$max': if (v !== null && v !== undefined && (a[name] === undefined || compare(v, a[name]) > 0)) a[name] = v; break;
        case '$first': if (!(name in a)) a[name] = v ?? null; break;
        case '$last': a[name] = v ?? null; break;
        case '$push': (a[name] = a[name] || []).push(v); break;
        case '$addToSet': a[name] = a[name] || []; if (!a[name].some((x: any) => compare(x, v) === 0)) a[name].push(v); break;
        case '$count': a[name] = (a[name] || 0) + 1; break;
        default: throw new Error(`Accumulator ${op} tidak didukung`);
      }
    }
  }
  return [...groups.values()].map(({ _id, acc }) => {
    const out: any = { _id };
    for (const [name, accSpec] of fields) {
      const op = Object.keys(accSpec)[0];
      const v = acc[name];
      out[name] = op === '$avg' ? (v?.n ? v.s / v.n : null) : op === '$sum' || op === '$count' ? v || 0 : v ?? (op === '$push' || op === '$addToSet' ? [] : null);
    }
    return out;
  });
}

function runPipeline(rows: any[], stages: any[]): any[] {
  let out = rows;
  for (const stage of stages) {
    const [op, spec] = Object.entries<any>(stage)[0];
    switch (op) {
      case '$group': out = groupStage(out, spec); break;
      case '$sort': {
        const keys = Object.entries<any>(spec);
        out = [...out].sort((a, b) => {
          for (const [k, d] of keys) {
            const c = compare(getPath(a, k), getPath(b, k));
            if (c) return d < 0 ? -c : c;
          }
          return 0;
        });
        break;
      }
      case '$limit': out = out.slice(0, spec); break;
      case '$skip': out = out.slice(spec); break;
      case '$count': out = [{ [spec]: out.length }]; break;
      case '$unwind': {
        const path = (typeof spec === 'string' ? spec : spec.path).slice(1);
        const keep = typeof spec === 'object' && spec.preserveNullAndEmptyArrays;
        out = out.flatMap((r) => {
          const arr = getPath(r, path);
          if (!Array.isArray(arr) || !arr.length) return keep ? [r] : [];
          return arr.map((x) => {
            const c = { ...r };
            setPath(c, path, x);
            return c;
          });
        });
        break;
      }
      case '$project': {
        const incl = Object.entries<any>(spec);
        out = out.map((r) => {
          if (incl.every(([, v]) => v === 0 || v === false)) {
            const c = clone(r);
            incl.forEach(([k]) => unsetPath(c, k));
            return c;
          }
          const c: any = spec._id === 0 || spec._id === false ? {} : { _id: r._id };
          for (const [k, v] of incl) if (k !== '_id' || (v !== 0 && v !== false)) setPath(c, k, v === 1 || v === true ? getPath(r, k) : evalExpr(r, v));
          return c;
        });
        break;
      }
      default:
        throw new Error(`Aggregation stage ${op} tidak didukung`);
    }
  }
  return out;
}

/** $group sederhana (key = field / null; $sum:1, $sum/$avg field) langsung di SQL. */
async function sqlGroup(m: Meta, filter: any, stages: any[]): Promise<any[] | null> {
  const g = stages[0]?.$group;
  if (!g || stages.slice(1).some((s) => !s.$sort)) return null;
  const p = new Params();
  const w = where(filter, p);
  const cols: string[] = [];
  const idSpec = g._id ?? null;
  if (idSpec !== null && !(typeof idSpec === 'string' && idSpec.startsWith('$') && idSpec.slice(1).split('.').every((s: string) => SAFE_KEY.test(s)))) return null;
  for (const [name, acc] of Object.entries<any>(g)) {
    if (name === '_id') continue;
    if (!SAFE_KEY.test(name)) return null;
    const [op, ex] = Object.entries<any>(acc)[0] || [];
    if (op === '$sum' && ex === 1) cols.push(`COUNT(*)::int AS "${name}"`);
    else if ((op === '$sum' || op === '$avg') && typeof ex === 'string' && ex.startsWith('$')) {
      const path = ex.slice(1);
      if (!path.split('.').every((s) => SAFE_KEY.test(s))) return null;
      const num = `CASE WHEN jsonb_typeof(${sqlPath(path)}) = 'number' THEN (${sqlPath(path)})::float8 END`;
      cols.push(op === '$sum' ? `COALESCE(SUM(${num}), 0)::float8 AS "${name}"` : `AVG(${num})::float8 AS "${name}"`);
    } else return null;
  }
  const key = idSpec === null ? `NULL::jsonb` : sqlPath(idSpec.slice(1));
  const rows = await sql(`SELECT ${key} AS _id${cols.length ? ', ' + cols.join(', ') : ''} FROM ${m.t} WHERE ${w}${idSpec === null ? ' HAVING COUNT(*) > 0' : ' GROUP BY 1'}`, p.list);
  return runPipeline(rows, stages.slice(1));
}

/* ============================== Model metadata ============================== */
const registry = new Map<string, Meta>();
const g = global as any;
const ready: Map<string, Promise<void>> = g.__docdbReady || (g.__docdbReady = new Map());

class Meta {
  t: string;
  Ctor!: any;
  constructor(public name: string, public schema: Schema) {
    const lower = name.toLowerCase();
    this.t = `"${lower.endsWith('y') ? lower.slice(0, -1) + 'ies' : lower + 's'}"`;
  }

  ensure(): Promise<void> {
    let pr = ready.get(this.t);
    if (!pr) {
      pr = this.createTable().catch((e) => {
        ready.delete(this.t);
        throw e;
      });
      ready.set(this.t, pr);
    }
    return pr;
  }

  private async createTable() {
    const base = this.t.slice(1, -1);
    const stmts = [
      `CREATE TABLE IF NOT EXISTS ${this.t} (_id text PRIMARY KEY, doc jsonb NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS "${base}_doc_gin" ON ${this.t} USING gin (doc jsonb_path_ops)`,
    ];
    const uniques = Object.entries(this.schema.fields)
      .filter(([, n]) => n.o.unique)
      .map(([k]) => [k]);
    this.schema.indexes.filter((i) => i.unique).forEach((i) => uniques.push(Object.keys(i.keys)));
    for (const keys of uniques) stmts.push(`CREATE UNIQUE INDEX IF NOT EXISTS "${base}_u_${keys.join('_')}" ON ${this.t} (${keys.map((k) => `(${sqlPath(k).replace('->', '->>').replace('#>', '#>>')})`).join(', ')})`);
    for (const [k, n] of Object.entries(this.schema.fields)) {
      if (n.o.index && !n.o.unique && n.kind === 'scalar') stmts.push(`CREATE INDEX IF NOT EXISTS "${base}_i_${k}" ON ${this.t} ((doc->'${k}'))`);
    }
    for (const s of stmts) {
      try {
        await sql(s);
      } catch (e: any) {
        // dua instance membuat tabel/index bersamaan
        if (!['23505', '42P07', '42710'].includes(e.code)) throw e;
      }
    }
  }

  async rows(filter: any, opts: { proj?: any; sort?: any; skip?: number; limit?: number } = {}): Promise<any[]> {
    await this.ensure();
    const p = new Params();
    const w = where(filter, p);
    const col = projSql(opts.proj, p);
    let q = `SELECT ${col} AS doc FROM ${this.t} WHERE ${w}${orderBy(opts.sort)}`;
    if (opts.limit) q += ` LIMIT ${Number(opts.limit)}`;
    if (opts.skip) q += ` OFFSET ${Number(opts.skip)}`;
    const rows = (await sql(q, p.list)).map((r) => r.doc);
    trimNested(rows, opts.proj);
    return rows;
  }

  async insert(docs: any[], ignoreConflicts = false) {
    await this.ensure();
    for (let i = 0; i < docs.length; i += 500) {
      const chunk = docs.slice(i, i + 500);
      try {
        await sql(`INSERT INTO ${this.t} (_id, doc) SELECT * FROM unnest($1::text[], $2::jsonb[])${ignoreConflicts ? ' ON CONFLICT DO NOTHING' : ''}`, [chunk.map((d) => d._id), chunk.map((d) => JSON.stringify(d))]);
      } catch (e: any) {
        throw dupError(e);
      }
    }
  }

  async write(docs: any[]) {
    await this.ensure();
    for (let i = 0; i < docs.length; i += 500) {
      const chunk = docs.slice(i, i + 500);
      try {
        await sql(`INSERT INTO ${this.t} (_id, doc) SELECT * FROM unnest($1::text[], $2::jsonb[]) ON CONFLICT (_id) DO UPDATE SET doc = EXCLUDED.doc`, [chunk.map((d) => d._id), chunk.map((d) => JSON.stringify(d))]);
      } catch (e: any) {
        throw dupError(e);
      }
    }
  }
}

function dupError(e: any) {
  if (e?.code !== '23505') return e;
  const err: any = new Error(`E11000 duplicate key error: ${e.detail || e.message}`);
  err.code = 11000;
  return err;
}

/* ============================== Query ============================== */
type PopSpec = { path: string; select?: any; populate?: any; model?: string };

export class Query<T = any> implements Promise<T> {
  readonly [Symbol.toStringTag] = 'Query';
  private q: { sort?: any; skip?: number; limit?: number } = {};
  private pops: PopSpec[] = [];
  private isLean = false;

  constructor(
    private m: Meta,
    private single: boolean,
    private run: (q: { sort?: any; skip?: number; limit?: number }) => Promise<{ rows: any[]; wrap?: (v: any) => any }>,
  ) {}

  sort(s: any) {
    this.q.sort = s;
    return this;
  }
  skip(n: number) {
    this.q.skip = n;
    return this;
  }
  limit(n: number) {
    this.q.limit = n;
    return this;
  }
  populate(path: any, select?: any) {
    if (Array.isArray(path)) path.forEach((x) => this.populate(x));
    else if (typeof path === 'string') path.split(/\s+/).filter(Boolean).forEach((p) => this.pops.push({ path: p, select }));
    else if (path) this.pops.push(path);
    return this;
  }
  lean<R = T>(): Query<R> {
    this.isLean = true;
    return this as unknown as Query<R>;
  }

  async exec(): Promise<T> {
    const { rows, wrap } = await this.run(this.q);
    if (this.pops.length) await populate(this.m, rows, this.pops);
    const out = this.isLean ? rows : rows.map((r) => (r ? new this.m.Ctor(r, true) : r));
    const v = this.single ? (out[0] ?? null) : out;
    return (wrap ? wrap(v) : v) as T;
  }

  then<A = T, B = never>(onf?: ((v: T) => A | PromiseLike<A>) | null, onr?: ((e: any) => B | PromiseLike<B>) | null): Promise<A | B> {
    return this.exec().then(onf, onr);
  }
  catch<B = never>(onr?: ((e: any) => B | PromiseLike<B>) | null): Promise<T | B> {
    return this.exec().catch(onr);
  }
  finally(fn?: (() => void) | null): Promise<T> {
    return this.exec().finally(fn);
  }
}

async function populate(m: Meta, rows: any[], specs: PopSpec[]) {
  for (const spec of specs) {
    const node = nodeAt(m.schema.fields, spec.path);
    const leaf = node?.kind === 'array' ? node.of : node;
    const ref = spec.model || (leaf?.kind === 'scalar' ? leaf.o.ref : undefined);
    const refM = ref && registry.get(ref);
    if (!refM) continue;
    const ids = new Set<string>();
    const segs = spec.path.split('.');
    const walk = (obj: any, i: number, fn: (v: any) => any) => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) return obj.forEach((x) => walk(x, i, fn));
      if (i === segs.length - 1) {
        if (obj[segs[i]] !== undefined) obj[segs[i]] = fn(obj[segs[i]]);
      } else walk(obj[segs[i]], i + 1, fn);
    };
    rows.forEach((r) => walk(r, 0, (v) => ((Array.isArray(v) ? v : [v]).forEach((x) => x !== null && x !== undefined && ids.add(String(plain(x)))), v)));
    if (!ids.size) continue;
    const proj = parseSelect(spec.select);
    const found = await refM.rows({ _id: { $in: [...ids] } }, { proj });
    if (spec.populate) await populate(refM, found, Array.isArray(spec.populate) ? spec.populate : [typeof spec.populate === 'string' ? { path: spec.populate } : spec.populate]);
    const byId = new Map(found.map((d) => [String(d._id), d]));
    rows.forEach((r) =>
      walk(r, 0, (v) => (Array.isArray(v) ? v.map((x) => byId.get(String(plain(x)))).filter(Boolean) : v === null ? null : (byId.get(String(plain(v))) ?? null))),
    );
  }
}

/* ============================== Document & Model ============================== */
const NEW = new WeakSet<object>();
const metaOf = (x: any): Meta => (typeof x === 'function' ? x : x.constructor).__meta;

export class Doc {
  [key: string]: any;

  constructor(data: any = {}, hydrated = false) {
    const m = metaOf(this);
    if (hydrated) Object.assign(this, withDefaults(m.schema.fields, data));
    else {
      Object.assign(this, finalizeNew(m, data));
      NEW.add(this);
    }
  }

  get id(): string {
    return String(this._id);
  }

  async save() {
    const m = metaOf(this);
    const now = new Date();
    const isNew = NEW.has(this);
    if (isNew && !this.createdAt) this.createdAt = now;
    this.updatedAt = now;
    validateRequired(m, this);
    const row = toStore(m, this);
    if (isNew) {
      await m.insert([row]);
      NEW.delete(this);
    } else await m.write([row]);
    return this;
  }

  async deleteOne() {
    const m = metaOf(this);
    await m.ensure();
    await sql(`DELETE FROM ${m.t} WHERE _id = $1`, [String(this._id)]);
    return this;
  }

  toObject() {
    return clone({ ...this });
  }
  toJSON() {
    return this.toObject();
  }

  /* ---------- statics ---------- */
  static find(filter: any = {}, projection?: any): Query<any[]> {
    const m = metaOf(this);
    return new Query(m, false, async (q) => ({ rows: await m.rows(filter, { proj: projection, ...q }) }));
  }

  static findOne(filter: any = {}, projection?: any): Query<any> {
    const m = metaOf(this);
    return new Query(m, true, async (q) => ({ rows: await m.rows(filter, { proj: projection, ...q, limit: 1 }) }));
  }

  static findById(id: any, projection?: any): Query<any> {
    const m = metaOf(this);
    if (id === null || id === undefined || id === '') return new Query(m, true, async () => ({ rows: [] }));
    return this.findOne({ _id: String(plain(id)) }, projection);
  }

  static findOneAndUpdate(filter: any, update: any, opts: any = {}): Query<any> {
    const m = metaOf(this);
    return new Query(m, true, async (q) => {
      const [doc] = await m.rows(filter, { sort: q.sort || opts.sort, limit: 1 });
      const after = opts.new || opts.returnDocument === 'after';
      let value: any = null;
      let existed = false;
      if (doc) {
        existed = true;
        const before = clone(doc);
        applyUpdate(m, doc, update, false);
        if (snapshot(doc) !== snapshot(before)) await m.write([toStore(m, doc)]);
        value = after ? doc : before;
      } else if (opts.upsert) {
        const nd = upsertDoc(m, filter, update);
        await m.insert([nd]);
        value = after ? nd : null;
      }
      const meta = opts.includeResultMetadata || opts.rawResult;
      return { rows: [value], wrap: meta ? (v: any) => ({ value: v, ok: 1, lastErrorObject: { n: 1, updatedExisting: existed } }) : undefined };
    });
  }

  static findByIdAndUpdate(id: any, update: any, opts: any = {}): Query<any> {
    const m = metaOf(this);
    if (id === null || id === undefined || id === '') return new Query(m, true, async () => ({ rows: [] }));
    return this.findOneAndUpdate({ _id: String(plain(id)) }, update, opts);
  }

  static findOneAndDelete(filter: any): Query<any> {
    const m = metaOf(this);
    return new Query(m, true, async () => {
      await m.ensure();
      const p = new Params();
      const w = where(filter, p);
      const rows = await sql(`DELETE FROM ${m.t} WHERE _id IN (SELECT _id FROM ${m.t} WHERE ${w} LIMIT 1) RETURNING doc`, p.list);
      return { rows: rows.map((r) => r.doc) };
    });
  }

  static findByIdAndDelete(id: any): Query<any> {
    const m = metaOf(this);
    if (id === null || id === undefined || id === '') return new Query(m, true, async () => ({ rows: [] }));
    return this.findOneAndDelete({ _id: String(plain(id)) });
  }

  static async countDocuments(filter: any = {}): Promise<number> {
    const m = metaOf(this);
    await m.ensure();
    const p = new Params();
    const [r] = await sql(`SELECT COUNT(*)::int AS n FROM ${m.t} WHERE ${where(filter, p)}`, p.list);
    return r.n;
  }

  static async exists(filter: any = {}): Promise<{ _id: string } | null> {
    const m = metaOf(this);
    await m.ensure();
    const p = new Params();
    const [r] = await sql(`SELECT _id FROM ${m.t} WHERE ${where(filter, p)} LIMIT 1`, p.list);
    return r ? { _id: r._id } : null;
  }

  static async distinct(field: string, filter: any = {}): Promise<any[]> {
    const m = metaOf(this);
    await m.ensure();
    const p = new Params();
    const w = where(filter, p);
    const rows = await sql(`SELECT DISTINCT v FROM ${m.t}, jsonb_path_query(doc, ${p.add(jp(field) + '[*]')}::jsonpath) v WHERE ${w}`, p.list);
    return rows.map((r) => r.v).filter((v) => v !== null);
  }

  static async create(data: any): Promise<any> {
    const list = Array.isArray(data) ? data : [data];
    const docs = list.map((d) => new this(d));
    const now = new Date();
    docs.forEach((d) => {
      d.createdAt = d.createdAt || now;
      d.updatedAt = d.updatedAt || now;
      validateRequired(metaOf(this), d);
    });
    await metaOf(this).insert(docs.map((d) => toStore(metaOf(this), d)));
    docs.forEach((d) => NEW.delete(d));
    return Array.isArray(data) ? docs : docs[0];
  }

  static async insertMany(list: any[], opts: any = {}): Promise<any[]> {
    const m = metaOf(this);
    const now = new Date();
    const docs = list.map((d) => {
      const doc = new this(d);
      doc.createdAt = doc.createdAt || now;
      doc.updatedAt = doc.updatedAt || now;
      validateRequired(m, doc);
      NEW.delete(doc);
      return doc;
    });
    await m.insert(docs.map((d) => toStore(m, d)), opts.ordered === false);
    return docs;
  }

  static async updateOne(filter: any, update: any, opts: any = {}) {
    const m = metaOf(this);
    const [doc] = await m.rows(filter, { limit: 1 });
    if (doc) {
      const before = snapshot(doc);
      applyUpdate(m, doc, update, false);
      const changed = snapshot(doc) !== before;
      if (changed) await m.write([toStore(m, doc)]);
      return { acknowledged: true, matchedCount: 1, modifiedCount: changed ? 1 : 0, upsertedCount: 0, upsertedId: null };
    }
    if (opts.upsert) {
      const nd = upsertDoc(m, filter, update);
      try {
        await m.insert([nd]);
      } catch (e: any) {
        // instance lain baru saja membuat dokumen yang sama → perlakukan sebagai update
        if (e.code === 11000) return this.updateOne(filter, update, { ...opts, upsert: false });
        throw e;
      }
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: nd._id };
    }
    return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0, upsertedId: null };
  }

  static async updateMany(filter: any, update: any, opts: any = {}) {
    const m = metaOf(this);
    const docs = await m.rows(filter);
    if (!docs.length && opts.upsert) return this.updateOne(filter, update, opts);
    const changed = docs.filter((d) => {
      const before = snapshot(d);
      applyUpdate(m, d, update, false);
      return snapshot(d) !== before;
    });
    if (changed.length) await m.write(changed.map((d) => toStore(m, d)));
    return { acknowledged: true, matchedCount: docs.length, modifiedCount: changed.length, upsertedCount: 0, upsertedId: null };
  }

  static async deleteOne(filter: any = {}) {
    const m = metaOf(this);
    await m.ensure();
    const p = new Params();
    const rows = await sql(`DELETE FROM ${m.t} WHERE _id IN (SELECT _id FROM ${m.t} WHERE ${where(filter, p)} LIMIT 1) RETURNING _id`, p.list);
    return { acknowledged: true, deletedCount: rows.length };
  }

  static async deleteMany(filter: any = {}) {
    const m = metaOf(this);
    await m.ensure();
    const p = new Params();
    const rows = await sql(`DELETE FROM ${m.t} WHERE ${where(filter, p)} RETURNING _id`, p.list);
    return { acknowledged: true, deletedCount: rows.length };
  }

  static async bulkWrite(ops: any[], _opts: any = {}) {
    const m = metaOf(this);
    const simple = (f: any) =>
      f && Object.keys(f).length > 0 && Object.entries(f).every(([k, v]) => !k.startsWith('$') && isScalar(v) && (k === '_id' || nodeAt(m.schema.fields, k)?.kind === 'scalar'));
    if (!ops.every((o) => o.updateOne && simple(o.updateOne.filter))) {
      let matched = 0, modified = 0, upserted = 0, inserted = 0, deleted = 0;
      for (const o of ops) {
        if (o.insertOne) inserted += (await this.insertMany([o.insertOne.document])).length;
        else if (o.updateOne || o.updateMany) {
          const s = o.updateOne || o.updateMany;
          const r: any = await (o.updateOne ? this.updateOne : this.updateMany).call(this, s.filter, s.update, { upsert: s.upsert });
          matched += r.matchedCount; modified += r.modifiedCount; upserted += r.upsertedCount;
        } else if (o.replaceOne) {
          const r = await this.findOneAndUpdate(o.replaceOne.filter, { $set: o.replaceOne.replacement }, { upsert: o.replaceOne.upsert }).lean();
          if (r) matched++;
        } else if (o.deleteOne) deleted += (await this.deleteOne(o.deleteOne.filter)).deletedCount;
        else if (o.deleteMany) deleted += (await this.deleteMany(o.deleteMany.filter)).deletedCount;
      }
      return { ok: 1, insertedCount: inserted, matchedCount: matched, modifiedCount: modified, upsertedCount: upserted, deletedCount: deleted };
    }

    // jalur cepat: updateOne berdasarkan field kesetaraan sederhana → ambil semua kandidat sekali, tulis sekali
    let matched = 0, modified = 0, upserted = 0;
    const sig = (keys: string[], vals: any[]) => JSON.stringify(keys.map((k, i) => [k, plain(vals[i])]));
    for (let i = 0; i < ops.length; i += 1000) {
      const chunk = ops.slice(i, i + 1000).map((o) => o.updateOne);
      const byKeys = new Map<string, any[]>();
      chunk.forEach((u) => {
        const ks = Object.keys(u.filter).sort().join(',');
        byKeys.set(ks, [...(byKeys.get(ks) || []), u]);
      });
      const found = new Map<string, any>();
      for (const [ks, list] of byKeys) {
        const keys = ks.split(',');
        await m.ensure();
        let rows: any[];
        if (keys.length === 1 && keys[0] === '_id') rows = (await sql(`SELECT doc FROM ${m.t} WHERE _id = ANY($1::text[])`, [list.map((u) => String(plain(u.filter._id)))])).map((r) => r.doc);
        else {
          const probes = list.map((u) => {
            const o: any = {};
            keys.forEach((k) => setPath(o, k, plain(u.filter[k])));
            return JSON.stringify(o);
          });
          rows = (await sql(`SELECT doc FROM ${m.t} WHERE doc @> ANY($1::jsonb[])`, [probes])).map((r) => r.doc);
        }
        rows.forEach((d) => {
          const k = sig(keys, keys.map((x) => getPath(d, x)));
          if (!found.has(k)) found.set(k, d);
        });
      }
      const before = new Map<any, string>();
      const inserts: any[] = [];
      for (const u of chunk) {
        const keys = Object.keys(u.filter).sort();
        const k = sig(keys, keys.map((x) => u.filter[x]));
        const doc = found.get(k);
        if (doc) {
          if (!before.has(doc)) before.set(doc, snapshot(doc));
          applyUpdate(m, doc, u.update, false);
          matched++;
        } else if (u.upsert) {
          const nd = upsertDoc(m, u.filter, u.update);
          found.set(k, nd);
          inserts.push(nd);
          upserted++;
        }
      }
      const changed = [...before].filter(([d, s]) => !inserts.includes(d) && snapshot(d) !== s).map(([d]) => d);
      modified += changed.length;
      if (inserts.length) await m.insert(inserts.map((d) => toStore(m, d)), true);
      if (changed.length) await m.write(changed.map((d) => toStore(m, d)));
    }
    return { ok: 1, matchedCount: matched, modifiedCount: modified, upsertedCount: upserted, insertedCount: 0, deletedCount: 0 };
  }

  static async aggregate(pipeline: any[]): Promise<any[]> {
    const m = metaOf(this);
    await m.ensure();
    const stages = [...pipeline];
    const filter = stages[0]?.$match ? stages.shift().$match : {};
    const fast = await sqlGroup(m, filter, stages);
    if (fast) return fast;
    if (stages.some((s) => s.$match)) throw new Error('$match hanya didukung sebagai stage pertama');
    return runPipeline(await m.rows(filter), stages);
  }
}

export interface ModelType {
  new (data?: any): any;
  find(filter?: any, projection?: any): Query<any[]>;
  findOne(filter?: any, projection?: any): Query<any>;
  findById(id: any, projection?: any): Query<any>;
  findOneAndUpdate(filter: any, update: any, opts?: any): Query<any>;
  findByIdAndUpdate(id: any, update: any, opts?: any): Query<any>;
  findOneAndDelete(filter: any): Query<any>;
  findByIdAndDelete(id: any): Query<any>;
  countDocuments(filter?: any): Promise<number>;
  exists(filter?: any): Promise<{ _id: string } | null>;
  distinct(field: string, filter?: any): Promise<any[]>;
  create(data: any): Promise<any>;
  insertMany(docs: any[], opts?: any): Promise<any[]>;
  updateOne(filter: any, update: any, opts?: any): Promise<any>;
  updateMany(filter: any, update: any, opts?: any): Promise<any>;
  deleteOne(filter?: any): Promise<{ acknowledged: boolean; deletedCount: number }>;
  deleteMany(filter?: any): Promise<{ acknowledged: boolean; deletedCount: number }>;
  bulkWrite(ops: any[], opts?: any): Promise<any>;
  aggregate(pipeline: any[]): Promise<any[]>;
}

export function model(name: string, schema: Schema): ModelType {
  const meta = new Meta(name, schema);
  const M = class extends Doc {
    static __meta = meta;
  };
  Object.defineProperty(M, 'name', { value: name });
  meta.Ctor = M;
  registry.set(name, meta);
  return M as unknown as ModelType;
}
