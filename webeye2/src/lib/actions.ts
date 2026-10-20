import { useStore } from '../state/store';
import type { Controller, Flight } from '../types';
import { getAirport } from '../data/airports';

/** Select a flight and frame it (with its departure/arrival when known). */
export function selectFlight(f: Flight, opts: { frame?: 'route' | 'aircraft'; follow?: boolean } = {}) {
  const s = useStore.getState();
  s.select({ kind: 'flight', key: f.key }, { follow: opts.follow });
  const frame = opts.frame ?? 'aircraft';
  if (frame === 'route') {
    const pts: [number, number][] = [[f.lon, f.lat]];
    for (const a of [getAirport(f.dep), getAirport(f.arr)]) if (a) pts.push([a.lon, a.lat]);
    if (pts.length > 1) {
      // Keep longitudes continuous relative to the aircraft so the box doesn't span the globe.
      const lons = pts.map(([lo]) => (lo - f.lon > 180 ? lo - 360 : lo - f.lon < -180 ? lo + 360 : lo));
      const lats = pts.map(([, la]) => la);
      s.camera_({ type: 'fit', bounds: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], maxZoom: 8 });
      return;
    }
  }
  s.camera_({ type: 'fly', center: [f.lon, f.lat], zoom: Math.max(6.5, 0) });
}

export function selectController(c: Controller) {
  const s = useStore.getState();
  s.select({ kind: 'atc', key: c.key });
  if (c.lat != null && c.lon != null) s.camera_({ type: 'fly', center: [c.lon, c.lat], zoom: c.position === 'APP' || c.position === 'DEP' ? 7.5 : 9.5 });
}

export function selectAirport(icao: string, fly = true) {
  const s = useStore.getState();
  s.select({ kind: 'airport', icao });
  s.setPanel('airports');
  const a = getAirport(icao);
  if (a && fly) s.camera_({ type: 'fly', center: [a.lon, a.lat], zoom: a.size === 3 ? 10 : 10.5 });
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    useStore.getState().notify(`Copied ${text}`);
  } catch {
    useStore.getState().notify('Clipboard unavailable in this browser');
  }
}

export function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
  else document.documentElement.requestFullscreen?.().catch(() => useStore.getState().notify('Fullscreen not available'));
}
