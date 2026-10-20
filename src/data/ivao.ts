import type { AtcPosition, Controller, Counts, Flight, RawAtc, RawLastTrack, RawPilot, RawWhazzup, WakeCat } from '../types';
import { getAirport } from './airports';

import { CORS_HINT, IVAO_BASE, WHAZZUP_URL } from './endpoints';
export { WHAZZUP_URL };

/** IVAO refreshes Whazzup every 15 s; polling faster only wastes their bandwidth. */
export const MIN_POLL_SECONDS = 15;

export async function fetchWhazzup(signal: AbortSignal): Promise<RawWhazzup> {
  let res: Response;
  try {
    res = await fetch(WHAZZUP_URL, { signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new Error(`Network error reaching IVAO${CORS_HINT}`);
  }
  if (!res.ok) throw new Error(`IVAO Whazzup responded HTTP ${res.status}`);
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('json')) throw new Error('IVAO Whazzup did not return JSON (is the /proxy route configured?)');
  const data = (await res.json()) as RawWhazzup;
  if (!data || typeof data !== 'object' || !data.clients) throw new Error('Unexpected Whazzup payload');
  return data;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function wake(w: unknown): WakeCat {
  const s = typeof w === 'string' ? w.toUpperCase() : '';
  return s === 'L' || s === 'M' || s === 'H' || s === 'J' ? s : '?';
}

function registrationFrom(remarks: string | null): string | null {
  if (!remarks) return null;
  const m = /\bREG\/([A-Z0-9-]{3,10})\b/i.exec(remarks);
  return m ? m[1].toUpperCase() : null;
}

function connectedAt(createdAt: unknown, time: unknown): string | null {
  const c = str(createdAt);
  if (c) return c;
  const t = num(time); // seconds online
  return t != null ? new Date(Date.now() - t * 1000).toISOString() : null;
}

export function normalizePilot(p: RawPilot, prev?: Flight): Flight | null {
  const t = p.lastTrack;
  const lat = num(t?.latitude);
  const lon = num(t?.longitude);
  if (lat == null || lon == null || !p.callsign) return null;
  const fp = p.flightPlan ?? null;
  const alt = num(t?.altitude);
  const trackTime = str(t?.timestamp);

  // Vertical speed is not in the public feed: derive it from two consecutive
  // position reports and keep the previous value when no new report arrived.
  let vs: number | null = prev?.verticalSpeed ?? null;
  if (prev && alt != null && prev.altitude != null && trackTime && prev.trackTime && trackTime !== prev.trackTime) {
    const dtMin = (new Date(trackTime).getTime() - new Date(prev.trackTime).getTime()) / 60000;
    vs = dtMin > 0.05 && dtMin < 5 ? (alt - prev.altitude) / dtMin : null;
  }
  if (t?.onGround) vs = 0;
  const remarks = str(fp?.remarks);

  return {
    key: `p${p.id}`,
    sessionId: p.id,
    vid: p.userId,
    callsign: p.callsign.toUpperCase(),
    lat,
    lon,
    altitude: alt,
    groundSpeed: num(t?.groundSpeed),
    heading: num(t?.heading),
    verticalSpeed: vs,
    onGround: !!t?.onGround,
    state: str(t?.state),
    transponder: num(t?.transponder) != null ? String(t!.transponder).padStart(4, '0') : null,
    trackTime,
    arrivalDistance: num(t?.arrivalDistance),
    departureDistance: num(t?.departureDistance),
    connectedAt: connectedAt(p.createdAt, p.time),
    server: str(p.serverId),
    simulator: str(p.pilotSession?.simulatorId),
    software: [str(p.softwareTypeId), str(p.softwareVersion)].filter(Boolean).join(' ') || null,
    rating: num(p.rating),
    dep: str(fp?.departureId)?.toUpperCase() ?? null,
    arr: str(fp?.arrivalId)?.toUpperCase() ?? null,
    alt: str(fp?.alternativeId)?.toUpperCase() ?? null,
    aircraft: str(fp?.aircraft?.icaoCode) ?? str(fp?.aircraftId),
    aircraftModel: str(fp?.aircraft?.model),
    wake: wake(fp?.aircraft?.wakeTurbulence),
    military: !!fp?.aircraft?.isMilitary,
    registration: registrationFrom(remarks),
    rules: str(fp?.flightRules),
    flightType: str(fp?.flightType),
    route: str(fp?.route),
    remarks,
    cruiseLevel: str(fp?.level),
    cruiseSpeed: str(fp?.speed),
    pob: num(fp?.peopleOnBoard),
    eet: num(fp?.eet),
    demo: false,
  };
}

const POSITIONS: AtcPosition[] = ['DEL', 'GND', 'TWR', 'APP', 'DEP', 'CTR', 'FSS', 'RMP'];

export function positionOf(callsign: string, reported?: string | null): AtcPosition {
  const r = (reported ?? '').toUpperCase();
  if ((POSITIONS as string[]).includes(r)) return r as AtcPosition;
  const suffix = callsign.toUpperCase().split('_').pop() ?? '';
  return (POSITIONS as string[]).includes(suffix) ? (suffix as AtcPosition) : 'OTHER';
}

export function normalizeAtc(a: RawAtc): Controller | null {
  if (!a.callsign) return null;
  const callsign = a.callsign.toUpperCase();
  const position = positionOf(callsign, a.atcSession?.position);
  const prefix = callsign.split('_')[0];
  const ap = /^[A-Z]{4}$/.test(prefix) ? getAirport(prefix) : null;
  let lat = num(a.lastTrack?.latitude);
  let lon = num(a.lastTrack?.longitude);
  let locationSource: Controller['locationSource'] = lat != null && lon != null ? 'feed' : null;
  if (locationSource == null && ap && position !== 'CTR' && position !== 'FSS') {
    lat = ap.lat;
    lon = ap.lon;
    locationSource = 'airport';
  }
  return {
    key: `a${a.id}`,
    sessionId: a.id,
    vid: a.userId,
    callsign,
    position,
    frequency: num(a.atcSession?.frequency),
    lat,
    lon,
    locationSource,
    airport: ap?.icao ?? null,
    atis: Array.isArray(a.atis?.lines) ? a.atis!.lines!.filter((l) => typeof l === 'string') : [],
    atisTime: str(a.atis?.timestamp),
    connectedAt: connectedAt(a.createdAt, a.time),
    rating: num(a.rating),
    demo: false,
  };
}

export function normalizeWhazzup(raw: RawWhazzup, prev: Map<string, Flight>): { flights: Flight[]; controllers: Controller[]; counts: Counts; updatedAt: string | null } {
  const flights: Flight[] = [];
  for (const p of raw.clients?.pilots ?? []) {
    try {
      const f = normalizePilot(p, prev.get(`p${p.id}`));
      if (f) flights.push(f);
    } catch {
      /* skip malformed record */
    }
  }
  const controllers: Controller[] = [];
  for (const a of raw.clients?.atcs ?? []) {
    try {
      const c = normalizeAtc(a);
      if (c) controllers.push(c);
    } catch {
      /* skip malformed record */
    }
  }
  const c = raw.connections ?? {};
  return {
    flights,
    controllers,
    updatedAt: str(raw.updatedAt),
    counts: {
      pilots: num(c.pilot) ?? raw.clients?.pilots?.length ?? null,
      atc: num(c.atc) ?? raw.clients?.atcs?.length ?? null,
      observers: num(c.observer) ?? raw.clients?.observers?.length ?? null,
      total: num(c.total),
      uniqueUsers24h: num(c.uniqueUsers24h),
    },
  };
}

export interface TrackPoint {
  lat: number;
  lon: number;
  alt: number | null;
  gs: number | null;
  onGround: boolean;
  t: string | null;
}

/**
 * Full position history of a pilot session (from connection, i.e. from the gate):
 * GET /v2/tracker/sessions/{sessionId}/tracks — part of IVAO's public tracker API.
 */
export async function fetchSessionTrack(sessionId: number, signal?: AbortSignal): Promise<TrackPoint[]> {
  const res = await fetch(`${IVAO_BASE}/v2/tracker/sessions/${sessionId}/tracks`, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`IVAO tracks HTTP ${res.status}`);
  const arr = (await res.json()) as RawLastTrack[];
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((p) => typeof p.latitude === 'number' && typeof p.longitude === 'number')
    .map((p) => ({ lat: p.latitude!, lon: p.longitude!, alt: num(p.altitude), gs: num(p.groundSpeed), onGround: !!p.onGround, t: str(p.timestamp) }))
    .sort((a, b) => (a.t && b.t ? a.t.localeCompare(b.t) : 0));
}
