// DEMONSTRATION TRAFFIC — synthetic, clearly flagged (`demo: true`) and never
// mixed with live IVAO records. Positions are computed along great circles
// between real airports so the map, search and panels can be exercised offline.
import type { Controller, Counts, Flight, WakeCat } from '../types';
import { allAirports, getAirport } from './airports';
import { bearing, destination, distanceNm } from '../lib/geo';

const HUBS = ['OMDB', 'OMAA', 'OTHH', 'OERK', 'OEJN', 'OBBI', 'OOMS', 'EGLL', 'EGKK', 'EHAM', 'EDDF', 'EDDM', 'LFPG', 'LEMD', 'LEBL', 'LIRF', 'LSZH', 'LOWW', 'LTFM', 'LGAV', 'EKCH', 'ESSA', 'EIDW', 'EPWA', 'LPPT', 'KJFK', 'KLAX', 'KORD', 'KATL', 'KSFO', 'KDFW', 'KMIA', 'CYYZ', 'CYVR', 'SBGR', 'SAEZ', 'MMMX', 'VIDP', 'VABB', 'VHHH', 'WSSS', 'RJTT', 'RKSI', 'ZBAA', 'YSSY', 'YMML', 'NZAA', 'FAOR', 'HECA', 'GMMN', 'DNMM', 'HKJK', 'LLBG', 'OJAI', 'VTBS', 'WMKK', 'RPLL'];
const AIRLINES: [string, string[], WakeCat?][] = [
  ['UAE', ['A388', 'B77W'], 'H'], ['ETD', ['B789', 'A35K'], 'H'], ['QTR', ['A359', 'B77W'], 'H'], ['FDB', ['B38M', 'B738'], 'M'],
  ['BAW', ['A320', 'B772', 'A35K'], 'M'], ['DLH', ['A321', 'A346', 'B748'], 'M'], ['AFR', ['A320', 'B77W'], 'M'], ['KLM', ['B738', 'B789'], 'M'],
  ['THY', ['A321', 'B77W'], 'M'], ['RYR', ['B738'], 'M'], ['EZY', ['A320'], 'M'], ['IBE', ['A320', 'A359'], 'M'], ['SWR', ['A320', 'A333'], 'M'],
  ['AAL', ['B738', 'B772'], 'M'], ['DAL', ['A321', 'A359'], 'M'], ['UAL', ['B739', 'B789'], 'M'], ['SIA', ['A359', 'A388'], 'H'],
  ['CPA', ['A35K', 'B77W'], 'H'], ['QFA', ['B789', 'A388'], 'H'], ['AIC', ['A320', 'B77W'], 'M'], ['SVA', ['A320', 'B789'], 'M'],
];
const GA = ['C172', 'PA28', 'DA40', 'C208', 'TBM9', 'SR22'];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface DemoPlan {
  key: string; callsign: string; dep: string; arr: string; type: string; wake: WakeCat; cruise: number; speed: number;
  total: number; offset: number; ga: boolean; vid: number;
}

let plans: DemoPlan[] | null = null;
const T0 = Date.UTC(2026, 0, 1) / 1000;

function buildPlans(): DemoPlan[] {
  const r = rng(20261020);
  const hubs = HUBS.map(getAirport).filter((a): a is NonNullable<typeof a> => !!a);
  const smalls = allAirports().filter((a) => a.size === 2 && /^(E|L|K|O)/.test(a.icao));
  const out: DemoPlan[] = [];
  let tries = 0;
  while (out.length < 320 && tries++ < 5000) {
    const a = hubs[Math.floor(r() * hubs.length)];
    const b = hubs[Math.floor(r() * hubs.length)];
    if (a === b) continue;
    const d = distanceNm(a.lat, a.lon, b.lat, b.lon);
    if (d < 250 || d > 7500) continue;
    const [code, types] = AIRLINES[Math.floor(r() * AIRLINES.length)];
    const long = d > 2500;
    const pool = types.filter((t) => (long ? /^(A35|A33|A34|A38|B77|B78|B74)/.test(t) : !/^(A38|B74)/.test(t)));
    if (!pool.length) continue;
    const type = pool[Math.floor(r() * pool.length)];
    out.push({
      key: `demo-${out.length}`, callsign: `${code}${Math.floor(100 + r() * 899)}`, dep: a.icao, arr: b.icao, type,
      wake: type === 'A388' ? 'J' : /^(A35|A33|A34|B77|B78|B74)/.test(type) ? 'H' : 'M', cruise: long ? 35000 + Math.floor(r() * 6) * 1000 : 30000 + Math.floor(r() * 9) * 1000,
      speed: long ? 485 : 450, total: d, offset: r(), ga: false, vid: 900000 + out.length,
    });
  }
  for (let i = 0; i < 60 && smalls.length > 1; i++) {
    const a = smalls[Math.floor(r() * smalls.length)];
    const near = smalls.filter((s) => s !== a && distanceNm(a.lat, a.lon, s.lat, s.lon) < 220 && distanceNm(a.lat, a.lon, s.lat, s.lon) > 40);
    const b = near[Math.floor(r() * near.length)];
    if (!b) continue;
    out.push({
      key: `demo-ga-${i}`, callsign: `N${Math.floor(100 + r() * 899)}${'ABCDEFGHJK'[Math.floor(r() * 10)]}${'LMNPRSTWXY'[Math.floor(r() * 10)]}`, dep: a.icao, arr: b.icao,
      type: GA[Math.floor(r() * GA.length)], wake: 'L', cruise: 4500 + Math.floor(r() * 6) * 1000, speed: 120, total: distanceNm(a.lat, a.lon, b.lat, b.lon),
      offset: r(), ga: true, vid: 950000 + i,
    });
  }
  return out;
}

