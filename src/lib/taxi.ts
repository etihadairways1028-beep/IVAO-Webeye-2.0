/**
 * Taxi assistant: turns a taxi clearance the pilot types in ("34R via A B1",
 * "stand C3 via K A") into a route along the airport's OpenStreetMap taxiways,
 * with turn-by-turn steps.
 *
 * IVAO does not publish the instructions a controller gives, so the clearance always
 * comes from the pilot. Without "via", the assistant suggests the shortest route;
 * that is a suggestion, never a clearance.
 */
type LonLat = [number, number];

export interface TaxiClearance {
  dest: { kind: 'runway' | 'stand'; id: string } | null;
  via: string[];
  from: string | null; // optional starting stand when not using the live position
  raw: string;
}

export interface TaxiStep {
  text: string; // e.g. "Turn left onto B1"
  name: string; // taxiway name ('' for an unnamed link)
  turn: 'start' | 'left' | 'right' | 'straight' | 'cross' | 'end';
  startIdx: number; // index into path
  endIdx: number;
  lengthM: number;
}

export interface TaxiRoute {
  path: LonLat[];
  cum: number[]; // metres from start at each path vertex
  steps: TaxiStep[];
  lengthM: number;
  suggested: boolean; // true when no "via" was given
  destLabel: string;
  crossings: string[];
}

const M_PER_DEG = 111320;
function metres(a: LonLat, b: LonLat): number {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * M_PER_DEG * k, (b[1] - a[1]) * M_PER_DEG);
}
function brg(a: LonLat, b: LonLat): number {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return ((Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI + 360) % 360;
}
/** Distance from p to segment ab, in metres. */
function segDist(p: LonLat, a: LonLat, b: LonLat): number {
  const k = Math.cos((p[1] * Math.PI) / 180);
  const ax = (a[0] - p[0]) * k, ay = a[1] - p[1], bx = (b[0] - p[0]) * k, by = b[1] - p[1];
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy) * M_PER_DEG;
}
const norm = (s: string) => s.toUpperCase().replace(/\s+/g, '');
/** Runway designators compare without leading zeros: 04L and 4L are the same runway. */
const sameRwy = (a: string, b: string) => norm(a).replace(/^0+/, '') === norm(b).replace(/^0+/, '');

// ───────── clearance parsing

const RWY = /^(?:RWY|RUNWAY)?(\d{1,2}[LCR]?)$/;

export function parseClearance(text: string): TaxiClearance {
  const raw = text.trim();
  let t = raw.toUpperCase().replace(/[,.;]/g, ' ').replace(/\b(TAXI|TO|HOLDING POINT|HOLDING|POINT|AND|THEN|CLEARED)\b/g, ' ');
  let from: string | null = null;
  const fm = /\bFROM\s+(?:STAND|GATE|PARKING)?\s*([A-Z0-9]+)/.exec(t);
  if (fm) {
    from = fm[1];
    t = t.replace(fm[0], ' ');
  }
  t = t.replace(/\bHOLD\s+SHORT(\s+OF)?\b/g, ' ');
  const [destPart, viaPart = ''] = t.split(/\bVIA\b/);
  const via = viaPart.split(/\s+/).filter(Boolean).filter((x) => !/^(RWY|RUNWAY)$/.test(x));
  let dest: TaxiClearance['dest'] = null;
  const d = destPart.trim().split(/\s+/).filter(Boolean);
  if (d.length) {
    const standIdx = d.findIndex((x) => /^(STAND|GATE|PARKING|APRON)$/.test(x));
    if (standIdx >= 0 && d[standIdx + 1]) dest = { kind: 'stand', id: d[standIdx + 1] };
    else {
      const joined = d.join('');
      const m = RWY.exec(joined) ?? RWY.exec(d[d.length - 1]);
      if (m) dest = { kind: 'runway', id: m[1] };
      else dest = { kind: 'stand', id: d[d.length - 1] };
    }
  }
  return { dest, via, from, raw };
}

// ───────── graph

interface Edge {
  to: number;
  len: number;
  name: string; // normalised taxiway ref ('' if unnamed)
  kind: string; // taxiway | taxilane | parking_position
}

interface Graph {
  pts: LonLat[];
  adj: Edge[][];
  names: Set<string>;
  runways: { label: string; a: LonLat; b: LonLat; line: LonLat[] }[];
  stands: { label: string; p: LonLat }[];
}

const graphCache = new WeakMap<GeoJSON.FeatureCollection, Graph>();

