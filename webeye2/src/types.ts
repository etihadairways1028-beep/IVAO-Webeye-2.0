// ───────────── Raw IVAO Whazzup v2 (GET https://api.ivao.aero/v2/tracker/whazzup)
// Field names follow IVAO's published OpenAPI DTOs (WhazzupDto, LastTrackDto,
// FlightPlanDto, AtcSessionDto…). Everything is optional because the public
// feed omits fields depending on client state.

export interface RawLastTrack {
  altitude?: number;
  altitudeDifference?: number;
  arrivalDistance?: number | null;
  departureDistance?: number | null;
  groundSpeed?: number;
  heading?: number;
  latitude?: number;
  longitude?: number;
  onGround?: boolean;
  state?: string;
  timestamp?: string;
  transponder?: number;
  transponderMode?: string;
  time?: number;
}

export interface RawFlightPlan {
  id?: number;
  revision?: number;
  aircraftId?: string;
  aircraftNumber?: number;
  departureId?: string | null;
  arrivalId?: string | null;
  alternativeId?: string | null;
  alternative2Id?: string | null;
  route?: string;
  remarks?: string;
  speed?: string;
  level?: string;
  flightRules?: string;
  flightType?: string;
  eet?: number;
  endurance?: number;
  departureTime?: number;
  actualDepartureTime?: number;
  peopleOnBoard?: number;
  aircraft?: { icaoCode?: string; model?: string; wakeTurbulence?: string; isMilitary?: boolean; description?: string };
}

export interface RawPilot {
  id: number;
  userId: number;
  callsign: string;
  serverId?: string;
  rating?: number;
  createdAt?: string;
  time?: number;
  softwareTypeId?: string;
  softwareVersion?: string;
  pilotSession?: { simulatorId?: string; textureId?: number };
  lastTrack?: RawLastTrack | null;
  flightPlan?: RawFlightPlan | null;
}

export interface RawAtc {
  id: number;
  userId: number;
  callsign: string;
  serverId?: string;
  rating?: number;
  createdAt?: string;
  time?: number;
  atcSession?: { frequency?: number; position?: string };
  atis?: { lines?: string[]; revision?: string; timestamp?: string } | null;
  lastTrack?: RawLastTrack | null;
}

export interface RawWhazzup {
  updatedAt?: string;
  clients?: { pilots?: RawPilot[]; atcs?: RawAtc[]; observers?: unknown[]; followMe?: unknown[] };
  connections?: { total?: number; supervisor?: number; atc?: number; observer?: number; pilot?: number; worldTour?: number; followMe?: number; uniqueUsers24h?: number };
}

// ───────────── Normalised app model

export type WakeCat = 'L' | 'M' | 'H' | 'J' | '?';

export interface Flight {
  key: string; // stable session id
  sessionId: number;
  vid: number;
  callsign: string;
  lat: number;
  lon: number;
  altitude: number | null; // ft
  groundSpeed: number | null; // kt
  heading: number | null; // deg true (IVAO reports heading; used as track)
  verticalSpeed: number | null; // fpm, derived from successive polls (marked derived)
  onGround: boolean;
  state: string | null; // IVAO-reported flight state
  transponder: string | null;
  trackTime: string | null; // ISO timestamp of last position report
  arrivalDistance: number | null; // NM, IVAO-reported
  departureDistance: number | null;
  connectedAt: string | null;
  server: string | null;
  simulator: string | null;
  software: string | null;
  rating: number | null;
  // flight plan
  dep: string | null;
  arr: string | null;
  alt: string | null;
  aircraft: string | null; // ICAO type
  aircraftModel: string | null;
  wake: WakeCat;
  military: boolean;
  registration: string | null; // only when supplied (e.g. REG/ in remarks)
  rules: string | null;
  flightType: string | null;
  route: string | null;
  remarks: string | null;
  cruiseLevel: string | null;
  cruiseSpeed: string | null;
  pob: number | null;
  eet: number | null; // seconds
  demo: boolean;
}

export type AtcPosition = 'DEL' | 'GND' | 'TWR' | 'APP' | 'DEP' | 'CTR' | 'FSS' | 'RMP' | 'OTHER';

export interface Controller {
  key: string;
  sessionId: number;
  vid: number;
  callsign: string;
  position: AtcPosition;
  frequency: number | null; // MHz
  lat: number | null;
  lon: number | null;
  locationSource: 'feed' | 'airport' | null;
  airport: string | null;
  atis: string[];
  atisTime: string | null;
  connectedAt: string | null;
  rating: number | null;
  demo: boolean;
}

export interface Airport {
  icao: string;
  iata: string;
  name: string;
  lat: number;
  lon: number;
  elevation: number | null;
  country: string;
  city: string;
  size: 1 | 2 | 3;
}

export interface Runway {
  le: string;
  he: string;
  lengthFt: number | null;
  widthFt: number | null;
  surface: string;
  lighted: boolean;
  coords: [number, number, number, number] | null; // leLat, leLon, heLat, heLon
}

export interface Counts {
  pilots: number | null;
  atc: number | null;
  observers: number | null;
  total: number | null;
  uniqueUsers24h: number | null;
}

export type FeedStatus = 'idle' | 'connecting' | 'live' | 'stale' | 'error' | 'demo';

export interface SimbriefPlan {
  callsign: string;
  flightNumber: string;
  origin: { icao: string; name: string; lat: number; lon: number; rwy: string | null };
  destination: { icao: string; name: string; lat: number; lon: number; rwy: string | null };
  alternate: string | null;
  aircraft: string;
  registration: string | null;
  route: string;
  cruise: string;
  costIndex: string | null;
  distanceNm: number | null;
  airTime: number | null; // seconds
  schedOut: number | null; // unix s
  schedIn: number | null;
  fuelBlock: string | null;
  units: string | null;
  fixes: { ident: string; lat: number; lon: number; type: string; alt: number | null }[];
  generatedAt: number | null;
}

export interface Metar {
  icao: string;
  raw: string;
  obsTime: string | null;
  flightCategory: string | null;
}
