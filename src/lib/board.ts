// Airport board rows (departures / arrivals) worked out from live IVAO positions.
// IVAO has no schedules, so times are estimates from distance and groundspeed.
import type { Airport, Flight } from '../types';
import { distanceNm } from './geo';

export type BoardStatus = 'Boarding' | 'Taxiing' | 'Departed' | 'En route' | 'Approach' | 'Landing' | 'Landed' | 'At gate' | 'Not departed';
export interface BoardRow {
  f: Flight;
  time: number | null; // ms, estimated
  timeKind: 'ETD' | 'ATD' | 'ETA' | 'ATA' | '';
  other: string | null; // the other airport's ICAO
  status: BoardStatus;
  tone: 'ok' | 'go' | 'warn' | 'dim' | 'live';
}

const ORDER_DEP: Record<string, number> = { Taxiing: 0, Boarding: 1, Departed: 2, 'En route': 3 };
const ORDER_ARR: Record<string, number> = { Landing: 0, Approach: 1, 'En route': 2, 'Not departed': 3, Landed: 4, 'At gate': 5 };

export function departures(a: Airport, flights: Flight[], now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  for (const f of flights) {
    if (f.dep !== a.icao) continue;
    const d = distanceNm(f.lat, f.lon, a.lat, a.lon);
    const gs = f.groundSpeed ?? 0;
    if (f.onGround) {
      if (d > 8) continue; // on the ground somewhere else (already arrived)
      out.push({ f, time: null, timeKind: '', other: f.arr, status: gs >= 3 ? 'Taxiing' : 'Boarding', tone: gs >= 3 ? 'go' : 'ok' });
    } else {
      if (d > 250) continue;
      const atd = gs > 60 ? now - (d / gs) * 3600e3 : null;
      out.push({ f, time: atd, timeKind: 'ATD', other: f.arr, status: d < 40 ? 'Departed' : 'En route', tone: 'dim' });
    }
  }
  return out.sort((x, y) => (ORDER_DEP[x.status] ?? 9) - (ORDER_DEP[y.status] ?? 9) || (y.time ?? 0) - (x.time ?? 0) || x.f.callsign.localeCompare(y.f.callsign));
}

export function arrivals(a: Airport, flights: Flight[], now = Date.now()): BoardRow[] {
  const out: BoardRow[] = [];
  for (const f of flights) {
    if (f.arr !== a.icao) continue;
    const d = distanceNm(f.lat, f.lon, a.lat, a.lon);
    const gs = f.groundSpeed ?? 0;
    if (f.onGround) {
      if (d < 8) out.push({ f, time: null, timeKind: '', other: f.dep, status: gs >= 3 ? 'Landed' : 'At gate', tone: gs >= 3 ? 'live' : 'dim' });
      else out.push({ f, time: null, timeKind: '', other: f.dep, status: 'Not departed', tone: 'dim' });
    } else {
      const eta = gs > 60 ? now + (d / gs) * 3600e3 : null;
      const low = (f.altitude ?? 0) - (a.elevation ?? 0) < 3000;
      const status: BoardStatus = d < 12 && low ? 'Landing' : d < 60 ? 'Approach' : 'En route';
      out.push({ f, time: eta, timeKind: 'ETA', other: f.dep, status, tone: status === 'Landing' ? 'live' : status === 'Approach' ? 'go' : 'ok' });
    }
  }
  return out.sort((x, y) => (ORDER_ARR[x.status] ?? 9) - (ORDER_ARR[y.status] ?? 9) || (x.time ?? 9e15) - (y.time ?? 9e15) || x.f.callsign.localeCompare(y.f.callsign));
}

export const hhmmZ = (t: number | null) => (t == null ? '--:--' : new Date(t).toISOString().slice(11, 16));
