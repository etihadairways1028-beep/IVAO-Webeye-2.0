// Traffic alerts for verified controllers: aircraft in your area that are, or within two
// minutes will be, closer than the separation minima. Advisory only: IVAO positions are up
// to ~15 s old and vertical speed is derived from two reports.
import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { getAirport } from '../data/airports';
import { firBounds, firForCallsign } from '../data/firs';
import type { Flight } from '../types';

export interface Conflict {
  id: string;
  a: string; // callsigns
  b: string;
  level: 'now' | 'soon';
  inSec: number; // 0 when already lost
  hNm: number; // horizontal distance at the closest point
  vFt: number; // vertical distance at the closest point
  nowNm: number;
  nowFt: number;
  pa: [number, number];
  pb: [number, number];
}

const AIRPORT_POS = new Set(['DEL', 'GND', 'TWR', 'APP', 'DEP', 'RMP']);
const LOOKAHEAD = 120; // seconds
const STEP = 5;

/** Flat-earth metres around a reference point: plenty accurate over a few dozen miles. */
function project(f: Flight, lat0: number) {
  const k = Math.cos((lat0 * Math.PI) / 180);
  const gs = (f.groundSpeed ?? 0) / 3600; // NM per second
  const h = ((f.heading ?? 0) * Math.PI) / 180;
  return {
    x: f.lon * 60 * k,
    y: f.lat * 60,
    vx: gs * Math.sin(h),
    vy: gs * Math.cos(h),
    z: f.altitude ?? 0,
    vz: (f.verticalSpeed ?? 0) / 60, // ft per second
  };
}

export function findConflicts(flights: Flight[], session: { callsign: string; position: string }): Conflict[] {
  const icao = session.callsign.split('_')[0];
  const ap = getAirport(icao);
  const airportPos = AIRPORT_POS.has(session.position);
  let area: Flight[];
  if (airportPos) {
    if (!ap) return [];
    const r = session.position === 'APP' || session.position === 'DEP' ? 60 : 25;
    const k = Math.cos((ap.lat * Math.PI) / 180);
    area = flights.filter((f) => Math.hypot((f.lon - ap.lon) * 60 * k, (f.lat - ap.lat) * 60) < r);
  } else {
    const fir = firForCallsign(session.callsign);
    const box = fir && firBounds(fir.b);
    if (!box) return [];
    area = flights.filter((f) => f.lon >= box[0][0] && f.lon <= box[1][0] && f.lat >= box[0][1] && f.lat <= box[1][1]);
  }
  const elev = ap?.elevation ?? 0;
  // Airborne only, and not aircraft just lifting off or about to touch down at an airport.
  area = area.filter((f) => !f.onGround && !f.demo && (f.groundSpeed ?? 0) > 50 && (f.altitude ?? 0) > elev + 800);
  if (area.length < 2) return [];
  const lat0 = area[0].lat;
  const P = area.map((f) => ({ f, p: project(f, lat0) }));
  const out: Conflict[] = [];
  for (let i = 0; i < P.length; i++) {
    for (let j = i + 1; j < P.length; j++) {
      const A = P[i], B = P[j];
      // Quick reject: too far apart to meet within the look-ahead.
      const d0 = Math.hypot(A.p.x - B.p.x, A.p.y - B.p.y);
      if (d0 > 25) continue;
      const nearField = airportPos && Math.max(A.p.z, B.p.z) < elev + 10000;
      const hMin = nearField ? 3 : 5;
      let best: { t: number; h: number; v: number } | null = null;
      let first: number | null = null;
      for (let t = 0; t <= LOOKAHEAD; t += STEP) {
        const h = Math.hypot(A.p.x + A.p.vx * t - (B.p.x + B.p.vx * t), A.p.y + A.p.vy * t - (B.p.y + B.p.vy * t));
        const za = A.p.z + A.p.vz * t, zb = B.p.z + B.p.vz * t;
        const v = Math.abs(za - zb);
        const vMin = Math.min(za, zb) >= 41000 ? 2000 : 1000;
        const lost = h < hMin && v < vMin - 50;
        if (lost && first == null) first = t;
        if (!best || h + v / 200 < best.h + best.v / 200) best = { t, h, v };
      }
      if (first == null || !best) continue;
      const nowFt = Math.abs(A.p.z - B.p.z);
      const [a, b] = [A.f.callsign, B.f.callsign].sort();
      out.push({
        id: `${a}|${b}`,
        a,
        b,
        level: first === 0 ? 'now' : 'soon',
        inSec: first,
        hNm: Math.round(best.h * 10) / 10,
        vFt: Math.round(best.v / 100) * 100,
        nowNm: Math.round(d0 * 10) / 10,
        nowFt: Math.round(nowFt / 100) * 100,
        pa: [A.f.lon, A.f.lat],
        pb: [B.f.lon, B.f.lat],
      });
    }
  }
  return out.sort((x, y) => (x.level === y.level ? x.inSec - y.inSec : x.level === 'now' ? -1 : 1));
}

function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.22].forEach((d) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + d);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + d + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + d);
      o.stop(ctx.currentTime + d + 0.2);
    });
    window.setTimeout(() => ctx.close(), 800);
  } catch {
    /* no audio */
  }
}

export const ALERT_SOUND_KEY = 'webeye2.atcAlertSound';

/** Recomputes alerts whenever the feed updates, while you're a verified controller. */
export function useConflictAlerts() {
  const session = useStore((s) => s.atcSession);
  const flights = useStore((s) => s.flights);
  const known = useRef(new Set<string>());
  useEffect(() => {
    if (!session) {
      if (useStore.getState().conflicts.length) useStore.setState({ conflicts: [] });
      known.current.clear();
      return;
    }
    const list = findConflicts(flights, session);
    useStore.setState({ conflicts: list });
    const fresh = list.filter((c) => !known.current.has(c.id));
    known.current = new Set(list.map((c) => c.id));
    let sound = false;
    try {
      sound = localStorage.getItem(ALERT_SOUND_KEY) === '1';
    } catch {
      /* storage blocked */
    }
    if (fresh.length && sound) chime();
    if (fresh.some((c) => c.level === 'now')) useStore.getState().notify(`Traffic alert: ${fresh[0].a} and ${fresh[0].b}`);
  }, [flights, session]);
}
