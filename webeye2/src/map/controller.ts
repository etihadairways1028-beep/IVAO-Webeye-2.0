import maplibregl, { type GeoJSONSource, type Map as MLMap, type ExpressionSpecification, type StyleSpecification } from 'maplibre-gl';
import type { Controller, Flight, SimbriefPlan } from '../types';
import type { LabelMode, MapStyleId, Prefs, Selection } from '../state/store';
import { addAircraftIcons } from './icons';
import { FONT_BOLD, FONT_REG, offlineStyle, styleFor, tintDark } from './styles';
import { allAirports, getAirport } from '../data/airports';
import { trails } from '../data/feed';
import { circle, destination, greatCircle, unwrap } from '../lib/geo';
import { fmtAltShort } from '../lib/format';
import type { RadarFrame } from '../data/weather';

type FC = GeoJSON.FeatureCollection;
const EMPTY: FC = { type: 'FeatureCollection', features: [] };

export const ATC_COLORS: Record<string, string> = { DEL: '#a78bfa', GND: '#34d399', TWR: '#f87171', APP: '#60a5fa', DEP: '#38bdf8', CTR: '#fbbf24', FSS: '#fbbf24', RMP: '#34d399', OTHER: '#94a3b8' };
const RING_NM: Record<string, number> = { TWR: 12, APP: 40, DEP: 35 };

export const ALT_RAMP: [number, string][] = [[0, '#9aa6bd'], [3000, '#ff8f4d'], [10000, '#ffd166'], [20000, '#6ee7a8'], [30000, '#4cc9f0'], [40000, '#b69cff']];

export interface MapCallbacks {
  onSelect: (s: Selection) => void;
  onView: (b: [number, number, number, number], zoom: number) => void;
  onStyleFallback: (msg: string) => void;
  onUserMove: () => void;
}

export class MapController {
  map: MLMap;
  private styleId: MapStyleId;
  private prefs: Prefs;
  private flights: Flight[] = [];
  private fetchedAt = Date.now();
  private controllers: Controller[] = [];
  private selection: Selection = null;
  private myVid: number | null = null;
  private plan: SimbriefPlan | null = null;
  private showRoute = true;
  private follow = false;
  private radar: RadarFrame | null = null;
  private runways: FC = EMPTY;
  private airportsLoaded = false;
  private tickHandle = 0;
  private popup: maplibregl.Popup;
  private hoverKey: string | null = null;
  private styleTimer = 0;
  private destroyed = false;
  private cb: MapCallbacks;

