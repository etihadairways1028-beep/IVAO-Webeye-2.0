// Feed controller: owns polling, back-off, visibility pausing and the
// observed-trail buffer. React components only read the resulting store.
import { useStore } from '../state/store';
import { fetchWhazzup, normalizeWhazzup, MIN_POLL_SECONDS } from './ivao';
import { demoTraffic } from './demo';
import type { Flight } from '../types';

export type TrailPoint = [number, number, number]; // lon, lat, alt
/** Positions observed by this browser since the page was opened (not historical IVAO tracks). */
export const trails = new Map<string, TrailPoint[]>();
const MAX_TRAIL = 360;

function recordTrails(flights: Flight[]) {
  const seen = new Set<string>();
  for (const f of flights) {
    seen.add(f.key);
    const t = trails.get(f.key) ?? [];
    const last = t[t.length - 1];
    if (!last || Math.abs(last[0] - f.lon) > 1e-4 || Math.abs(last[1] - f.lat) > 1e-4) {
      t.push([f.lon, f.lat, f.altitude ?? 0]);
      if (t.length > MAX_TRAIL) t.splice(0, t.length - MAX_TRAIL);
      trails.set(f.key, t);
    }
  }
  for (const k of trails.keys()) if (!seen.has(k)) trails.delete(k);
}

let timer: number | null = null;
let ctrl: AbortController | null = null;
let failures = 0;
let running: 'live' | 'demo' | null = null;

function clear() {
  if (timer != null) window.clearTimeout(timer);
  timer = null;
  ctrl?.abort();
  ctrl = null;
}

async function pollLive() {
  const st = useStore.getState();
  if (document.hidden) {
    timer = window.setTimeout(pollLive, 2000);
    return;
  }
  ctrl = new AbortController();
  const abortTimer = window.setTimeout(() => ctrl?.abort(), 20000);
  if (st.status !== 'live' && st.status !== 'stale') st.setFeed({ status: 'connecting' });
  try {
    const raw = await fetchWhazzup(ctrl.signal);
    if (running !== 'live') return;
    const { flights, controllers, counts, updatedAt } = normalizeWhazzup(raw, useStore.getState().flightMap);
    recordTrails(flights);
    failures = 0;
    const age = updatedAt ? Date.now() - new Date(updatedAt).getTime() : 0;
    useStore.getState().setFeed({ flights, controllers, counts, sourceUpdatedAt: updatedAt, fetchedAt: Date.now(), status: age > 120000 ? 'stale' : 'live', error: null });
  } catch (e) {
    if (running !== 'live') return;
    failures++;
    const msg = e instanceof Error ? (e.name === 'AbortError' ? 'Request timed out' : e.message) : String(e);
    const hasData = useStore.getState().flights.length > 0;
    useStore.getState().setFeed({ status: hasData ? 'stale' : 'error', error: msg });
  } finally {
    window.clearTimeout(abortTimer);
  }
  if (running !== 'live') return;
  const base = Math.max(MIN_POLL_SECONDS, useStore.getState().prefs.pollSec);
  const delay = failures ? Math.min(120, base * 2 ** Math.min(failures, 3)) : base;
  timer = window.setTimeout(pollLive, delay * 1000);
}

function tickDemo() {
  const { flights, controllers, counts } = demoTraffic();
  recordTrails(flights);
  useStore.getState().setFeed({ flights, controllers, counts, status: 'demo', error: null, sourceUpdatedAt: new Date().toISOString(), fetchedAt: Date.now() });
  timer = window.setTimeout(tickDemo, 5000);
}

/** Switch data source; clears previous records so live and demo never mix. */
export function startFeed(source: 'live' | 'demo') {
  if (running === source) return;
  clear();
  running = source;
  failures = 0;
  trails.clear();
  const st = useStore.getState();
  st.setFeed({ flights: [], controllers: [], counts: { pilots: null, atc: null, observers: null, total: null, uniqueUsers24h: null }, sourceUpdatedAt: null, fetchedAt: null, error: null, status: source === 'demo' ? 'demo' : 'connecting' });
  st.select(null);
  if (source === 'live') pollLive();
  else tickDemo();
}

export function retryNow() {
  if (running !== 'live') return;
  clear();
  failures = 0;
  pollLive();
}

export function stopFeed() {
  clear();
  running = null;
}
