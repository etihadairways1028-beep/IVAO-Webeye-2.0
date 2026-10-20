import type { Flight, SimbriefPlan } from '../types';
import { progressAlong } from '../data/simbrief';

export interface Progress {
  source: 'plan' | 'ivao' | null;
  flownNm: number | null;
  remainingNm: number | null;
  totalNm: number | null;
  pct: number | null;
  /** Live estimate at current groundspeed (ms epoch) — calculated, not authoritative. */
  eta: number | null;
  ete: number | null; // seconds
  nextFix: number; // index into plan.fixes of the next waypoint (plan only)
  offRouteNm: number | null;
}

const GS_MIN = 100;

/** Distance/ETA progress for a flight: along the SimBrief route when it matches, else from IVAO-reported distances. */
export function flightProgress(f: Flight, plan: SimbriefPlan | null, now = Date.now()): Progress {
  const matched = plan && plan.callsign.toUpperCase() === f.callsign ? plan : null;
  const gs = f.groundSpeed ?? 0;
  if (matched) {
    const total = matched.totalNm;
    let flown: number;
    let off: number | null = null;
    let next = 0;
    if (f.onGround && (f.departureDistance ?? 0) < 5) flown = 0;
    else if (f.onGround && (f.arrivalDistance ?? 99) < 5) flown = total;
    else {
      const p = progressAlong(matched, f.lat, f.lon);
      flown = p.alongNm;
      off = p.xtkNm;
    }
    next = matched.fixes.findIndex((x) => x.cumNm > flown + 0.5);
    if (next < 0) next = matched.fixes.length;
    const rem = Math.max(0, total - flown);
    const ete = !f.onGround && gs > GS_MIN ? (rem / gs) * 3600 : null;
    return { source: 'plan', flownNm: flown, remainingNm: rem, totalNm: total, pct: total > 0 ? flown / total : null, ete, eta: ete != null ? now + ete * 1000 : null, nextFix: next, offRouteNm: off };
  }
  if (f.arrivalDistance != null && f.departureDistance != null) {
    const total = f.arrivalDistance + f.departureDistance;
    const ete = !f.onGround && gs > GS_MIN ? (f.arrivalDistance / gs) * 3600 : null;
    return { source: 'ivao', flownNm: f.departureDistance, remainingNm: f.arrivalDistance, totalNm: total, pct: total > 0 ? f.departureDistance / total : null, ete, eta: ete != null ? now + ete * 1000 : null, nextFix: 0, offRouteNm: null };
  }
  return { source: null, flownNm: null, remainingNm: null, totalNm: null, pct: null, eta: null, ete: null, nextFix: 0, offRouteNm: null };
}