  constructor(container: HTMLElement, prefs: Prefs, cb: MapCallbacks) {
    this.prefs = prefs;
    this.styleId = prefs.mapStyle;
    this.cb = cb;
    this.map = new maplibregl.Map({
      container,
      style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#070b13' } }] },
      center: [32, 34],
      zoom: window.innerWidth < 700 ? 1.6 : 2.6,
      minZoom: 1.2,
      maxZoom: 16,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      fadeDuration: 150,
    });
    this.map.setStyle(styleFor(this.styleId), { diff: false, transformStyle: (_p, n) => this.transform(n) });
    this.map.touchZoomRotate.disableRotation();
    this.popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: 'map-tip', maxWidth: '260px' });
    this.map.on('style.load', () => {
      window.clearTimeout(this.styleTimer);
      this.install();
    });
    this.watchStyle();
    this.bindEvents();
    this.tick = this.tick.bind(this);
    this.tickHandle = window.setTimeout(this.tick, 1000);
  }

  destroy() {
    this.destroyed = true;
    window.clearTimeout(this.tickHandle);
    window.clearTimeout(this.styleTimer);
    this.popup.remove();
    this.map.remove();
  }

  private transform(next: StyleSpecification): StyleSpecification {
    return this.styleId === 'dark' ? tintDark(next) : next;
  }

  /** If a remote basemap does not load in time, fall back to the offline radar basemap. */
  private watchStyle() {
    window.clearTimeout(this.styleTimer);
    if (this.styleId === 'radar') return;
    this.styleTimer = window.setTimeout(() => {
      if (!this.map.isStyleLoaded() && !this.destroyed) {
        // Keep the chosen look using the bundled Natural Earth basemap.
        this.map.setStyle(offlineStyle(this.styleId === 'standard' ? 'light' : 'dark'), { diff: false });
        this.cb.onStyleFallback(`${this.styleId === 'satellite' ? 'Satellite imagery' : 'Basemap provider'} unreachable — using the offline basemap.`);
      }
    }, 9000);
  }

  setStyle(id: MapStyleId) {
    if (id === this.styleId) return;
    this.styleId = id;
    this.map.setStyle(styleFor(id), { diff: false, transformStyle: (_p, n) => this.transform(n) });
    this.watchStyle();
  }

  // ───────── overlays

  private get dark() {
    return this.styleId !== 'standard';
  }

  private baseColor(): string {
    if (this.styleId === 'radar') return '#7cf2b4';
    if (this.styleId === 'standard') return '#1e40af';
    return '#e3ebff';
  }

  private aircraftColor(): ExpressionSpecification {
    const base: ExpressionSpecification =
      this.prefs.colorBy === 'altitude'
        ? (['interpolate', ['linear'], ['get', 'alt'], ...ALT_RAMP.flat()] as unknown as ExpressionSpecification)
        : (['case', ['get', 'gnd'], this.styleId === 'standard' ? '#64748b' : '#7d8aa5', this.baseColor()] as ExpressionSpecification);
    return ['case', ['get', 'sel'], '#ffb547', ['get', 'mine'], '#3ff0d0', base];
  }

  private labelExpr(mode: LabelMode): ExpressionSpecification {
    const full: ExpressionSpecification = ['concat', ['get', 'cs'], '\n', ['get', 'fl'], ' ', ['get', 'gs']];
    const normal: ExpressionSpecification = mode === 'off' ? ['literal', ''] : mode === 'callsign' ? ['get', 'cs'] : full;
    return ['case', ['any', ['get', 'sel'], ['get', 'mine']], full, normal];
  }

  private install() {
    const m = this.map;
    // Skip the placeholder style and avoid double installs on the same style.
    if (!m.getStyle()?.glyphs || m.getLayer('aircraft')) return;
    addAircraftIcons(m);
    const dark = this.dark;
    const textColor = dark ? '#d6def0' : '#172033';
    const halo = dark ? 'rgba(3,6,12,0.92)' : 'rgba(255,255,255,0.95)';
    const src = (id: string, data: FC = EMPTY, extra: Record<string, unknown> = {}) => {
      if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data, ...extra } as maplibregl.GeoJSONSourceSpecification);
    };

    // Weather radar (RainViewer) sits directly above the basemap.
    if (this.radar && this.prefs.layers.weather) this.addWeather();

    src('atc-rings');
    m.addLayer({ id: 'atc-ring-fill', type: 'fill', source: 'atc-rings', layout: { visibility: this.vis('atc') }, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['get', 'sel'], 0.07, 0.04] } });
    m.addLayer({ id: 'atc-ring-line', type: 'line', source: 'atc-rings', layout: { visibility: this.vis('atc') }, paint: { 'line-color': ['get', 'color'], 'line-opacity': ['case', ['get', 'sel'], 0.95, 0.45], 'line-width': ['case', ['get', 'sel'], 1.6, 0.8] } });

    src('runways', this.runways);
    m.addLayer({ id: 'runways', type: 'line', source: 'runways', minzoom: 9, layout: { 'line-cap': 'butt' }, paint: { 'line-color': dark ? '#9fb4d8' : '#334155', 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 9, 2, 14, 18] } });
    m.addLayer({ id: 'runway-labels', type: 'symbol', source: 'runways', minzoom: 11, layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'name'], 'text-font': FONT_BOLD, 'text-size': 11, 'text-keep-upright': true }, paint: { 'text-color': textColor, 'text-halo-color': halo, 'text-halo-width': 1.4 } });

    src('airports');
    m.addLayer({ id: 'airports', type: 'circle', source: 'airports', layout: { visibility: this.vis('airports') }, filter: ['any', ['>=', ['get', 'size'], 3], ['all', ['>=', ['get', 'size'], 2], ['>=', ['zoom'], 5.5]], ['>=', ['zoom'], 8]], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 1.4, 8, 3.5], 'circle-color': dark ? '#5b6b8c' : '#64748b', 'circle-stroke-width': 0, 'circle-opacity': 0.8 } });
    m.addLayer({ id: 'airport-labels', type: 'symbol', source: 'airports', layout: { visibility: this.vis('airports'), 'text-field': ['get', 'icao'], 'text-font': FONT_REG, 'text-size': 10, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-optional': true }, filter: ['any', ['all', ['>=', ['get', 'size'], 3], ['>=', ['zoom'], 5]], ['all', ['>=', ['get', 'size'], 2], ['>=', ['zoom'], 7.5]], ['>=', ['zoom'], 10]], paint: { 'text-color': dark ? '#7f8db0' : '#475569', 'text-halo-color': halo, 'text-halo-width': 1 } });

    src('atc');
    m.addLayer({ id: 'atc', type: 'circle', source: 'atc', layout: { visibility: this.vis('atc') }, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 4, 8, 7], 'circle-color': dark ? '#0b1222' : '#ffffff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': ['case', ['get', 'sel'], 3, 2] } });
    m.addLayer({ id: 'atc-labels', type: 'symbol', source: 'atc', minzoom: 3.2, layout: { visibility: this.vis('atc'), 'text-field': ['get', 'label'], 'text-font': FONT_BOLD, 'text-size': 10.5, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true, 'text-letter-spacing': 0.04 }, paint: { 'text-color': ['get', 'color'], 'text-halo-color': halo, 'text-halo-width': 1.3 } });

    src('plan');
    m.addLayer({ id: 'plan-line', type: 'line', source: 'plan', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#3ff0d0', 'line-width': 2.2, 'line-opacity': 0.9 } });
    m.addLayer({ id: 'plan-fixes', type: 'circle', source: 'plan', filter: ['==', ['geometry-type'], 'Point'], minzoom: 4, paint: { 'circle-radius': 2.6, 'circle-color': dark ? '#04131a' : '#fff', 'circle-stroke-color': '#3ff0d0', 'circle-stroke-width': 1.4 } });
    m.addLayer({ id: 'plan-fix-labels', type: 'symbol', source: 'plan', filter: ['==', ['geometry-type'], 'Point'], minzoom: 5.5, layout: { 'text-field': ['get', 'ident'], 'text-font': FONT_REG, 'text-size': 9.5, 'text-offset': [0.7, 0], 'text-anchor': 'left', 'text-optional': true }, paint: { 'text-color': '#8ff7e4', 'text-halo-color': halo, 'text-halo-width': 1 } });

    src('route');
    m.addLayer({ id: 'route-ref', type: 'line', source: 'route', filter: ['==', ['get', 'kind'], 'ref'], paint: { 'line-color': dark ? '#ffffff' : '#0f172a', 'line-opacity': 0.22, 'line-width': 1.2, 'line-dasharray': [2, 3] } });
    m.addLayer({ id: 'route-remaining', type: 'line', source: 'route', filter: ['==', ['get', 'kind'], 'remaining'], paint: { 'line-color': '#ffb547', 'line-opacity': 0.75, 'line-width': 1.6, 'line-dasharray': [1.5, 2] } });
    m.addLayer({ id: 'route-trail', type: 'line', source: 'route', filter: ['==', ['get', 'kind'], 'trail'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffb547', 'line-width': 2.4, 'line-opacity': 0.95 } });
    m.addLayer({ id: 'route-ends', type: 'circle', source: 'route', filter: ['==', ['get', 'kind'], 'end'], paint: { 'circle-radius': 5, 'circle-color': dark ? '#0b1222' : '#fff', 'circle-stroke-color': '#ffb547', 'circle-stroke-width': 2 } });
    m.addLayer({ id: 'route-end-labels', type: 'symbol', source: 'route', filter: ['==', ['get', 'kind'], 'end'], layout: { 'text-field': ['get', 'icao'], 'text-font': FONT_BOLD, 'text-size': 11.5, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-allow-overlap': true }, paint: { 'text-color': '#ffcf85', 'text-halo-color': halo, 'text-halo-width': 1.5 } });

    src('history');
    m.addLayer({ id: 'history', type: 'circle', source: 'history', layout: { visibility: this.styleId === 'radar' && this.prefs.layers.trails ? 'visible' : 'none' }, paint: { 'circle-radius': 1.4, 'circle-color': '#7cf2b4', 'circle-opacity': ['get', 'o'] } });

    src('aircraft');
    m.addLayer({ id: 'sel-halo', type: 'circle', source: 'aircraft', filter: ['any', ['get', 'sel'], ['get', 'mine']], paint: { 'circle-radius': 17, 'circle-color': ['case', ['get', 'sel'], 'rgba(255,181,71,0.14)', 'rgba(63,240,208,0.12)'], 'circle-stroke-color': ['case', ['get', 'sel'], 'rgba(255,181,71,0.7)', 'rgba(63,240,208,0.6)'], 'circle-stroke-width': 1.2 } });
    m.addLayer({
      id: 'aircraft',
      type: 'symbol',
      source: 'aircraft',
      layout: {
        'icon-image': this.styleId === 'radar' ? 'ac-radar' : ['match', ['get', 'wake'], 'L', 'ac-L', 'H', 'ac-H', 'J', 'ac-J', 'ac-M'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 1.5, this.styleId === 'radar' ? 0.42 : 0.5, 6, this.styleId === 'radar' ? 0.6 : 0.78, 11, 1.05],
        'icon-rotate': ['get', 'hdg'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'symbol-sort-key': ['case', ['get', 'sel'], 2, ['get', 'mine'], 1, 0],
        'text-field': this.labelExpr(this.styleId === 'radar' && this.prefs.labels === 'off' ? 'callsign' : this.prefs.labels),
        'text-font': FONT_BOLD,
        'text-size': this.styleId === 'radar' ? 10 : 10.5,
        'text-anchor': 'left',
        'text-offset': [1.3, 0],
        'text-justify': 'left',
        'text-line-height': 1.15,
        'text-optional': true,
        'text-padding': 1,
      },
      paint: {
        'icon-color': this.aircraftColor(),
        'icon-halo-color': this.dark ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.9)',
        'icon-halo-width': 1,
        'text-color': ['case', ['get', 'sel'], '#ffcf85', ['get', 'mine'], '#8ff7e4', this.styleId === 'radar' ? '#9df5c6' : textColor],
        'text-halo-color': halo,
        'text-halo-width': 1.4,
      },
    });

    m.addLayer({ id: 'airport-sel', type: 'circle', source: 'route', filter: ['==', ['get', 'kind'], 'airport'], paint: { 'circle-radius': 14, 'circle-color': 'rgba(125,180,255,0.12)', 'circle-stroke-color': '#7db4ff', 'circle-stroke-width': 1.6 } });

    this.pushAirports();
    this.pushAtc();
    this.pushRoute();
    this.pushPlan();
    this.pushAircraft();
  }

  private vis(layer: keyof Prefs['layers']): 'visible' | 'none' {
    return this.prefs.layers[layer] ? 'visible' : 'none';
  }

  private addWeather() {
    const m = this.map;
    if (!this.radar || m.getSource('wx')) return;
    m.addSource('wx', {
      type: 'raster',
      tiles: [`${this.radar.host}${this.radar.path}/256/{z}/{x}/{y}/4/1_1.png`],
      tileSize: 256,
      maxzoom: 7,
      attribution: '<a href="https://www.rainviewer.com/api.html" target="_blank" rel="noopener">RainViewer</a>',
    });
    const before = m.getLayer('atc-ring-fill') ? 'atc-ring-fill' : undefined;
    m.addLayer({ id: 'wx', type: 'raster', source: 'wx', paint: { 'raster-opacity': 0.62, 'raster-fade-duration': 300 } }, before);
  }

  private removeWeather() {
    if (this.map.getLayer('wx')) this.map.removeLayer('wx');
    if (this.map.getSource('wx')) this.map.removeSource('wx');
  }

  private set(id: string, data: FC) {
    (this.map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
  }

  // ───────── data pushes

  private pos(f: Flight, now: number): [number, number] {
    if (f.onGround || f.groundSpeed == null || f.heading == null || f.groundSpeed < 40) return [f.lon, f.lat];
    // Dead-reckon between feed updates (display only; panels show reported values).
    const dt = Math.min(45, Math.max(0, (now - this.fetchedAt) / 1000));
    const [la, lo] = destination(f.lat, f.lon, f.heading, (f.groundSpeed * dt) / 3600);
    return [lo, la];
  }

  private selectedFlight(): Flight | undefined {
    const s = this.selection;
    return s?.kind === 'flight' ? this.flights.find((f) => f.key === s.key) : undefined;
  }

  private pushAircraft() {
    if (!this.map.getSource('aircraft')) return;
    const now = Date.now();
    const sel = this.selection?.kind === 'flight' ? this.selection.key : null;
    const features: GeoJSON.Feature[] = this.flights.map((f) => ({
      type: 'Feature',
      id: f.sessionId > 0 ? f.sessionId : undefined,
      geometry: { type: 'Point', coordinates: this.pos(f, now) },
      properties: {
        key: f.key,
        cs: f.callsign,
        fl: f.onGround ? 'GND' : fmtAltShort(f.altitude),
        gs: f.groundSpeed != null ? String(Math.round(f.groundSpeed)) : '',
        alt: f.onGround ? 0 : f.altitude ?? 0,
        hdg: f.heading ?? 0,
        wake: f.wake,
        gnd: f.onGround,
        sel: f.key === sel,
        mine: this.myVid != null && f.vid === this.myVid,
      },
    }));
    this.set('aircraft', { type: 'FeatureCollection', features });
  }

  private pushHistory() {
    if (!this.map.getSource('history') || this.styleId !== 'radar') return;
    const features: GeoJSON.Feature[] = [];
    for (const [, t] of trails) {
      const n = Math.min(6, t.length - 1);
      for (let i = 1; i <= n; i++) {
        const p = t[t.length - 1 - i];
        features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p[0], p[1]] }, properties: { o: 0.75 - i * 0.1 } });
      }
    }
    this.set('history', { type: 'FeatureCollection', features });
  }

  private pushAirports() {
    if (!this.map.getSource('airports') || !this.airportsLoaded) return;
    const features: GeoJSON.Feature[] = allAirports().map((a) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [a.lon, a.lat] }, properties: { icao: a.icao, size: a.size } }));
    this.set('airports', { type: 'FeatureCollection', features });
  }

  private pushAtc() {
    if (!this.map.getSource('atc')) return;
    const groups = new Map<string, Controller[]>();
    for (const c of this.controllers) {
      if (c.lat == null || c.lon == null) continue;
      const k = c.airport && c.locationSource === 'airport' ? c.airport : c.key;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(c);
    }
    const sel = this.selection;
    const order = ['CTR', 'APP', 'DEP', 'TWR', 'GND', 'DEL', 'RMP', 'FSS', 'OTHER'];
    const points: GeoJSON.Feature[] = [];
    const rings: GeoJSON.Feature[] = [];
    for (const [k, list] of groups) {
      list.sort((a, b) => order.indexOf(a.position) - order.indexOf(b.position));
      const top = list[0];
      const isSel = (sel?.kind === 'atc' && list.some((c) => c.key === sel.key)) || (sel?.kind === 'airport' && sel.icao === top.airport);
      const label = top.airport && list.length > 0 && top.locationSource === 'airport' ? `${top.airport} ${[...new Set(list.map((c) => c.position))].join('·')}` : top.callsign;
      points.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [top.lon!, top.lat!] }, properties: { key: list.length === 1 ? top.key : '', airport: top.airport ?? '', label, color: ATC_COLORS[top.position], sel: isSel } });
      for (const c of list) {
        const r = RING_NM[c.position];
        if (!r) continue;
        rings.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [circle(c.lat!, c.lon!, r)] }, properties: { color: ATC_COLORS[c.position], sel: isSel || (sel?.kind === 'atc' && sel.key === c.key) } });
      }
      void k;
    }
    this.set('atc', { type: 'FeatureCollection', features: points });
    this.set('atc-rings', { type: 'FeatureCollection', features: rings });
  }

  private pushRoute() {
    if (!this.map.getSource('route')) return;
    const features: GeoJSON.Feature[] = [];
    const f = this.selectedFlight();
    if (f && this.showRoute) {
      const dep = getAirport(f.dep);
      const arr = getAirport(f.arr);
      const [lon, lat] = this.pos(f, Date.now());
      if (dep && arr && !this.plan) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: greatCircle(dep.lat, dep.lon, arr.lat, arr.lon, 96) }, properties: { kind: 'ref' } });
      if (arr && !f.onGround) {
        const rem = greatCircle(lat, lon, arr.lat, arr.lon, 48);
        features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: rem }, properties: { kind: 'remaining' } });
      }
      const t = trails.get(f.key);
      if (t && t.length > 1) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: unwrap([...t.map((p) => [p[0], p[1]] as [number, number]), [lon, lat]]) }, properties: { kind: 'trail' } });
      for (const a of [dep, arr]) if (a) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [a.lon, a.lat] }, properties: { kind: 'end', icao: a.icao } });
    }
    const s = this.selection;
    if (s?.kind === 'airport') {
      const a = getAirport(s.icao);
      if (a) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [a.lon, a.lat] }, properties: { kind: 'airport' } });
    }
    this.set('route', { type: 'FeatureCollection', features });
  }

  private pushPlan() {
    if (!this.map.getSource('plan')) return;
    const p = this.plan;
    if (!p) return this.set('plan', EMPTY);
    const pts: [number, number][] = [[p.origin.lon, p.origin.lat], ...p.fixes.map((x) => [x.lon, x.lat] as [number, number]), [p.destination.lon, p.destination.lat]];
    // Densify each leg along the great circle so long oceanic legs curve correctly.
    const line: [number, number][] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const seg = greatCircle(pts[i][1], pts[i][0], pts[i + 1][1], pts[i + 1][0], 12);
      line.push(...(i ? seg.slice(1) : seg));
    }
    const features: GeoJSON.Feature[] = [{ type: 'Feature', geometry: { type: 'LineString', coordinates: unwrap(line) }, properties: {} }];
    for (const x of p.fixes) if (x.type !== 'apt' && x.ident !== 'TOC' && x.ident !== 'TOD') features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [x.lon, x.lat] }, properties: { ident: x.ident } });
    this.set('plan', { type: 'FeatureCollection', features });
  }

  // ───────── public setters

  setFlights(flights: Flight[], fetchedAt: number | null) {
    this.flights = flights;
    this.fetchedAt = fetchedAt ?? Date.now();
    this.pushAircraft();
    this.pushRoute();
    this.pushHistory();
  }

  setControllers(c: Controller[]) {
    this.controllers = c;
    this.pushAtc();
  }

  setSelection(s: Selection, showRoute: boolean) {
    this.selection = s;
    this.showRoute = showRoute;
    this.pushAircraft();
    this.pushRoute();
    this.pushAtc();
  }

  setFollow(f: boolean) {
    this.follow = f;
  }

  setMyVid(v: string) {
    const n = Number(v);
    this.myVid = v && Number.isFinite(n) ? n : null;
    this.pushAircraft();
  }

  setPlan(p: SimbriefPlan | null) {
    this.plan = p;
    this.pushPlan();
    this.pushRoute();
  }

  setAirportsLoaded() {
    this.airportsLoaded = true;
    this.pushAirports();
  }

  setRunways(rw: { name: string; coords: [number, number, number, number] }[]) {
    this.runways = { type: 'FeatureCollection', features: rw.map((r) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[r.coords[1], r.coords[0]], [r.coords[3], r.coords[2]]] }, properties: { name: r.name } })) };
    this.set('runways', this.runways);
  }

  setRadarFrame(frame: RadarFrame | null) {
    this.radar = frame;
    if (!this.map.isStyleLoaded()) return;
    this.removeWeather();
    if (frame && this.prefs.layers.weather) this.addWeather();
  }

  setPrefs(p: Prefs) {
    const prev = this.prefs;
    this.prefs = p;
    if (p.mapStyle !== this.styleId) {
      this.setStyle(p.mapStyle);
      return; // style.load reinstalls everything with the new prefs
    }
    const m = this.map;
    if (!m.getLayer('aircraft')) return;
    if (prev.labels !== p.labels) m.setLayoutProperty('aircraft', 'text-field', this.labelExpr(this.styleId === 'radar' && p.labels === 'off' ? 'callsign' : p.labels));
    if (prev.colorBy !== p.colorBy) m.setPaintProperty('aircraft', 'icon-color', this.aircraftColor());
    for (const [key, layers] of [['airports', ['airports', 'airport-labels']], ['atc', ['atc', 'atc-labels', 'atc-ring-fill', 'atc-ring-line']]] as const) {
      for (const l of layers) if (m.getLayer(l)) m.setLayoutProperty(l, 'visibility', this.vis(key));
    }
    if (m.getLayer('history')) m.setLayoutProperty('history', 'visibility', this.styleId === 'radar' && p.layers.trails ? 'visible' : 'none');
    if (prev.layers.weather !== p.layers.weather) {
      if (p.layers.weather) this.addWeather();
      else this.removeWeather();
    }
  }

  // ───────── camera

  flyTo(center: [number, number], zoom?: number) {
    this.map.flyTo({ center, zoom: zoom ?? Math.max(this.map.getZoom(), 6.5), speed: 1.4, curve: 1.5, essential: true, padding: this.padding() });
  }

  fit(bounds: [[number, number], [number, number]], maxZoom = 8) {
    this.map.fitBounds(bounds, { padding: this.padding(70), maxZoom, duration: 1400, essential: true });
  }

  world() {
    this.map.flyTo({ center: [20, 25], zoom: window.innerWidth < 700 ? 1.3 : 2.1, speed: 1.6, essential: true, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
  }

  /** Keep the subject clear of floating panels. */
  padding(extra = 0) {
    const w = window.innerWidth;
    if (w < 760) return { top: 80 + extra, bottom: Math.round(window.innerHeight * 0.42) + extra, left: 20 + extra, right: 20 + extra };
    const st = document.documentElement.dataset;
    return { top: 80 + extra, bottom: 40 + extra, left: (st.leftPanel === '1' ? 440 : 90) + extra, right: (st.rightPanel === '1' ? 420 : 30) + extra };
  }

  // ───────── loop & events

  private tick() {
    if (this.destroyed) return;
    this.pushAircraft();
    const f = this.selectedFlight();
    if (f) {
      if (this.follow) this.map.easeTo({ center: this.pos(f, Date.now()), duration: 900, easing: (t) => t, padding: this.padding() });
      this.pushRoute();
    }
    const fast = this.map.getZoom() >= 8 || this.follow;
    this.tickHandle = window.setTimeout(this.tick, fast ? 250 : 1000);
  }

  private bindEvents() {
    const m = this.map;
    const clickable = ['aircraft', 'atc', 'airports'];
    m.on('click', (e) => {
      const layers = clickable.filter((l) => m.getLayer(l));
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]];
      const hits = m.queryRenderedFeatures(box, { layers });
      const ac = hits.find((h) => h.layer.id === 'aircraft');
      if (ac) return this.cb.onSelect({ kind: 'flight', key: String(ac.properties.key) });
      const atc = hits.find((h) => h.layer.id === 'atc');
      if (atc) {
        const p = atc.properties as { key: string; airport: string };
        return this.cb.onSelect(p.airport ? { kind: 'airport', icao: p.airport } : { kind: 'atc', key: p.key });
      }
      const ap = hits.find((h) => h.layer.id === 'airports');
      if (ap) return this.cb.onSelect({ kind: 'airport', icao: String(ap.properties.icao) });
    });
    m.on('mousemove', (e) => {
      const layers = clickable.filter((l) => m.getLayer(l));
      if (!layers.length) return;
      const hits = m.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers });
      m.getCanvas().style.cursor = hits.length ? 'pointer' : '';
      const ac = hits.find((h) => h.layer.id === 'aircraft');
      if (!ac || window.matchMedia('(hover: none)').matches) {
        if (this.hoverKey) this.popup.remove();
        this.hoverKey = null;
        return;
      }
      const key = String(ac.properties.key);
      const f = this.flights.find((x) => x.key === key);
      if (!f) return;
      if (key !== this.hoverKey) {
        this.hoverKey = key;
        const route = f.dep || f.arr ? `${f.dep ?? '····'} → ${f.arr ?? '····'}` : 'No flight plan';
        const el = document.createElement('div');
        el.innerHTML = `<div class="tip-cs"></div><div class="tip-row"></div><div class="tip-row mono"></div>`;
        el.children[0].textContent = f.callsign + (f.demo ? '  · DEMO' : '');
        el.children[1].textContent = `${f.aircraft ?? 'Type n/a'} · ${route}`;
        el.children[2].textContent = f.onGround ? 'On ground' : `${f.altitude != null ? (f.altitude >= 18000 ? 'FL' + fmtAltShort(f.altitude) : Math.round(f.altitude) + ' ft') : '—'} · ${f.groundSpeed ?? '—'} kt`;
        this.popup.setDOMContent(el);
      }
      this.popup.setLngLat(ac.geometry.type === 'Point' ? (ac.geometry.coordinates as [number, number]) : e.lngLat).addTo(m);
    });
    m.on('mouseout', () => {
      this.popup.remove();
      this.hoverKey = null;
    });
    const emitView = () => {
      const b = m.getBounds();
      this.cb.onView([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], m.getZoom());
    };
    m.on('moveend', emitView);
    m.on('load', emitView);
    m.on('dragstart', () => this.cb.onUserMove());
    m.on('error', (e) => {
      // Basemap/tile failures are non-fatal; keep the map responsive.
      if (import.meta.env.DEV) console.warn('[map]', e.error?.message ?? e);
    });
  }
}
