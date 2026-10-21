import { useEffect, useRef } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapController } from './controller';
import { useStore } from '../state/store';
import { fetchRadarFrame } from '../data/weather';
import { allAirports, getAirport } from '../data/airports';
import { fetchSessionTrack, type TrackPoint } from '../data/ivao';
import { chartState, loadChart, onChartsChange } from '../data/charts';

/** Zoomed in on an airport (any airport, ATC or not)? Load its ground chart automatically. */
let chartTimer = 0;
function autoChart(b: [number, number, number, number], zoom: number) {
  window.clearTimeout(chartTimer);
  if (zoom < 11.2) return;
  chartTimer = window.setTimeout(() => {
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    const k = Math.cos((cy * Math.PI) / 180);
    const inView = allAirports().filter((a) => a.lon >= b[0] && a.lon <= b[2] && a.lat >= b[1] && a.lat <= b[3]);
    inView.sort((a, z) => ((a.lon - cx) * k) ** 2 + (a.lat - cy) ** 2 - (((z.lon - cx) * k) ** 2 + (z.lat - cy) ** 2));
    // Nearest airport first, plus a neighbour when two fields share the view; skip ones already tried.
    for (const a of inView.slice(0, 2)) if (!chartState(a.icao)) loadChart(a.icao);
  }, 700);
}

let controller: MapController | null = null;
export const getMapController = () => controller;

/**
 * Hosts the MapLibre map. Aircraft positions flow store → controller via
 * subscriptions, so React never re-renders on position updates.
 */
export function FlightMap() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const st = useStore.getState();
    const c = new MapController(ref.current!, st.prefs, {
      onSelect: (s) => {
        const store = useStore.getState();
        store.select(s);
        if (s?.kind === 'airport') store.setPanel('airports');
        if (s?.kind === 'atc') store.setPanel('atc');
      },
      onView: (b, zoom) => {
        useStore.setState({ viewBounds: b });
        autoChart(b, zoom);
      },
      onStyleFallback: (msg) => useStore.getState().notify(msg),
      onUserMove: () => {
        if (useStore.getState().follow) useStore.getState().setFollow(false);
      },
    });
    controller = c;
    c.setMyVid(st.prefs.myVid);
    if (st.airportsReady) c.setAirportsLoaded();

    const unsub = useStore.subscribe((s, p) => {
      if (s.controllers !== p.controllers) c.setControllers(s.controllers);
      if (s.taxi !== p.taxi) c.setTaxi(s.taxi?.route ?? null);
      if (s.selection !== p.selection || s.showRoute !== p.showRoute) c.setSelection(s.selection, s.showRoute);
      if (s.follow !== p.follow) c.setFollow(s.follow);
      if (s.plan !== p.plan) c.setPlan(s.plan);
      if (s.prefs !== p.prefs) {
        c.setPrefs(s.prefs);
        if (s.prefs.myVid !== p.prefs.myVid) c.setMyVid(s.prefs.myVid);
      }
      if (s.airportsReady && !p.airportsReady) c.setAirportsLoaded();
      if (s.camera && s.camera !== p.camera) {
        const cam = s.camera;
        if (cam.type === 'fly') c.flyTo(cam.center, cam.zoom);
        else if (cam.type === 'fit') c.fit(cam.bounds, cam.maxZoom);
        else c.world();
      }
      // A selected airport's runways are drawn from OurAirports thresholds.
      if (s.selection !== p.selection && s.selection?.kind !== 'airport') c.setRunways([]);
    });
    return () => {
      unsub();
      c.destroy();
      controller = null;
    };
  }, []);

  // Full session track ("from the gate") for the selected live flight; refreshed each minute.
  const selKey = useStore((s) => (s.selection?.kind === 'flight' ? s.selection.key : null));
  useEffect(() => {
    if (!selKey) return;
    const f = useStore.getState().flightMap.get(selKey);
    if (!f || f.demo || f.sessionId <= 0) return;
    let alive = true;
    const ctrl = new AbortController();
    let pts: TrackPoint[] = [];
    // First the whole track, then only newer points every 2 minutes.
    const load = () => {
      const last = pts.length ? pts[pts.length - 1].t : null;
      const since = last ? new Date(last).getTime() : undefined;
      return fetchSessionTrack(f.sessionId, ctrl.signal, since)
        .then(({ points, source }) => {
          if (!alive) return;
          pts = since && source === 'recorder' ? [...pts, ...points] : points;
          controller?.setTrack(pts);
          useStore.setState({ trackInfo: { key: selKey, points: pts.length, error: null, source } });
        })
        .catch((e) => alive && !pts.length && useStore.setState({ trackInfo: { key: selKey, points: 0, error: e instanceof Error ? e.message : String(e), source: null } }));
    };
    load();
    const id = window.setInterval(load, 120000);
    return () => {
      alive = false;
      ctrl.abort();
      window.clearInterval(id);
    };
  }, [selKey]);

  // Airport ground charts: selected airport, or the airport a selected aircraft is at / near.
  useEffect(() => onChartsChange(() => controller?.refreshCharts()), []);
  const selAirport = useStore((s) => (s.selection?.kind === 'airport' ? s.selection.icao : null));
  useEffect(() => {
    if (selAirport) loadChart(selAirport);
  }, [selAirport]);
  const nearIcao = useStore((s) => {
    const sel = s.selection;
    const f = sel?.kind === 'flight' ? s.flightMap.get(sel.key) : undefined;
    if (!f) return null;
    if (f.onGround || (f.departureDistance ?? 99) < 8) return f.dep ?? null;
    if ((f.arrivalDistance ?? 99) < 25) return f.arr ?? null;
    return null;
  });
  useEffect(() => {
    if (nearIcao && getAirport(nearIcao)) loadChart(nearIcao);
  }, [nearIcao]);

  // Weather radar frame: refreshed every 10 minutes while the layer is on.
  const weatherOn = useStore((s) => s.prefs.layers.weather);
  useEffect(() => {
    if (!weatherOn) return;
    let alive = true;
    const ctrl = new AbortController();
    const load = () =>
      fetchRadarFrame(ctrl.signal)
        .then((f) => {
          if (!alive) return;
          controller?.setRadarFrame(f);
          useStore.setState({ wxTime: f?.time ?? null, wxError: f ? null : 'No radar frame available' });
        })
        .catch((e) => alive && useStore.setState({ wxError: e instanceof Error ? e.message : 'Weather radar unavailable' }));
    load();
    const id = window.setInterval(load, 600000);
    return () => {
      alive = false;
      ctrl.abort();
      window.clearInterval(id);
    };
  }, [weatherOn]);

  return <div ref={ref} className="map" role="application" aria-label="Live traffic map" />;
}

export function focusAirport(icao: string) {
  const a = getAirport(icao);
  if (a) useStore.getState().camera_({ type: 'fly', center: [a.lon, a.lat], zoom: 10.5 });
}
