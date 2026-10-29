import { create } from 'zustand';
import type { Controller, Counts, FeedStatus, Flight, SimbriefPlan, WakeCat } from '../types';
import { REGIONS, inBox, type Region } from '../lib/geo';
import type { TaxiRoute } from '../lib/taxi';
import { loadAtcSession, type AtcSession, type Clearance } from '../data/atc';

export type MapStyleId = 'dark' | 'standard' | 'satellite' | 'radar';
export type LabelMode = 'auto' | 'off' | 'callsign' | 'full';
export type Panel = 'traffic' | 'airports' | 'atc' | 'myflight' | 'atcdesk' | 'logbook' | 'stats' | 'profile' | 'friends' | 'airline' | 'now';

export interface Filters {
  wake: WakeCat[]; // empty = all
  minFl: number;
  maxFl: number;
  rules: 'all' | 'I' | 'V';
  region: Region;
  hideGround: boolean;
}

export interface Prefs {
  mapStyle: MapStyleId;
  lastNonRadarStyle: Exclude<MapStyleId, 'radar'>;
  labels: LabelMode;
  globe: boolean;
  glass: boolean;
  theme: 'system' | 'dark' | 'light';
  colorBy: 'uniform' | 'altitude';
  layers: { airports: boolean; atc: boolean; weather: boolean; trails: boolean; borders: boolean; firs: boolean; metar: boolean; daynight: boolean; heatmap: boolean; busy: boolean };
  pollSec: 15 | 30 | 60;
  source: 'live' | 'demo';
  myVid: string;
  /** Interface accent colour (Settings → Appearance). */
  accent: import('../lib/accent').AccentId;
  /** Pilots and controllers you follow, by IVAO VID. */
  friends: { vid: number; name: string }[];
  /** Browser notifications for friends (in addition to in-app toasts). */
  friendNotify: boolean;
  simbriefUser: string;
  transitionAlt: number;
  filters: Filters;
}

export const DEFAULT_FILTERS: Filters = { wake: [], minFl: 0, maxFl: 600, rules: 'all', region: 'all', hideGround: false };

const DEFAULT_PREFS: Prefs = {
  mapStyle: 'dark',
  lastNonRadarStyle: 'dark',
  labels: 'auto',
  globe: false,
  glass: true,
  theme: 'system',
  colorBy: 'uniform',
  layers: { airports: true, atc: true, weather: false, trails: true, borders: true, firs: true, metar: false, daynight: true, heatmap: false, busy: true },
  pollSec: 15,
  source: 'live',
  myVid: '',
  accent: 'blue',
  friends: [],
  friendNotify: false,
  simbriefUser: '',
  transitionAlt: 18000,
  filters: DEFAULT_FILTERS,
};

const PREFS_KEY = 'webeye2.prefs.v2';
function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return { ...DEFAULT_PREFS, ...p, layers: { ...DEFAULT_PREFS.layers, ...p.layers }, filters: { ...DEFAULT_FILTERS, ...p.filters } };
  } catch {
    return DEFAULT_PREFS;
  }
}

export type Selection = { kind: 'flight'; key: string } | { kind: 'atc'; key: string } | { kind: 'airport'; icao: string } | null;

export type CameraInput =
  | { type: 'fly'; center: [number, number]; zoom?: number }
  | { type: 'fit'; bounds: [[number, number], [number, number]]; maxZoom?: number }
  | { type: 'world' };
export type CameraRequest = CameraInput & { nonce: number };

interface State {
  prefs: Prefs;
  status: FeedStatus;
  error: string | null;
  sourceUpdatedAt: string | null;
  fetchedAt: number | null;
  counts: Counts;
  flights: Flight[];
  flightMap: Map<string, Flight>;
  controllers: Controller[];
  airportsReady: boolean;
  selection: Selection;
  follow: boolean;
  showRoute: boolean;
  panel: Panel | null;
  overlay: 'layers' | 'settings' | 'help' | 'about' | null;
  viewBounds: [number, number, number, number] | null;
  camera: CameraRequest | null;
  plan: SimbriefPlan | null;
  toast: { text: string; id: number } | null;
  wxTime: number | null;
  wxError: string | null;
  trackInfo: { key: string; points: number; error: string | null; source: 'recorder' | 'ivao' | null; note?: string } | null;
  taxi: { icao: string; text: string; route: TaxiRoute } | null;
  assignedSquawk: string;
  chartFocus: string | null;
  /** A logged flight drawn on the map from the logbook. */
  logView: { routes: { route: [number, number, number][]; dep?: string | null; arr?: string | null }[]; landed?: number } | null;
  /** Pilot whose profile is open. */
  profileVid: number | null;
  /** Time machine state (null when showing live traffic). t is the replayed time in ms. */
  replay: { t: number; playing: boolean; speed: number; oldest: number | null; latest: number | null; loading: boolean; error: string | null; gap?: boolean } | null;
  /** Distance tool points (null when the tool is off). */
  measure: { lon: number; lat: number; label: string }[] | null;
  /** Airport shown on the full-screen board. */
  board: string | null;
  /** Airline shown in the airline panel, and the airline the map is limited to (if any). */
  airline: string | null;
  /** Cinematic camera tour running. */
  tour: boolean;
  airlineFilter: string | null;
  /** Embedded on another site (?embed=1): optional airport filter. */
  embed: { airport: string | null; theme: 'light' | 'dark' | null } | null;
  /** Flown track of the selected flight (for the profile charts). */
  trackPts: { key: string; pts: import('../data/ivao').TrackPoint[] } | null;
  /** Traffic alerts for a verified controller. */
  conflicts: import('../lib/conflicts').Conflict[];
  atcSession: AtcSession | null;
  incoming: Clearance | null;