export function buildGraph(fc: GeoJSON.FeatureCollection): Graph {
  const hit = graphCache.get(fc);
  if (hit) return hit;
  const idx = new Map<string, number>();
  const pts: LonLat[] = [];
  const adj: Edge[][] = [];
  const names = new Set<string>();
  const node = (c: LonLat) => {
    const k = `${c[0].toFixed(6)},${c[1].toFixed(6)}`;
    let i = idx.get(k);
    if (i == null) {
      i = pts.length;
      idx.set(k, i);
      pts.push(c);
      adj.push([]);
    }
    return i;
  };
  const runways: Graph['runways'] = [];
  const stands: Graph['stands'] = [];
  for (const f of fc.features) {
    const p = f.properties as { kind: string; label: string };
    if (f.geometry.type === 'LineString') {
      const c = f.geometry.coordinates as LonLat[];
      if (p.kind === 'runway') {
        runways.push({ label: p.label, a: c[0], b: c[c.length - 1], line: c });
        continue;
      }
      if (p.kind !== 'taxiway' && p.kind !== 'taxilane' && p.kind !== 'parking_position') continue;
      const name = p.kind === 'taxiway' ? norm(p.label) : '';
      if (name) names.add(name);
      for (let i = 0; i < c.length - 1; i++) {
        const a = node(c[i]), b = node(c[i + 1]);
        const len = metres(c[i], c[i + 1]);
        adj[a].push({ to: b, len, name, kind: p.kind });
        adj[b].push({ to: a, len, name, kind: p.kind });
      }
    } else if (f.geometry.type === 'Point' && (p.kind === 'parking_position' || p.kind === 'gate') && p.label) {
      stands.push({ label: norm(p.label), p: f.geometry.coordinates as LonLat });
    }
  }
  // OSM taxiways sometimes stop a few metres short of each other: bridge tiny gaps.
  const ends = pts.map((_, i) => i).filter((i) => adj[i].length === 1);
  for (const i of ends) {
    let best = -1, bd = 12;
    for (let j = 0; j < pts.length; j++) {
      if (j === i || adj[i].some((e) => e.to === j)) continue;
      const d = metres(pts[i], pts[j]);
      if (d < bd) (bd = d), (best = j);
    }
    if (best >= 0) {
      adj[i].push({ to: best, len: bd, name: '', kind: 'link' });
      adj[best].push({ to: i, len: bd, name: '', kind: 'link' });
    }
  }
  const g = { pts, adj, names, runways, stands };
  graphCache.set(fc, g);
  return g;
}

export const taxiwayNames = (fc: GeoJSON.FeatureCollection) => [...buildGraph(fc).names].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
export const runwayLabels = (fc: GeoJSON.FeatureCollection) => buildGraph(fc).runways.flatMap((r) => r.label.split('/')).filter(Boolean);

/** Which end of a runway a departure on `id` starts from (e.g. 34R → its southern end). */
function threshold(r: Graph['runways'][number], id: string): LonLat {
  const hdg = Number(id.replace(/\D/g, '')) * 10;
  const ab = brg(r.a, r.b);
  const diff = Math.abs(((ab - hdg + 540) % 360) - 180);
  return diff < 90 ? r.a : r.b;
}

function nearestNode(g: Graph, p: LonLat, filter?: (i: number) => boolean): number {
  let best = -1, bd = Infinity;
  for (let i = 0; i < g.pts.length; i++) {
    if (filter && !filter(i)) continue;
    const d = metres(p, g.pts[i]);
    if (d < bd) (bd = d), (best = i);
  }
  return best;
}

