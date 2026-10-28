// Time machine: replays the last 18 hours of IVAO traffic from the Pulse recorder.
// The recorder keeps every pilot's position once a minute; we fetch 10-minute chunks
// (edge-cached for everyone), interpolate between minutes and play them back at speed.
import { useStore } from '../state/store';
import { RECORDER_URL } from './endpoints';
import { startFeed, stopFeed, trails } from './feed';
import { normalizeAtc } from './ivao';
import type { Controller, Flight, RawAtc, WakeCat } from '../types';

const REC = 17;
const CHUNK = 10; // minutes per request
const TAIL_MIN = 12; // minutes of trail drawn behind each aircraft

type Pos = [number, number, number, number, number]; // lat, lon, alt, gs, onGround
interface Chunk {
  frames: Map<number, Map<number, Pos>>; // minute -> session -> position
  atc: Controller[];
}

const chunks = new Map<number, Chunk | Promise<Chunk | null>>();
const info = new Map<number, [string, number, string | null, string | null, string | null]>();
let timer: number | null = null;
let lastTick = 0;

export const SPEEDS = [1, 10, 60, 300] as const;

function decode(b64: string): Map<number, Pos> {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const dv = new DataView(u8.buffer);
  const out = new Map<number, Pos>();
  for (let o = 0; o + REC <= u8.length; o += REC) {
    out.set(dv.getUint32(o), [dv.getFloat32(o + 4), dv.getFloat32(o + 8), dv.getUint16(o + 12) * 2, dv.getUint16(o + 14), dv.getUint8(o + 16)]);
  }
  return out;
}

function loadChunk(start: number): Promise<Chunk | null> | Chunk | null {
  const have = chunks.get(start);
  if (have) return have;
  const p = fetch(`${RECORDER_URL}/replay?from=${start}&n=${CHUNK}`)
    .then(async (r) => {
      if (!r.ok) throw new Error(`Replay service answered HTTP ${r.status}`);
      const j = (await r.json()) as { minutes: number[]; frames: string[]; info: Record<string, [string, number, string | null, string | null, string | null]>; atc: [string, string, number | null, number | null, number | null][]; oldest: number | null; latest: number | null };
      for (const [k, v] of Object.entries(j.info)) info.set(Number(k), v);
      const frames = new Map<number, Map<number, Pos>>();
      j.minutes.forEach((m, i) => frames.set(m, decode(j.frames[i])));
      const atc = j.atc
        .map(([callsign, position, frequency, lat, lon], i) =>
          normalizeAtc({ id: -(i + 1), userId: 0, callsign, atcSession: { position, frequency: frequency ?? undefined }, lastTrack: lat != null && lon != null ? ({ latitude: lat, longitude: lon } as RawAtc['lastTrack']) : null } as RawAtc),
        )
        .filter((c): c is Controller => !!c);
      const c: Chunk = { frames, atc };
      chunks.set(start, c);
      const r0 = useStore.getState().replay;
      if (r0) useStore.setState({ replay: { ...r0, oldest: j.oldest ?? r0.oldest, latest: j.latest ?? r0.latest, error: null } });
      return c;
    })
    .catch((e) => {
      chunks.delete(start);
      const r0 = useStore.getState().replay;
      if (r0) useStore.setState({ replay: { ...r0, error: (e as Error).message, playing: false } });
      return null;
    });
  chunks.set(start, p);
  return p;
}

const chunkOf = (minute: number) => Math.floor(minute / CHUNK) * CHUNK;

function frameAt(minute: number): Map<number, Pos> | null {
  const c = chunks.get(chunkOf(minute));
  if (!c || c instanceof Promise) return null;
  return c.frames.get(minute) ?? null;
}

const HEAVY = /^(A3[3-5]|A38|B74|B76|B77|B78|MD11|IL96|A306|A30B|C17|AN12|AN22|A124|KC10|B52)/;
const LIGHT = /^(C1\d\d|C2\d\d|PA\d|P28|DA4|DA2|SR2|BE\d|C42|TB\d|DR4|AT3|PC12|M20|G1|EC|H\d|R44|R22|AS\d)/;
function typeWake(t: string | null): WakeCat {
  if (!t) return '?';
  if (t.startsWith('A38')) return 'J';
  if (HEAVY.test(t)) return 'H';
  if (LIGHT.test(t)) return 'L';
  return 'M';
}

