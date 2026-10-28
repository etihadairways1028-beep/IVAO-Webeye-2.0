// Cinematic tour: the camera glides from flight to flight on its own, tilted in 3D.
// Pairs with filming mode (H) for trailers and screensavers. Any manual pan stops it.
import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { getMapController } from '../map/FlightMap';
import { getAirport } from '../data/airports';
import { distanceNm } from './geo';
import type { Flight } from '../types';

const DWELL = 22000;

function pick(flights: Flight[], recent: string[]): Flight | null {
  const air = flights.filter((f) => !f.onGround && (f.groundSpeed ?? 0) > 120 && !recent.includes(f.key));
  if (!air.length) return null;
  // Prefer aircraft climbing out or on approach near an airport: the most cinematic moments.
  const near = air.filter((f) => (f.altitude ?? 0) < 14000 && [f.dep, f.arr].some((i) => {
    const a = getAirport(i);
    return a && distanceNm(f.lat, f.lon, a.lat, a.lon) < 60;
  }));
  const pool = near.length >= 3 && Math.random() < 0.75 ? near : air;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function startTour() {
  useStore.setState({ tour: true });
  useStore.getState().setPanel(null);
}
export function stopTour() {
  useStore.setState({ tour: false });
  const m = getMapController()?.map;
  m?.easeTo({ pitch: 0, bearing: 0, duration: 1200 });
}

export function useTour() {
  const tour = useStore((s) => s.tour);
  const follow = useStore((s) => s.follow);
  const recent = useRef<string[]>([]);
  const ours = useRef(0);
  useEffect(() => {
    if (!tour) return;
    let timer = 0;
    const next = () => {
      const st = useStore.getState();
      const f = pick(st.flights, recent.current);
      if (f) {
        recent.current = [f.key, ...recent.current].slice(0, 12);
        ours.current = Date.now();
        // Fly there first (follow mode would cut the tilt short), then lock on.
        st.select({ kind: 'flight', key: f.key }, { follow: false });
        const m = getMapController()?.map;
        const low = (f.altitude ?? 0) < 14000;
        m?.flyTo({ center: [f.lon, f.lat], zoom: low ? 9.2 : 7.4, pitch: low ? 58 : 48, bearing: ((f.heading ?? 0) - 25 + 360) % 360, speed: 0.55, curve: 1.6, essential: true });
        m?.once('moveend', () => {
          if (!useStore.getState().tour) return;
          ours.current = Date.now();
          useStore.getState().setFollow(true);
        });
      }
      timer = window.setTimeout(next, DWELL);
    };
    next();
    return () => window.clearTimeout(timer);
  }, [tour]);
  // A manual pan turns follow off: end the tour too (but not during our own camera moves).
  useEffect(() => {
    if (tour && !follow && Date.now() - ours.current > 3000) stopTour();
  }, [follow, tour]);
}