  setPrefs: (p: Partial<Prefs>) => void;
  setFilters: (f: Partial<Filters>) => void;
  setFeed: (d: Partial<Pick<State, 'status' | 'error' | 'sourceUpdatedAt' | 'fetchedAt' | 'counts'>> & { flights?: Flight[]; controllers?: Controller[] }) => void;
  select: (s: Selection, opts?: { follow?: boolean }) => void;
  setPanel: (p: Panel | null) => void;
  setOverlay: (o: State['overlay']) => void;
  camera_: (c: CameraInput) => void;
  setFollow: (f: boolean) => void;
  setShowRoute: (v: boolean) => void;
  setPlan: (p: SimbriefPlan | null) => void;
  notify: (text: string) => void;
}

let nonce = 0;

export const useStore = create<State>((set, get) => ({
  prefs: loadPrefs(),
  status: 'idle',
  error: null,
  sourceUpdatedAt: null,
  fetchedAt: null,
  counts: { pilots: null, atc: null, observers: null, total: null, uniqueUsers24h: null },
  flights: [],
  flightMap: new Map(),
  controllers: [],
  airportsReady: false,
  selection: null,
  follow: false,
  showRoute: true,
  // Desktop opens on the network overview; phones start on the map.
  panel: typeof window !== 'undefined' && window.innerWidth >= 900 && !location.hash && !/[?&](embed|overlay|airport)=/.test(location.search) ? 'now' : null,
  overlay: null,
  viewBounds: null,
  camera: null,
  plan: null,
  toast: null,
  wxTime: null,
  wxError: null,
  trackInfo: null,
  taxi: null,
  assignedSquawk: '',
  chartFocus: null,
  logView: null,
  profileVid: null,
  conflicts: [],
  trackPts: null,
  airline: null,
  tour: false,
  airlineFilter: null,
  embed: null,
  replay: null,
  board: null,
  measure: null,
  atcSession: loadAtcSession(),
  incoming: null,

  setPrefs: (p) => {
    const prefs = { ...get().prefs, ...p };
    if (p.mapStyle && p.mapStyle !== 'radar') prefs.lastNonRadarStyle = p.mapStyle;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* storage unavailable: keep in memory */
    }
    set({ prefs });
  },
  setFilters: (f) => get().setPrefs({ filters: { ...get().prefs.filters, ...f } }),
  setFeed: (d) => {
    const patch: Partial<State> = { ...d } as Partial<State>;
    if (d.flights) patch.flightMap = new Map(d.flights.map((f) => [f.key, f]));
    set(patch);
  },
  select: (selection, opts) => set({ selection, follow: opts?.follow ?? false, showRoute: true }),
  setPanel: (panel) => set({ panel }),
  setOverlay: (overlay) => set({ overlay }),
  camera_: (c) => set({ camera: { ...c, nonce: ++nonce } }),
  setFollow: (follow) => set({ follow }),
  setShowRoute: (showRoute) => set({ showRoute }),
  setPlan: (plan) => set({ plan }),
  notify: (text) => set({ toast: { text, id: ++nonce } }),
}));

export function passesFilters(f: Flight, filters: Filters, view: [number, number, number, number] | null): boolean {
  if (filters.hideGround && f.onGround) return false;
  if (filters.wake.length && !filters.wake.includes(f.wake)) return false;
  if (filters.rules !== 'all' && f.rules && f.rules !== filters.rules) return false;
  const fl = (f.altitude ?? 0) / 100;
  if (fl < filters.minFl || (filters.maxFl < 600 && fl > filters.maxFl)) return false;
  if (filters.region === 'view') return view ? inBox(f.lon, f.lat, view) : true;
  if (filters.region !== 'all') {
    const r = REGIONS.find((x) => x.id === filters.region);
    if (r?.box && !inBox(f.lon, f.lat, r.box)) return false;
  }
  return true;
}

export const filtersActive = (f: Filters) =>
  f.wake.length > 0 || f.minFl > 0 || f.maxFl < 600 || f.rules !== 'all' || f.region !== 'all' || f.hideGround;

export function phaseOf(f: Flight): 'departing' | 'arriving' | 'enroute' | 'ground' {
  const st = (f.state ?? '').toLowerCase();
  if (f.onGround) return 'ground';
  if (/approach|landing|descen|final/.test(st)) return 'arriving';
  if (/depart|takeoff|take-off|climb/.test(st)) return 'departing';
  if (f.arrivalDistance != null && f.arrivalDistance < 60) return 'arriving';
  if (f.departureDistance != null && f.departureDistance < 40) return 'departing';
  return 'enroute';
}
