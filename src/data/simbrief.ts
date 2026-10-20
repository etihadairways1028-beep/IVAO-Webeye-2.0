import type { NavFix, SimbriefPlan } from '../types';
import { SIMBRIEF_URL, CORS_HINT } from './endpoints';
import { distanceNm } from '../lib/geo';

/* SimBrief's public fetcher returns the latest OFP for a Navigraph/SimBrief
 * username or numeric pilot ID: /api/xml.fetcher.php?username=X&json=1
 * (https://developers.navigraph.com/docs/simbrief/fetching-ofp-data) */

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
  let res: Response;
  try {
    res = await fetch(`${SIMBRIEF_URL}?${param}&json=1`, { signal, cache: 'no-store' });
  } catch {
    throw new Error(`Network error reaching SimBrief${CORS_HINT}`);
  }
  let data: Any;
  try {
    data = await res.json();
  } catch {
    throw new Error(`SimBrief did not return JSON (HTTP ${res.status})`);
  }
  const status = s(data?.fetch?.status);
  if (!res.ok || (status && status.toLowerCase() !== 'success')) throw new Error(status || `SimBrief HTTP ${res.status}`);
  return parseOfp(data);
}

export function parseOfp(data: Any): SimbriefPlan {
  const o = data.origin ?? {};
  const d = data.destination ?? {};
  const fixesRaw: Any[] = Array.isArray(data.navlog?.fix) ? data.navlog.fix : data.navlog?.fix ? [data.navlog.fix] : [];
  const oLat = n(o.pos_lat) ?? 0;
  const oLon = n(o.pos_long) ?? 0;
  const dLat = n(d.pos_lat) ?? 0;
  const dLon = n(d.pos_long) ?? 0;

  // Cumulative distance is recomputed geometrically so it lines up exactly with
  // the drawn route (used for live progress along the plan).
  let cum = 0;
  let prev: [number, number] = [oLat, oLon];
  const fixes: NavFix[] = [];
  for (const f of fixesRaw) {
    const lat = n(f.pos_lat);
    const lon = n(f.pos_long);
    if (lat == null || lon == null) continue;
    cum += distanceNm(prev[0], prev[1], lat, lon);
    prev = [lat, lon];
    const wd = n(f.wind_dir);
    const ws = n(f.wind_spd);
    fixes.push({
      ident: s(f.ident),
      name: s(f.name),
      type: s(f.type),
      airway: s(f.via_airway),
      lat,
      lon,
      alt: n(f.altitude_feet),
      wind: wd != null && ws != null ? `${String(Math.round(wd)).padStart(3, '0')}/${Math.round(ws)}` : null,
      oat: n(f.oat),
      ias: n(f.ind_airspeed),
      tas: n(f.true_airspeed),
      gs: n(f.groundspeed),
      track: n(f.track_true),
      legNm: n(f.distance),
      cumNm: cum,
      legSec: n(f.time_leg),
      cumSec: n(f.time_total),
      fuelOnboard: n(f.fuel_plan_onboard),
      fuelUsed: n(f.fuel_totalused),
      freq: s(f.frequency) || null,
    });
  }
  const last = fixes[fixes.length - 1];
  const totalNm = last && last.type === 'apt' ? cum : cum + distanceNm(prev[0], prev[1], dLat, dLon);

  const airline = s(data.general?.icao_airline);
  const fltnum = s(data.general?.flight_number);
  const pdfDir = s(data.files?.directory);
  const pdfLink = s(data.files?.pdf?.link);
  return {
    callsign: s(data.atc?.callsign) || `${airline}${fltnum}`,
    flightNumber: `${airline}${fltnum}`,
    origin: { icao: s(o.icao_code), iata: s(o.iata_code), name: s(o.name), lat: oLat, lon: oLon, rwy: s(o.plan_rwy) || null, elev: n(o.elevation), metar: s(data.weather?.orig_metar) || null },
    destination: { icao: s(d.icao_code), iata: s(d.iata_code), name: s(d.name), lat: dLat, lon: dLon, rwy: s(d.plan_rwy) || null, elev: n(d.elevation), metar: s(data.weather?.dest_metar) || null },
    alternate: s(data.alternate?.icao_code) || null,
    aircraft: s(data.aircraft?.icaocode) || s(data.aircraft?.icao_code),
    aircraftName: s(data.aircraft?.name) || null,
    registration: s(data.aircraft?.reg) || null,
    route: s(data.general?.route),
    cruise: s(data.general?.initial_altitude),
    stepClimbs: s(data.general?.stepclimb_string) || null,
    costIndex: s(data.general?.costindex) || null,
    avgWind: n(data.general?.avg_wind_comp) != null ? `${n(data.general.avg_wind_comp)! >= 0 ? '+' : ''}${n(data.general.avg_wind_comp)} kt` : null,
    distanceNm: n(data.general?.route_distance) ?? n(data.general?.air_distance),
    airTime: n(data.times?.est_time_enroute),
    blockTime: n(data.times?.est_block),
    schedOut: n(data.times?.sched_out),
    schedIn: n(data.times?.sched_in),
    estOff: n(data.times?.est_off),
    estOn: n(data.times?.est_on),
    fuel: { block: n(data.fuel?.plan_ramp), trip: n(data.fuel?.est_burn), reserve: n(data.fuel?.reserve), alternate: n(data.fuel?.alternate_burn), taxi: n(data.fuel?.taxi), extra: n(data.fuel?.extra) },
    weights: { zfw: n(data.weights?.est_zfw), tow: n(data.weights?.est_tow), ldw: n(data.weights?.est_ldw), pax: n(data.weights?.pax_count), payload: n(data.weights?.payload) },
    units: s(data.params?.units) || null,
    fixes,
    totalNm,
    pdfUrl: pdfDir && pdfLink ? `${pdfDir}${pdfLink}` : null,
    generatedAt: n(data.params?.time_generated),
  };
}

/** Polyline of the plan: origin → navlog fixes → destination, as [lat, lon]. */
export function planPoints(p: SimbriefPlan): { lat: number; lon: number; cum: number }[] {
  const pts = [{ lat: p.origin.lat, lon: p.origin.lon, cum: 0 }, ...p.fixes.map((f) => ({ lat: f.lat, lon: f.lon, cum: f.cumNm }))];
  const last = pts[pts.length - 1];
  if (distanceNm(last.lat, last.lon, p.destination.lat, p.destination.lon) > 0.5) pts.push({ lat: p.destination.lat, lon: p.destination.lon, cum: p.totalNm });
  return pts;
}

/**
 * Project an aircraft position onto the planned route.
 * Returns distance flown along the plan and the cross-track offset (both NM).
 * Uses a local equirectangular projection per leg — accurate to well under 1%
 * for navlog leg lengths.
 */
export function progressAlong(p: SimbriefPlan, lat: number, lon: number): { alongNm: number; xtkNm: number; legIndex: number } {
  const pts = planPoints(p);
  let best = { alongNm: 0, xtkNm: Infinity, legIndex: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const k = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
    let dLon = b.lon - a.lon;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    let pLon = lon - a.lon;
    if (pLon > 180) pLon -= 360;
    if (pLon < -180) pLon += 360;
    const bx = dLon * k, by = b.lat - a.lat;
    const px = pLon * k, py = lat - a.lat;
    const len2 = bx * bx + by * by;
    const t = len2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
    const dx = px - t * bx, dy = py - t * by;
    const xtk = Math.sqrt(dx * dx + dy * dy) * 60;
    if (xtk < best.xtkNm) best = { alongNm: a.cum + t * (b.cum - a.cum), xtkNm: xtk, legIndex: i };
  }
  return best;
}
