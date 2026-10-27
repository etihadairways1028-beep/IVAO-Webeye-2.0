// Airport ground charts from OpenStreetMap (© OpenStreetMap contributors, ODbL)
// via the public Overpass API: runways, taxiways (with names), aprons, terminals,
// parking stands, gates and holding points. Fetched once per airport and cached.
import { OVERPASS_MIRRORS } from './endpoints';
import { getAirport } from './airports';

type FC = GeoJSON.FeatureCollection;
export type ChartState = { status: 'loading' } | { status: 'ready'; fc: FC; counts: { taxiways: number; stands: number; gates: number } } | { status: 'error'; error: string };

const cache = new Map<string, ChartState>();
const pending = new Map<string, Promise<ChartState>>();
const listeners = new Set<() => void>();

export const onChartsChange = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const emit = () => listeners.forEach((l) => l());
export const chartState = (icao: string) => cache.get(icao) ?? null;

const AREA = new Set(['apron', 'terminal', 'hangar']);

interface OsmEl {
  type: 'node' | 'way';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

const DEFAULT_WIDTH: Record<string, number> = { runway: 45, taxiway: 20, taxilane: 12, holding_position: 0 };
/** Width in metres → pixels at zoom 10 (MapLibre 512px tiles), so lines are drawn to real scale. */
const px10 = (w: number, lat: number) => (w * 1024) / (78271.517 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
const brgDeg = (a: number[], b: number[]) => {
  const k = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  return ((Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI + 360) % 360;
};

function toGeoJSON(els: OsmEl[]): FC {
  const features: GeoJSON.Feature[] = [];
  for (const e of els) {
    const t = e.tags ?? {};
    const kind = t.aeroway;
    if (!kind) continue;
    const label = t.ref || t.name || '';
    if (e.type === 'node' && e.lat != null && e.lon != null) {
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [e.lon, e.lat] }, properties: { kind, label } });
    } else if (e.type === 'way' && e.geometry && e.geometry.length > 1) {
      const coords = e.geometry.map((g) => [g.lon, g.lat]);
      const closed = coords.length > 3 && coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1];
      if (closed && (AREA.has(kind) || t.area === 'yes')) {
        features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: { kind, label } });
        if (kind === 'parking_position' || kind === 'gate') {
          const c = coords.reduce((a, p) => [a[0] + p[0] / coords.length, a[1] + p[1] / coords.length], [0, 0]);
          features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { kind, label } });
        }
      } else {
        const w = parseFloat((t.width ?? '').replace(',', '.')) || DEFAULT_WIDTH[kind] || 15;
        features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { kind, label, w10: px10(w, coords[0][1]) } });
        // Runway ends: the designator a pilot lining up there would see, rotated along the runway.
        if (kind === 'runway' && label.includes('/')) {
          const a = coords[0], b = coords[coords.length - 1];
          const hdg = brgDeg(a, b);
          const parts = label.split('/').map((x) => x.trim());
          const num = (d: string) => (parseInt(d, 10) || 0) * 10;
          const diff = (d: string, h: number) => Math.abs(((num(d) - h + 540) % 360) - 180);
          const atA = diff(parts[0], hdg) <= diff(parts[1], hdg) ? parts[0] : parts[1];
          const atB = atA === parts[0] ? parts[1] : parts[0];
          const inset = (p: number[], q: number[], f: number) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
          features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: inset(a, b, 0.04) }, properties: { kind: 'rwy-end', label: atA, rot: hdg } });
          features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: inset(b, a, 0.04) }, properties: { kind: 'rwy-end', label: atB, rot: (hdg + 180) % 360 } });
        }
      }
    }
  }
  return { type: 'FeatureCollection', features };
}

/** Ask each OpenStreetMap server in turn (20 s each) until one answers. */
async function fetchOverpass(q: string): Promise<{ elements?: OsmEl[] }> {
  let last = '';
  for (const url of OVERPASS_MIRRORS) {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), signal: ctrl.signal });
      if (!r.ok) {
        last = r.status === 429 || r.status === 504 ? 'chart servers are busy' : `chart server error ${r.status}`;
        continue;
      }
      const j = (await r.json()) as { elements?: OsmEl[]; remark?: string };
      if (!j.elements?.length && j.remark) {
        last = 'chart server timed out';
        continue;
      }
      return j;
    } catch (e) {
      last = (e as Error).name === 'AbortError' ? 'chart server timed out' : 'could not reach the chart servers';
    } finally {
      window.clearTimeout(timer);
    }
  }
  throw new Error(`Ground chart unavailable: ${last}. Try again in a minute.`);
}

const failedAt = new Map<string, number>();
/** Errors may be retried automatically after a short pause (used when zooming in). */
export const canRetry = (icao: string) => Date.now() - (failedAt.get(icao) ?? 0) > 90000;

export function loadChart(icao: string): Promise<ChartState> {
  const hit = cache.get(icao);
  if (hit && hit.status !== 'error') return Promise.resolve(hit);
  const p = pending.get(icao);
  if (p) return p;
  const ap = getAirport(icao);
  if (!ap) return Promise.resolve({ status: 'error', error: 'Unknown airport' });
  const dLat = ap.size === 3 ? 0.055 : 0.03;
  const dLon = dLat / Math.max(0.2, Math.cos((ap.lat * Math.PI) / 180));
  const bbox = `${ap.lat - dLat},${ap.lon - dLon},${ap.lat + dLat},${ap.lon + dLon}`;
  const q = `[out:json][timeout:25];(way["aeroway"~"^(runway|taxiway|taxilane|apron|terminal|hangar|parking_position|holding_position|stopway|gate)$"](${bbox});node["aeroway"~"^(gate|parking_position|holding_position)$"](${bbox}););out geom;`;
  cache.set(icao, { status: 'loading' });
  emit();
  const job = fetchOverpass(q)
    .then(async (j) => {
      const fc = toGeoJSON(j.elements ?? []);
      const count = (k: string) => fc.features.filter((f) => f.properties!.kind === k && f.geometry.type !== 'Polygon').length;
      const st: ChartState = { status: 'ready', fc, counts: { taxiways: new Set(fc.features.filter((f) => f.properties!.kind === 'taxiway' && f.properties!.label).map((f) => f.properties!.label)).size, stands: count('parking_position'), gates: count('gate') } };
      return st;
    })
    .catch((e): ChartState => ({ status: 'error', error: e instanceof Error ? e.message : String(e) }))
    .then((st) => {
      if (st.status === 'error') failedAt.set(icao, Date.now());
      cache.set(icao, st);
      pending.delete(icao);
      emit();
      return st;
    });
  pending.set(icao, job);
  return job;
}

/** Merge every loaded chart into one collection for the map. */
export function allCharts(): FC {
  const features: GeoJSON.Feature[] = [];
  for (const st of cache.values()) if (st.status === 'ready') features.push(...st.fc.features);
  return { type: 'FeatureCollection', features };
}
