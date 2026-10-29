// Airport activity across the network: who's departing, arriving and controlling where.
import { getAirport } from '../data/airports';
import { distanceNm } from './geo';
import type { Controller, Flight } from '../types';

export interface AirportActivity {
  icao: string;
  dep: number; // departing: on the ground there, or climbing out within 150 NM
  arr: number; // inbound (anywhere)
  soon: number; // arriving within ~150 NM
  atc: string[]; // positions online
  score: number;
}

export function airportActivity(flights: Flight[], controllers: Controller[]): AirportActivity[] {
  const m = new Map<string, AirportActivity>();
  const get = (icao: string) => {
    let a = m.get(icao);
    if (!a) m.set(icao, (a = { icao, dep: 0, arr: 0, soon: 0, atc: [], score: 0 }));
    return a;
  };
  for (const f of flights) {
    if (f.dep) {
      const ap = getAirport(f.dep);
      if (ap) {
        const d = distanceNm(f.lat, f.lon, ap.lat, ap.lon);
        if ((f.onGround && d < 8) || (!f.onGround && d < 150)) get(f.dep).dep++;
      }
    }
    if (f.arr) {
      const a = get(f.arr);
      a.arr++;
      const ap = getAirport(f.arr);
      if (ap && !f.onGround && distanceNm(f.lat, f.lon, ap.lat, ap.lon) < 150) a.soon++;
    }
  }
  for (const c of controllers) {
    const icao = c.airport ?? (c.callsign.includes('_') ? c.callsign.split('_')[0] : null);
    if (!icao || !getAirport(icao) || c.position === 'CTR' || c.position === 'FSS') continue;
    const a = get(icao);
    if (!a.atc.includes(c.position)) a.atc.push(c.position);
  }
  const order = ['DEL', 'GND', 'TWR', 'APP', 'DEP'];
  for (const a of m.values()) {
    a.atc.sort((x, y) => order.indexOf(x) - order.indexOf(y));
    a.score = a.dep + a.arr + a.soon * 0.5 + a.atc.length * 1.5;
  }
  return [...m.values()].filter((a) => getAirport(a.icao)).sort((x, y) => y.score - x.score);
}
