import type { Airport, Runway } from '../types';

type AirportRow = [string, string, string, number, number, number | null, string, string, 1 | 2 | 3];
type RunwayRow = [string, string, number | null, number | null, string, 0 | 1, number | null, number | null, number | null, number | null];

let airports: Airport[] = [];
const byIcao = new Map<string, Airport>();
const byIata = new Map<string, Airport>();
let runwayRows: Record<string, RunwayRow[]> | null = null;
let loading: Promise<void> | null = null;

/** Loads the bundled OurAirports extract (public domain, ourairports.com). */
export function loadAirports(): Promise<void> {
  if (!loading) {
    loading = fetch(`${import.meta.env.BASE_URL}data/airports.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`airports.json HTTP ${r.status}`);
        return r.json() as Promise<AirportRow[]>;
      })
      .then((rows) => {
        airports = rows.map(([icao, iata, name, lat, lon, elevation, country, city, size]) => ({ icao, iata, name, lat, lon, elevation, country, city, size }));
        for (const a of airports) {
          byIcao.set(a.icao, a);
          if (a.iata && !byIata.has(a.iata)) byIata.set(a.iata, a);
        }
      })
      .catch((e) => {
        loading = null;
        throw e;
      });
  }
  return loading;
}

export const getAirport = (icao: string | null | undefined) => (icao ? byIcao.get(icao.toUpperCase()) ?? null : null);
export const allAirports = () => airports;

export async function getRunways(icao: string): Promise<Runway[]> {
  if (!runwayRows) {
    const r = await fetch(`${import.meta.env.BASE_URL}data/runways.json`);
    if (!r.ok) throw new Error(`runways.json HTTP ${r.status}`);
    runwayRows = (await r.json()) as Record<string, RunwayRow[]>;
  }
  return (runwayRows[icao] ?? []).map(([le, he, lengthFt, widthFt, surface, lighted, a, b, c, d]) => ({
    le,
    he,
    lengthFt,
    widthFt,
    surface,
    lighted: lighted === 1,
    coords: a != null && b != null && c != null && d != null ? [a, b, c, d] : null,
  }));
}

export function searchAirports(q: string, limit = 12): Airport[] {
  const s = q.trim().toUpperCase();
  if (s.length < 2) return [];
  const exact = byIcao.get(s) ?? byIata.get(s);
  const out: Airport[] = exact ? [exact] : [];
  const scored: { a: Airport; score: number }[] = [];
  for (const a of airports) {
    if (a === exact) continue;
    let score = 0;
    if (a.icao.startsWith(s)) score = 50;
    else if (a.iata && a.iata.startsWith(s)) score = 45;
    else {
      const name = a.name.toUpperCase();
      const city = a.city.toUpperCase();
      if (city.startsWith(s)) score = 30;
      else if (name.includes(s)) score = 20;
      else if (city.includes(s)) score = 15;
    }
    if (score) scored.push({ a, score: score + a.size * 4 });
  }
  scored.sort((x, y) => y.score - x.score);
  for (const { a } of scored) {
    if (out.length >= limit) break;
    out.push(a);
  }
  return out;
}

const SURFACE: Record<string, string> = { ASP: 'Asphalt', ASPH: 'Asphalt', CON: 'Concrete', CONC: 'Concrete', GRS: 'Grass', GRASS: 'Grass', TURF: 'Turf', GRE: 'Gravel', GRVL: 'Gravel', BIT: 'Bitumen', PEM: 'Asphalt' };
export const surfaceLabel = (s: string) => SURFACE[s.toUpperCase().split(/[-/ ]/)[0]] ?? (s || '—');
