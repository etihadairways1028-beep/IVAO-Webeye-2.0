import type { SimbriefPlan } from '../types';

export const SIMBRIEF_URL: string = import.meta.env.VITE_SIMBRIEF_URL || '/proxy/simbrief/api/xml.fetcher.php';

/* SimBrief's public fetcher returns the latest OFP for a Navigraph/SimBrief
 * username or numeric pilot ID: /api/xml.fetcher.php?username=X&json=1
 * (documented at https://developers.navigraph.com/docs/simbrief/fetching-ofp-data) */

const n = (v: unknown): number | null => {
  const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(x) ? x : null;
};
const s = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export async function fetchSimbrief(user: string, signal?: AbortSignal): Promise<SimbriefPlan> {
  const id = user.trim();
  if (!id) throw new Error('Enter your SimBrief username or pilot ID');
  const param = /^\d+$/.test(id) ? `userid=${encodeURIComponent(id)}` : `username=${encodeURIComponent(id)}`;
  const res = await fetch(`${SIMBRIEF_URL}?${param}&json=1`, { signal, cache: 'no-store' });
  let data: Any;
  try {
    data = await res.json();
  } catch {
    throw new Error(`SimBrief did not return JSON (HTTP ${res.status}). Is the /proxy route configured?`);
  }
  const status = s(data?.fetch?.status);
  if (!res.ok || (status && status.toLowerCase() !== 'success')) throw new Error(status || `SimBrief HTTP ${res.status}`);

  const o = data.origin ?? {};
  const d = data.destination ?? {};
  const fixesRaw: Any[] = Array.isArray(data.navlog?.fix) ? data.navlog.fix : data.navlog?.fix ? [data.navlog.fix] : [];
  const fixes = fixesRaw
    .map((f) => ({ ident: s(f.ident), lat: n(f.pos_lat), lon: n(f.pos_long), type: s(f.type), alt: n(f.altitude_feet) }))
    .filter((f): f is { ident: string; lat: number; lon: number; type: string; alt: number | null } => f.lat != null && f.lon != null);

  const airline = s(data.general?.icao_airline);
  const fltnum = s(data.general?.flight_number);
  return {
    callsign: s(data.atc?.callsign) || `${airline}${fltnum}`,
    flightNumber: `${airline}${fltnum}`,
    origin: { icao: s(o.icao_code), name: s(o.name), lat: n(o.pos_lat) ?? 0, lon: n(o.pos_long) ?? 0, rwy: s(o.plan_rwy) || null },
    destination: { icao: s(d.icao_code), name: s(d.name), lat: n(d.pos_lat) ?? 0, lon: n(d.pos_long) ?? 0, rwy: s(d.plan_rwy) || null },
    alternate: s(data.alternate?.icao_code) || null,
    aircraft: s(data.aircraft?.icaocode) || s(data.aircraft?.icao_code),
    registration: s(data.aircraft?.reg) || null,
    route: s(data.general?.route),
    cruise: s(data.general?.initial_altitude),
    costIndex: s(data.general?.costindex) || null,
    distanceNm: n(data.general?.route_distance) ?? n(data.general?.air_distance),
    airTime: n(data.times?.est_time_enroute),
    schedOut: n(data.times?.sched_out),
    schedIn: n(data.times?.sched_in),
    fuelBlock: s(data.fuel?.plan_ramp) || null,
    units: s(data.params?.units) || null,
    fixes,
    generatedAt: n(data.params?.time_generated),
  };
}
