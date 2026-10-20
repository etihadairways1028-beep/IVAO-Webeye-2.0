import type { Metar } from '../types';

const AWC: string = import.meta.env.VITE_AWC_URL || '/proxy/awc/api/data';
const RAINVIEWER: string = import.meta.env.VITE_RAINVIEWER_URL || '/proxy/rainviewer/public/weather-maps.json';

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
