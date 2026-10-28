// Automatic flight log, kept by the Pulse recorder for every IVAO pilot (no sign-in):
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
  /** Exact touchdown from the Pulse Link sim add-on. */
  touchdown?: { fpm: number; g: number | null; ias: number | null; pitch: number | null; bank: number | null; fuelUsedKg: number | null; bounces: number; sim: string } | null;
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
  atcMinutes?: number;
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
export function landingRate(f: LoggedFlight): { fpm: number; source: 'sim' | 'seen' | 'est' } | null {
  if (f.touchdown) return { fpm: f.touchdown.fpm, source: 'sim' };
  if (f.seenFpm != null) return { fpm: f.seenFpm, source: 'seen' };
  if (f.descentFpm != null) return { fpm: f.descentFpm, source: 'est' };
  return null;
}

export interface LeaderRow {
  vid: number;
  callsign: string;
  minutes?: number;
  flights?: number;
  fpm?: number;
}
export interface Leaderboard {
  week: number;
  from: string;
  hours: LeaderRow[];
  flights: LeaderRow[];
  landings: LeaderRow[];
  atc: LeaderRow[];
}
export async function fetchLeaderboard(which: 'this' | 'last', signal?: AbortSignal): Promise<Leaderboard> {
  const r = await fetch(`${RECORDER_URL}/leaderboard${which === 'last' ? '?week=last' : ''}`, { signal });
  if (!r.ok) throw new Error(`The leaderboard service answered HTTP ${r.status}`);
  return (await r.json()) as Leaderboard;
}

export const LINK_EXE = 'https://github.com/etihadairways1028-beep/IVAO-Webeye-2.0/releases/download/webeye-link/PulseLink.exe';
export const LINK_PY = 'https://github.com/etihadairways1028-beep/IVAO-Webeye-2.0/releases/download/webeye-link/webeye_link.py';

export interface Badge {
  id: string;
  name: string;
  desc: string;
  earned: boolean;
  progress?: string;
}
/** Achievements worked out from a pilot's logbook. */
export function badges(flights: LoggedFlight[], atcMinutes = 0): Badge[] {
  const n = flights.length;
  const hours = flights.reduce((a, f) => a + f.airborneMin, 0) / 60;
  const apts = new Set(flights.flatMap((f) => [f.dep, f.arr]).filter(Boolean));
  const days = new Set(flights.map((f) => new Date(f.landed).toISOString().slice(0, 10)));
  const best = Math.min(...flights.map((f) => (f.touchdown ? Math.abs(f.touchdown.fpm) : 9999)));
  const longest = Math.max(0, ...flights.map((f) => f.airborneMin));
  const far = Math.max(0, ...flights.map((f) => f.distanceNm));
  const b = (id: string, name: string, desc: string, earned: boolean, progress?: string): Badge => ({ id, name, desc, earned, progress: earned ? undefined : progress });
  return [
    b('first', 'First flight', 'Log your first flight', n >= 1, `${n}/1`),
    b('ten', '10 landings', 'Log 10 flights', n >= 10, `${n}/10`),
    b('fifty', '50 landings', 'Log 50 flights', n >= 50, `${n}/50`),
    b('hundred', 'Centurion', 'Log 100 flights', n >= 100, `${n}/100`),
    b('h10', '10 hours', 'Fly 10 hours', hours >= 10, `${hours.toFixed(1)}/10 h`),
    b('h100', '100 hours', 'Fly 100 hours', hours >= 100, `${hours.toFixed(0)}/100 h`),
    b('butter', 'Butter', 'Land softer than 150 fpm (Pulse Link)', best < 150, best < 9999 ? `best ${best} fpm` : 'needs Pulse Link'),
    b('longhaul', 'Long haul', 'One flight of 6 hours or more', longest >= 360, `longest ${Math.floor(longest / 60)}:${String(longest % 60).padStart(2, '0')}`),
    b('far', 'Ocean crosser', 'One flight of 2,500 NM or more', far >= 2500, `longest ${far} NM`),
    b('globe', 'Globetrotter', 'Visit 25 airports', apts.size >= 25, `${apts.size}/25`),
    b('streak', 'Regular', 'Fly on 7 different days', days.size >= 7, `${days.size}/7 days`),
    b('atc', 'Controller', 'Control for 10 hours on IVAO', atcMinutes >= 600, `${(atcMinutes / 60).toFixed(1)}/10 h`),
  ];
}