function bearing(a: Pos, b: Pos) {
  const r = Math.PI / 180;
  const y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
  const x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

/** Builds the map's flights for replay time t (ms), interpolating between minute frames. */
function render(t: number) {
  const m0 = Math.floor(t / 60000);
  const f = (t - m0 * 60000) / 60000;
  const a = frameAt(m0);
  if (!a) return false;
  const b = frameAt(m0 + 1);
  const prev = frameAt(m0 - 1);
  const flights: Flight[] = [];
  for (const [sid, p] of a) {
    const q = b?.get(sid);
    const lat = q ? p[0] + (q[0] - p[0]) * f : p[0];
    let dLon = q ? q[1] - p[1] : 0;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    const lon = p[1] + dLon * f;
    const alt = q ? p[2] + (q[2] - p[2]) * f : p[2];
    const gs = q ? p[3] + (q[3] - p[3]) * f : p[3];
    const back = prev?.get(sid);
    const moved = (x: Pos, y: Pos) => Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) > 1e-4;
    const hdg = q && moved(p, q) ? bearing(p, q) : back && moved(back, p) ? bearing(back, p) : null;
    const vs = q ? q[2] - p[2] : back ? p[2] - back[2] : 0;
    const who = info.get(sid);
    flights.push({
      key: `p${sid}`, sessionId: sid, vid: who?.[1] ?? 0, callsign: who?.[0] ?? `#${sid}`, lat, lon, altitude: Math.round(alt), groundSpeed: Math.round(gs), heading: hdg,
      verticalSpeed: Math.abs(vs) < 100 ? 0 : vs, onGround: (q ?? p)[4] === 1 && p[4] === 1, state: p[4] ? 'On ground' : null, transponder: null, trackTime: new Date(t).toISOString(),
      arrivalDistance: null, departureDistance: null, connectedAt: null, server: null, simulator: null, software: null, rating: null,
      dep: who?.[3] ?? null, arr: who?.[4] ?? null, alt: null, aircraft: who?.[2] ?? null, aircraftModel: null, wake: typeWake(who?.[2] ?? null), military: false, registration: null,
      rules: null, flightType: null, route: null, remarks: null, cruiseLevel: null, cruiseSpeed: null, pob: null, eet: null, demo: false,
    });
  }
  // Tails: where each aircraft was over the last few minutes.
  trails.clear();
  const back: Map<number, Pos>[] = [];
  for (let k = TAIL_MIN; k >= 1; k--) {
    const fr = frameAt(m0 - k);
    if (fr) back.push(fr);
  }
  for (const fl of flights) {
    const pts: [number, number, number, number][] = [];
    for (const fr of back) {
      const p = fr.get(fl.sessionId);
      if (p) pts.push([p[1], p[0], p[2], 0]);
    }
    pts.push([fl.lon, fl.lat, fl.altitude ?? 0, 0]);
    trails.set(fl.key, pts);
  }
  const c = chunks.get(chunkOf(m0)) as Chunk;
  useStore.getState().setFeed({ flights, controllers: c.atc, counts: { pilots: flights.length, atc: c.atc.length, observers: null, total: null, uniqueUsers24h: null }, status: 'replay', fetchedAt: Date.now(), sourceUpdatedAt: new Date(t).toISOString(), error: null });
  return true;
}

function ensureAround(minute: number) {
  const speed = useStore.getState().replay?.speed ?? 60;
  const ahead = speed >= 300 ? 3 : speed >= 60 ? 2 : 1;
  const out: (Promise<Chunk | null> | Chunk | null)[] = [];
  for (let k = -1; k <= ahead; k++) out.push(loadChunk(chunkOf(minute) + k * CHUNK));
  return out;
}

async function tick() {
  timer = null;
  const r = useStore.getState().replay;
  if (!r) return;
  const now = performance.now();
  const dt = lastTick ? now - lastTick : 0;
  lastTick = now;
  let t = r.t;
  if (r.playing) t += dt * r.speed;
  const end = (r.latest ?? Math.floor(Date.now() / 60000) - 1) * 60000;
  if (t >= end) {
    t = end;
    if (r.playing) useStore.setState({ replay: { ...r, t, playing: false } });
  }
  const minute = Math.floor(t / 60000);
  const pending = ensureAround(minute);
  // Wait for the frames we need right now (pause the clock while they load).
  const cur = pending[1];
  if (cur instanceof Promise) {
    useStore.setState({ replay: { ...useStore.getState().replay!, loading: true } });
    await cur;
    await pending[2];
    lastTick = performance.now();
    const r2 = useStore.getState().replay;
    if (!r2) return;
    useStore.setState({ replay: { ...r2, loading: false } });
  } else {
    const r2 = useStore.getState().replay!;
    const gap = !frameAt(minute); // the recorder has no data for this minute
    if (r2.t !== t || r2.loading || r2.gap !== gap) useStore.setState({ replay: { ...r2, t, loading: false, gap } });
    if (!gap) render(t);
  }
  schedule();
}

function schedule() {
  if (timer == null) timer = window.setTimeout(tick, useStore.getState().replay?.playing ? 120 : 400);
}

/** Opens the time machine at `t` (ms), by default 30 minutes ago. */
export function enterReplay(t = Date.now() - 30 * 60000) {
  const st = useStore.getState();
  if (st.replay) return seekReplay(t);
  stopFeed();
  st.select(null);
  trails.clear();
  useStore.setState({ replay: { t, playing: true, speed: 60, oldest: null, latest: null, loading: true, error: null } });
  lastTick = 0;
  schedule();
}

export function seekReplay(t: number) {
  const r = useStore.getState().replay;
  if (!r) return;
  const lo = (r.oldest ?? Math.floor(Date.now() / 60000) - 18 * 60) * 60000;
  const hi = (r.latest ?? Math.floor(Date.now() / 60000)) * 60000;
  useStore.setState({ replay: { ...r, t: Math.max(lo, Math.min(hi, t)), error: null } });
  lastTick = performance.now();
  if (timer != null) window.clearTimeout(timer), (timer = null);
  tick();
}

export function setReplay(p: Partial<{ playing: boolean; speed: number }>) {
  const r = useStore.getState().replay;
  if (!r) return;
  useStore.setState({ replay: { ...r, ...p } });
  lastTick = performance.now();
  schedule();
}

export function exitReplay() {
  if (timer != null) window.clearTimeout(timer);
  timer = null;
  lastTick = 0;
  useStore.setState({ replay: null });
  chunks.clear();
  trails.clear();
  startFeed(useStore.getState().prefs.source === 'demo' ? 'demo' : 'live');
}