export function demoTraffic(nowMs = Date.now()): { flights: Flight[]; controllers: Controller[]; counts: Counts } {
  if (!plans) plans = buildPlans();
  const now = nowMs / 1000 - T0;
  const flights: Flight[] = [];
  for (const p of plans) {
    const a = getAirport(p.dep)!;
    const b = getAirport(p.arr)!;
    const flightSec = (p.total / p.speed) * 3600;
    const cycle = flightSec + 2400; // 40 minutes on the ground between legs
    const t = (now + p.offset * cycle) % cycle;
    let lat: number, lon: number, alt: number, gs: number, hdg: number, onGround = false, state: string, vs = 0;
    if (t > flightSec) {
      [lat, lon] = [b.lat, b.lon];
      alt = b.elevation ?? 0; gs = 0; hdg = bearing(a.lat, a.lon, b.lat, b.lon); onGround = true; state = 'On Blocks';
    } else {
      const flown = (t / flightSec) * p.total;
      const brg = bearing(a.lat, a.lon, b.lat, b.lon);
      // Walk along the great circle using the course from the departure point.
      [lat, lon] = destination(a.lat, a.lon, brg, flown);
      const ahead = destination(a.lat, a.lon, brg, Math.min(p.total, flown + 5));
      hdg = bearing(lat, lon, ahead[0], ahead[1]);
      const toGo = p.total - flown;
      const climb = p.ga ? 25 : 120;
      const desc = p.ga ? 25 : 130;
      if (flown < climb) { alt = (flown / climb) * p.cruise; vs = p.ga ? 600 : 2200; state = 'Initial Climb'; }
      else if (toGo < desc) { alt = (toGo / desc) * p.cruise; vs = p.ga ? -500 : -1800; state = toGo < 30 ? 'Approach' : 'Descending'; }
      else { alt = p.cruise; state = 'En Route'; }
      gs = alt < 10000 ? Math.min(p.speed, 250) : p.speed;
    }
    flights.push({
      key: p.key, sessionId: -1, vid: p.vid, callsign: p.callsign, lat, lon, altitude: Math.round(alt), groundSpeed: Math.round(gs), heading: Math.round(hdg),
      verticalSpeed: vs, onGround, state, transponder: p.ga ? '7000' : String(2000 + (p.vid % 5000)).padStart(4, '0'), trackTime: new Date(nowMs).toISOString(),
      arrivalDistance: onGround ? 0 : Math.round(distanceNm(lat, lon, b.lat, b.lon)), departureDistance: Math.round(distanceNm(lat, lon, a.lat, a.lon)),
      connectedAt: new Date(nowMs - (t + 1200) * 1000).toISOString(), server: 'DEMO', simulator: 'Demo', software: 'Demo generator', rating: null,
      dep: p.dep, arr: p.arr, alt: null, aircraft: p.type, aircraftModel: null, wake: p.wake, military: false, registration: null,
      rules: p.ga ? 'V' : 'I', flightType: p.ga ? 'G' : 'S', route: p.ga ? 'DCT' : 'DCT (demo — no filed route)', remarks: 'DEMONSTRATION RECORD',
      cruiseLevel: p.ga ? `A${String(p.cruise / 100).padStart(3, '0')}` : `F${p.cruise / 100}`, cruiseSpeed: `N0${p.speed}`, pob: null, eet: Math.round(flightSec), demo: true,
    });
  }
  const controllers: Controller[] = [];
  const atcAirports = ['OMDB', 'OMAA', 'EGLL', 'EHAM', 'EDDF', 'LFPG', 'LEMD', 'LTFM', 'KJFK', 'KLAX', 'VHHH', 'WSSS', 'OTHH', 'OERK', 'SBGR', 'YSSY'];
  atcAirports.forEach((icao, i) => {
    const ap = getAirport(icao);
    if (!ap) return;
    const pos: Controller['position'][] = i % 3 === 0 ? ['TWR', 'APP', 'GND'] : i % 3 === 1 ? ['TWR'] : ['APP', 'DEL'];
    pos.forEach((position, j) => controllers.push({
      key: `demo-atc-${icao}-${position}`, sessionId: -1, vid: 970000 + i * 10 + j, callsign: `${icao}_${position}`, position,
      frequency: position === 'APP' ? 118 + ((i * 7) % 20) * 0.25 + 0.1 : position === 'TWR' ? 118 + ((i * 3) % 18) * 0.05 : 121.6 + j * 0.05,
      lat: ap.lat, lon: ap.lon, locationSource: 'airport', airport: icao,
      atis: position === 'TWR' ? [`${icao}_TWR`, 'DEMONSTRATION STATION — NOT A REAL ATIS', 'Live ATIS text appears here when the IVAO feed is active.'] : [],
      atisTime: null, connectedAt: new Date(nowMs - (1800 + i * 600) * 1000).toISOString(), rating: null, demo: true,
    }));
  });
  return { flights, controllers, counts: { pilots: flights.length, atc: controllers.length, observers: null, total: null, uniqueUsers24h: null } };
}
