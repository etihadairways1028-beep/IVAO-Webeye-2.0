// Automatic flight log, kept by the WebEye recorder for every IVAO pilot (no sign-in):
// a flight is logged when the aircraft takes off and lands again while connected.
import { RECORDER_URL } from './endpoints';
import { seenLandings } from './feed';

export interface LoggedFlight {
  callsign: string;
  dep: string | null;
  arr: string | null;
  aircraft: string | null;
  takeoff: number;
  landed: number;
  airborneMin: number;
  distanceNm: number;
  maxAlt: number;
  /** Average descent over the last minute before touchdown (recorder, estimate). */
  descentFpm: number | null;
  /** Vertical speed this browser saw on the last report before touchdown, when the page was open. */
  seenFpm?: number | null;
  route: [number, number, number][];
}
export interface ActiveFlight {
  session: number;
  callsign: string;
  dep: string | null;
  arr: string | null;
  aircraft: string | null;
  takeoff: number;
}
export interface Logbook {
  flights: LoggedFlight[];
  active: ActiveFlight[];
}

export async function fetchLogbook(vid: number, signal?: AbortSignal): Promise<Logbook> {
  const r = await fetch(`${RECORDER_URL}/logbook/${vid}`, { signal });
  if (!r.ok) throw new Error(`The logbook service answered HTTP ${r.status}`);
  const j = (await r.json()) as Logbook;
  const seen = seenLandings();
  for (const f of j.flights) {
    const m = seen.find((l) => l.callsign === f.callsign && Math.abs(l.at - f.landed) < 4 * 60e3);
    if (m) f.seenFpm = m.fpm;
  }
  return j;
}

export interface NetHistory {
  hist: { t: string; pilots: number; atc: number }[];
}
export async function fetchNetHistory(signal?: AbortSignal): Promise<NetHistory> {
  const r = await fetch(`${RECORDER_URL}/stats`, { signal });
  if (!r.ok) throw new Error(`The stats service answered HTTP ${r.status}`);
  return (await r.json()) as NetHistory;
}

/** Touchdown descent to show: what this browser saw if available, else the recorder estimate. */
export function landingRate(f: LoggedFlight): { fpm: number; source: 'seen' | 'est' } | null {
  if (f.seenFpm != null) return { fpm: f.seenFpm, source: 'seen' };
  if (f.descentFpm != null) return { fpm: f.descentFpm, source: 'est' };
  return null;
}
