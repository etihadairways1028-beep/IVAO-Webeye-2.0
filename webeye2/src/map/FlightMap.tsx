import { useEffect, useRef } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapController } from './controller';
import { useStore } from '../state/store';
import { fetchRadarFrame } from '../data/weather';
import { getAirport } from '../data/airports';

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
      onView: (b) => useStore.setState({ viewBounds: b }),
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
