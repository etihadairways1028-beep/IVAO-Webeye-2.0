// Airport ground charts from OpenStreetMap (© OpenStreetMap contributors, ODbL)
// via the public Overpass API: runways, taxiways (with names), aprons, terminals,
// parking stands, gates and holding points. Fetched once per airport and cached.
import { OVERPASS_URL, CORS_HINT } from './endpoints';
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
        features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { kind, label } });
      }
    }
  }
  return { type: 'FeatureCollection', features };
}

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
  const job = fetch(OVERPASS_URL, { method: 'POST', body: new URLSearchParams({ data: q }) })
    .then(async (r) => {
      if (!r.ok) throw new Error(r.status === 429 ? 'OpenStreetMap server busy — try again shortly' : `Overpass HTTP ${r.status}`);
      const j = (await r.json()) as { elements?: OsmEl[] };
      const fc = toGeoJSON(j.elements ?? []);
      const count = (k: string) => fc.features.filter((f) => f.properties!.kind === k && f.geometry.type !== 'Polygon').length;
      const st: ChartState = { status: 'ready', fc, counts: { taxiways: new Set(fc.features.filter((f) => f.properties!.kind === 'taxiway' && f.properties!.label).map((f) => f.properties!.label)).size, stands: count('parking_position'), gates: count('gate') } };
      return st;
    })
    .catch((e): ChartState => ({ status: 'error', error: e instanceof TypeError ? `Network error reaching OpenStreetMap${CORS_HINT}` : e instanceof Error ? e.message : String(e) }))
    .then((st) => {
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
