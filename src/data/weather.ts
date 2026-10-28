import type { Metar } from '../types';

import { AWC_URL as AWC, RAINVIEWER_URL as RAINVIEWER } from './endpoints';

/** METAR from NOAA Aviation Weather Center Data API (https://aviationweather.gov/data/api/). */
export async function fetchMetar(icao: string, signal?: AbortSignal): Promise<Metar | null> {
  const r = await fetch(`${AWC}/metar?ids=${encodeURIComponent(icao)}&format=json`, { signal });
  if (r.status === 204) return null;
  if (!r.ok) throw new Error(`AWC METAR HTTP ${r.status}`);
  const arr = (await r.json()) as { icaoId?: string; rawOb?: string; reportTime?: string; obsTime?: number; fltCat?: string }[];
  const m = arr?.[0];
  if (!m?.rawOb) return null;
  return {
    icao: m.icaoId ?? icao,
    raw: m.rawOb,
    obsTime: m.reportTime ?? (m.obsTime ? new Date(m.obsTime * 1000).toISOString() : null),
    flightCategory: m.fltCat ?? null,
  };
}

export async function fetchTaf(icao: string, signal?: AbortSignal): Promise<string | null> {
  const r = await fetch(`${AWC}/taf?ids=${encodeURIComponent(icao)}&format=json`, { signal });
  if (r.status === 204) return null;
  if (!r.ok) throw new Error(`AWC TAF HTTP ${r.status}`);
  const arr = (await r.json()) as { rawTAF?: string }[];
  return arr?.[0]?.rawTAF ?? null;
}

export interface StationWx {
  icao: string;
  lat: number;
  lon: number;
  cat: 'VFR' | 'MVFR' | 'IFR' | 'LIFR' | null;
  wdir: number | null; // degrees, null when variable
  wspd: number | null; // kt
  wgst: number | null;
  temp: number | null;
  raw: string;
}

/** Every METAR inside a bounding box (west, south, east, north), from NOAA AWC. */
export async function fetchMetarsInBox(b: [number, number, number, number], signal?: AbortSignal): Promise<StationWx[]> {
  const [w, s, e, n] = b.map((v) => Math.round(v * 100) / 100);
  const r = await fetch(`${AWC}/metar?bbox=${s},${w},${n},${e}&format=json`, { signal });
  if (r.status === 204) return [];
  if (!r.ok) throw new Error(`AWC METAR HTTP ${r.status}`);
  const arr = (await r.json()) as { icaoId?: string; lat?: number; lon?: number; fltCat?: string; wdir?: number | string; wspd?: number; wgst?: number; temp?: number; rawOb?: string }[];
  return (arr ?? [])
    .filter((m) => m.icaoId && typeof m.lat === 'number' && typeof m.lon === 'number')
    .map((m) => ({
      icao: m.icaoId!,
      lat: m.lat!,
      lon: m.lon!,
      cat: (['VFR', 'MVFR', 'IFR', 'LIFR'].includes(m.fltCat ?? '') ? m.fltCat : null) as StationWx['cat'],
      wdir: typeof m.wdir === 'number' ? m.wdir : null,
      wspd: typeof m.wspd === 'number' ? m.wspd : null,
      wgst: typeof m.wgst === 'number' ? m.wgst : null,
      temp: typeof m.temp === 'number' ? m.temp : null,
      raw: m.rawOb ?? '',
    }));
}

export interface RadarFrame { host: string; path: string; time: number }

/** Latest precipitation radar frame from RainViewer's public Weather Maps API. */
export async function fetchRadarFrame(signal?: AbortSignal): Promise<RadarFrame | null> {
  const r = await fetch(RAINVIEWER, { signal, cache: 'no-store' });
  if (!r.ok) throw new Error(`RainViewer HTTP ${r.status}`);
  const j = (await r.json()) as { host?: string; radar?: { past?: { time: number; path: string }[] } };
  const past = j.radar?.past ?? [];
  const last = past[past.length - 1];
  return last && j.host ? { host: j.host, path: last.path, time: last.time } : null;
}
