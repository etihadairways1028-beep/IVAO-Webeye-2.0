/**
 * Flight Information Region (FIR) and upper-airspace boundaries.
 *
 * Geometry and the callsign index come from the VATSpy Data Project
 * (github.com/vatsimnetwork/vatspy-data-project), licensed CC BY-SA 4.0, simplified for
 * the web. Boundary ids are ICAO FIR codes, so they also match IVAO centre callsigns
 * such as EGTT_CTR or LFFF_N_CTR. The bundled files keep that licence.
 */
export interface FirEntry {
  n: string; // display name
  b: string[]; // boundary ids
}

type FirIndex = Record<string, FirEntry>;

let index: FirIndex | null = null;
let shapes: GeoJSON.FeatureCollection | null = null;
let loading: Promise<void> | null = null;
const labelPoint = new Map<string, [number, number]>();

export function loadFirs(): Promise<void> {
  if (!loading) {
    const base = import.meta.env.BASE_URL;
    loading = Promise.all([
      fetch(`${base}data/firs.geojson`).then((r) => {
        if (!r.ok) throw new Error(`firs.geojson HTTP ${r.status}`);
        return r.json() as Promise<GeoJSON.FeatureCollection>;
      }),
      fetch(`${base}data/firs-index.json`).then((r) => {
        if (!r.ok) throw new Error(`firs-index.json HTTP ${r.status}`);
        return r.json() as Promise<FirIndex>;
      }),
    ])
      .then(([g, i]) => {
        shapes = g;
        index = i;
        for (const f of g.features) {
          const p = f.properties as { id: string; lx: number; ly: number };
          labelPoint.set(p.id, [p.lx, p.ly]);
        }
      })
      .catch((e) => {
        loading = null;
        throw e;
      });
  }
  return loading;
}

export const firShapes = () => shapes;
export const firsReady = () => index != null;

/**
 * Airspace for an en-route callsign (CTR or FSS): EDGG_N_CTR tries EDGG_N, then EDGG.
 * Returns null for anything that is not an area station or has no known boundary.
 */
export function firForCallsign(callsign: string): (FirEntry & { label: [number, number] | null }) | null {
  if (!index) return null;
  const cs = callsign.toUpperCase();
  if (!/_(CTR|FSS)$/.test(cs)) return null;
  const parts = cs.replace(/_(CTR|FSS)$/, '').split(/[_-]/);
  for (let n = parts.length; n >= 1; n--) {
    const k = parts.slice(0, n).join('_');
    const e = index[k] ?? index[parts.slice(0, n).join('-')];
    if (e?.b.length) return { ...e, label: labelPoint.get(e.b[0]) ?? null };
  }
  return null;
}

/** Bounding box of a set of boundaries, for framing the camera on a centre's airspace. */
export function firBounds(ids: string[]): [[number, number], [number, number]] | null {
  if (!shapes) return null;
  let w = 180, s = 90, e = -180, n = -90;
  const visit = (c: unknown): void => {
    if (typeof (c as number[])[0] === 'number') {
      const [lo, la] = c as [number, number];
      w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); n = Math.max(n, la);
    } else (c as unknown[]).forEach(visit);
  };
  for (const f of shapes.features) {
    if (!ids.includes((f.properties as { id: string }).id)) continue;
    visit((f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon).coordinates);
  }
  return w <= e && e - w < 180 ? [[w, s], [e, n]] : null;
}