// Small binary heap for Dijkstra.
class Heap {
  private a: [number, number][] = [];
  push(cost: number, v: number) {
    const a = this.a;
    a.push([cost, v]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export type TaxiResult = { ok: true; route: TaxiRoute } | { ok: false; error: string };

/**
 * Route from `start` (live aircraft position, or a named stand) following the clearance.
 * State = (node, stage): stage k means the first k "via" taxiways have been joined in order.
 */
export function planTaxi(fc: GeoJSON.FeatureCollection, start: LonLat | null, c: TaxiClearance): TaxiResult {
  const g = buildGraph(fc);
  if (!g.pts.length) return { ok: false, error: 'This airport’s OpenStreetMap chart has no taxiways mapped.' };
  if (!c.dest) return { ok: false, error: 'Add where you are taxiing to, e.g. “34R via A B1” or “stand C3 via K”.' };

  // Start point.
  let startPt = start;
  if (c.from) {
    const s = g.stands.find((x) => x.label === norm(c.from!));
    if (!s) return { ok: false, error: `Stand ${c.from} isn’t on the chart.` };
    startPt = s.p;
  }
  if (!startPt) return { ok: false, error: 'No live position on the ground here. Connect to IVAO, or add “from stand C3”.' };
  const src = nearestNode(g, startPt);
  if (src < 0 || metres(startPt, g.pts[src]) > 600) return { ok: false, error: 'You’re not near any mapped taxiway at this airport.' };

  const via = c.via.map(norm);
  const unknown = via.filter((v) => !g.names.has(v));
  if (unknown.length) return { ok: false, error: `Taxiway ${unknown.join(', ')} isn’t on the OpenStreetMap chart for this airport.` };

  // Goal test + extra cost to pull the end towards the right spot.
  let goal: (i: number) => number | null; // returns extra cost if node is acceptable as an end
  let destLabel: string;
  if (c.dest.kind === 'runway') {
    const id = c.dest.id;
    const rw = g.runways.find((r) => r.label.split('/').some((x) => sameRwy(x, id)));
    if (!rw) return { ok: false, error: `Runway ${id} isn’t on the chart. Runways here: ${runwayLabels(fc).join(', ') || 'none mapped'}.` };
    const thr = threshold(rw, id);
    destLabel = `runway ${id}`;
    goal = (i) => {
      const p = g.pts[i];
      let d = Infinity;
      for (let k = 0; k < rw.line.length - 1; k++) d = Math.min(d, segDist(p, rw.line[k], rw.line[k + 1]));
      return d < 110 ? metres(p, thr) * 0.8 : null;
    };
  } else {
    const st = g.stands.find((s) => s.label === norm(c.dest!.id));
    if (!st) return { ok: false, error: `Stand ${c.dest.id} isn’t on the chart.` };
    destLabel = `stand ${c.dest.id}`;
    goal = (i) => {
      const d = metres(g.pts[i], st.p);
      return d < 90 ? d * 2 : null;
    };
  }

  const V = via.length;
  const S = V + 1;
  const N = g.pts.length;
  const dist = new Float64Array(N * S).fill(Infinity);
  const prev = new Int32Array(N * S).fill(-1);
  const heap = new Heap();
  dist[src * S] = 0;
  heap.push(0, src * S);
  let best = -1, bestCost = Infinity;
  for (;;) {
    const top = heap.pop();
    if (!top) break;
    const [d, v] = top;
    if (d > dist[v] || d >= bestCost) continue;
    const n = Math.floor(v / S), k = v % S;
    if (k === V) {
      const extra = goal(n);
      if (extra != null && d + extra < bestCost) (bestCost = d + extra), (best = v);
    }
    for (const e of g.adj[n]) {
      let nk = k;
      let w = e.len;
      if (V === 0) {
        // Suggestion mode: prefer named taxiways over taxilanes and links.
        if (!e.name) w *= e.kind === 'parking_position' ? 1.1 : 1.4;
      } else if (e.name) {
        const cur = k > 0 ? via[k - 1] : null;
        if (e.name === cur) nk = k;
        else if (k < V && e.name === via[k]) nk = k + 1;
        else if (k === V) w *= 2.5; // after the last named taxiway: short link to the holding point (e.g. "A1")
        else continue; // a taxiway that isn't in the clearance
      } else {
        // Unnamed links (stand lead-ins, junction stubs): allowed but discouraged mid-route.
        w *= k === 0 || k === V ? 1.2 : 3;
      }
      const u = e.to * S + nk;
      const nd = d + w;
      if (nd < dist[u]) {
        dist[u] = nd;
        prev[u] = v;
        heap.push(nd, u);
      }
    }
  }
  if (best < 0) {
    return {
      ok: false,
      error: V ? `Couldn’t follow ${via.join(' → ')} to ${destLabel} on the chart. Check the order, or the OpenStreetMap chart may be incomplete here.` : `No taxi route to ${destLabel} found on the chart.`,
    };
  }

  // Rebuild the path with the taxiway name of each edge.
  const nodes: number[] = [];
  for (let v = best; v >= 0; v = prev[v]) nodes.push(Math.floor(v / S));
  nodes.reverse();
  const path: LonLat[] = [startPt, ...nodes.map((i) => g.pts[i])];
  const edgeNames: string[] = ['']; // first leg: aircraft → nearest node
  for (let i = 0; i < nodes.length - 1; i++) {
    const e = g.adj[nodes[i]].find((x) => x.to === nodes[i + 1]);
    edgeNames.push(e?.name ?? '');
  }
  if (c.dest.kind === 'stand') {
    const st = g.stands.find((s) => s.label === norm(c.dest!.id))!;
    path.push(st.p);
    edgeNames.push('');
  }
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + metres(path[i - 1], path[i]));

  // Runway crossings on the way (any runway other than the destination one).
  const destRw = c.dest.kind === 'runway' ? c.dest.id : null;
  const crossings: { idx: number; label: string }[] = [];
  for (const r of g.runways) {
    if (destRw && r.label.split('/').some((x) => sameRwy(x, destRw))) continue;
    for (let i = 1; i < path.length - 1; i++) {
      let d = Infinity;
      for (let k = 0; k < r.line.length - 1; k++) d = Math.min(d, segDist(path[i], r.line[k], r.line[k + 1]));
      if (d < 25) {
        if (!crossings.some((x) => x.label === r.label)) crossings.push({ idx: i, label: r.label });
        break;
      }
    }
  }

  // Group consecutive edges into steps by taxiway name (unnamed bits join their neighbour).
  const named = edgeNames.map((n, i) => n || edgeNames.slice(i).find(Boolean) || edgeNames.slice(0, i).reverse().find(Boolean) || '');
  const steps: TaxiStep[] = [];
  let s0 = 0;
  for (let i = 1; i <= named.length; i++) {
    if (i < named.length && named[i] === named[s0]) continue;
    const a = s0, b = i; // edges a..b-1 → path vertices a..b
    const name = named[a];
    let turn: TaxiStep['turn'] = steps.length ? 'straight' : 'start';
    if (steps.length) {
      const inB = brg(path[Math.max(0, a - 1)], path[a]);
      const outB = brg(path[a], path[Math.min(path.length - 1, a + 1)]);
      const dd = ((outB - inB + 540) % 360) - 180;
      turn = dd < -25 ? 'left' : dd > 25 ? 'right' : 'straight';
    }
    const lengthM = cum[b] - cum[a];
    const text = steps.length
      ? `${turn === 'left' ? 'Turn left onto' : turn === 'right' ? 'Turn right onto' : 'Continue onto'} ${name || 'the link'}`
      : `Taxi ${name ? `via ${name}` : 'out'}`;
    steps.push({ text, name, turn, startIdx: a, endIdx: b, lengthM });
    s0 = i;
  }
  for (const x of crossings) {
    const at = steps.findIndex((s) => x.idx >= s.startIdx && x.idx <= s.endIdx);
    steps.splice(at + 1 > 0 ? at + 1 : steps.length, 0, { text: `Cross runway ${x.label} only when cleared`, name: '', turn: 'cross', startIdx: x.idx, endIdx: x.idx, lengthM: 0 });
  }
  const last = path.length - 1;
  steps.push({ text: c.dest.kind === 'runway' ? `Hold short of runway ${c.dest.id}` : `Arrive at stand ${c.dest.id}`, name: '', turn: 'end', startIdx: last, endIdx: last, lengthM: 0 });

  return { ok: true, route: { path, cum, steps, lengthM: cum[last], suggested: V === 0, destLabel, crossings: crossings.map((x) => x.label) } };
}

/** Live guidance: where along the route the aircraft is, and which step is next. */
export function taxiProgress(r: TaxiRoute, p: LonLat): { alongM: number; offM: number; stepIdx: number; toNextM: number } {
  let bestI = 0, bestD = Infinity, bestT = 0;
  for (let i = 0; i < r.path.length - 1; i++) {
    const a = r.path[i], b = r.path[i + 1];
    const d = segDist(p, a, b);
    if (d < bestD) {
      bestD = d;
      bestI = i;
      const seg = metres(a, b);
      bestT = seg ? Math.min(1, metres(a, p) / seg) : 0;
    }
  }
  const alongM = r.cum[bestI] + (r.cum[bestI + 1] - r.cum[bestI]) * bestT;
  let stepIdx = r.steps.findIndex((s) => r.cum[s.endIdx] > alongM + 5);
  if (stepIdx < 0) stepIdx = r.steps.length - 1;
  const toNextM = Math.max(0, r.cum[r.steps[stepIdx].endIdx] - alongM);
  return { alongM, offM: bestD, stepIdx, toNextM };
}
