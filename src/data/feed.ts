// Feed controller: owns polling, back-off, visibility pausing and the
// observed-trail buffer. React components only read the resulting store.
import { useStore } from '../state/store';
import { fetchWhazzup, normalizeWhazzup, MIN_POLL_SECONDS } from './ivao';
import { demoTraffic } from './demo';
import type { Flight } from '../types';

export type TrailPoint = [number, number, number, number?]; // lon, lat, alt, time (ms)
/** Positions observed by this browser since the page was opened (not historical IVAO tracks). */
export const trails = new Map<string, TrailPoint[]>();
const MAX_TRAIL = 240; // ~1 h at 15 s polling for every aircraft
const MAX_KEPT = 1500; // own / selected aircraft: thinned instead of cut, so the whole flight stays

// Trails of your own and the selected aircraft are kept in this browser, so closing or
// reloading the page doesn't wipe where the flight has been.
const TRAIL_KEY = 'webeye2.trails.v1';
const KEEP_MS = 14 * 3600e3;
type Saved = Record<string, { t: number; p: TrailPoint[] }>;
function readSaved(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(TRAIL_KEY) ?? '{}') as Saved;
    const now = Date.now();
    for (const k of Object.keys(s)) if (!s[k] || now - s[k].t > KEEP_MS) delete s[k];
    return s;
  } catch {
    return {};
  }
}
let saved: Saved = readSaved();
let lastSave = 0;

function keepKeys(flights: Flight[]): Set<string> {
  const st = useStore.getState();
  const keys = new Set<string>();
  if (st.selection?.kind === 'flight') keys.add(st.selection.key);
  const vid = Number(st.prefs.myVid);
  if (st.prefs.myVid && Number.isFinite(vid)) for (const f of flights) if (f.vid === vid) keys.add(f.key);
  const cs = st.plan?.callsign.toUpperCase();
  if (cs) for (const f of flights) if (f.callsign === cs) keys.add(f.key);
  return keys;
}

function persist(flights: Flight[]) {
  if (flights.some((f) => f.demo)) return;
  const keys = keepKeys(flights);
  for (const k of keys) {
    const t = trails.get(k);
    if (t && t.length > 1) saved[k] = { t: Date.now(), p: t.map(([a, b, c, d]) => [Math.round(a * 1e4) / 1e4, Math.round(b * 1e4) / 1e4, Math.round(c), d] as TrailPoint) };
  }
  if (Date.now() - lastSave < 20000 && !keys.size) return;
  lastSave = Date.now();
  try {
    localStorage.setItem(TRAIL_KEY, JSON.stringify(saved));
  } catch {
    saved = {}; // storage full or blocked: keep working in memory
  }
}

function recordTrails(flights: Flight[]) {
  const seen = new Set<string>();
  const keep = keepKeys(flights);
  for (const f of flights) {
    seen.add(f.key);
    let t = trails.get(f.key);
    if (!t) {
      // Resume a trail saved earlier in this browser (same IVAO session).
      t = saved[f.key] && !f.demo ? [...saved[f.key].p] : [];
    }
    const last = t[t.length - 1];
    if (!last || Math.abs(last[0] - f.lon) > 1e-4 || Math.abs(last[1] - f.lat) > 1e-4) {
      t.push([f.lon, f.lat, f.altitude ?? 0, Date.now()]);
      if (keep.has(f.key)) {
        if (t.length > MAX_KEPT) t = [...t.slice(0, 1000).filter((_, i) => i % 2 === 0), ...t.slice(1000)];
      } else if (t.length > MAX_TRAIL) t.splice(0, t.length - MAX_TRAIL);
    }
    trails.set(f.key, t);
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
  // Hidden tab: pause, unless you're tracking your own flight. Then keep recording
  // (every 30 s) so the trail from pushback has no gaps while you fly in the sim.
  if (document.hidden && !st.prefs.myVid) {
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
    persist(flights);
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
  const base = Math.max(MIN_POLL_SECONDS, useStore.getState().prefs.pollSec, document.hidden ? 30 : 0);
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
