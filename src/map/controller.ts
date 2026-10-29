import maplibregl, { type GeoJSONSource, type Map as MLMap, type ExpressionSpecification, type StyleSpecification } from 'maplibre-gl';
import type { Controller, Flight, SimbriefPlan } from '../types';
import type { LabelMode, MapStyleId, Prefs, Selection } from '../state/store';
import { addAircraftIcons } from './icons';
import { FONT_BOLD, FONT_REG, offlineStyle, styleFor, tintDark } from './styles';
import { allAirports, getAirport } from '../data/airports';
import { trails } from '../data/feed';
import { bearing, circle, destination, distanceNm, greatCircle, smoothPath, unwrap } from '../lib/geo';
import { fmtAltShort } from '../lib/format';
import { fetchMetarsInBox, type RadarFrame, type StationWx } from '../data/weather';
import { nightPolygon } from '../lib/sun';
import { accentHex } from '../lib/accent';
import type { TrackPoint } from '../data/ivao';
import { planPoints, progressAlong } from '../data/simbrief';
import { allCharts } from '../data/charts';
import { firForCallsign, firShapes, loadFirs } from '../data/firs';
import type { TaxiRoute } from '../lib/taxi';

type FC = GeoJSON.FeatureCollection;
/** Blend two #rrggbb colours. */
function mix(a: string, b: string, t: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  const c = [1, 3, 5].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * Math.max(0, Math.min(1, t))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
const EMPTY: FC = { type: 'FeatureCollection', features: [] };

export const ATC_COLORS: Record<string, string> = { DEL: '#a78bfa', GND: '#34d399', TWR: '#f87171', APP: '#60a5fa', DEP: '#38bdf8', CTR: '#fbbf24', FSS: '#fbbf24', RMP: '#34d399', OTHER: '#94a3b8' };
const RING_NM: Record<string, number> = { TWR: 12, APP: 40, DEP: 35 };

export const ROUTE_COLORS = { plan: '#8b5cf6', flown: '#ff4fc3', remaining: '#ff4fc3' };

export const ALT_RAMP: [number, string][] = [[0, '#9aa6bd'], [3000, '#ff8f4d'], [10000, '#ffd166'], [20000, '#6ee7a8'], [30000, '#4cc9f0'], [40000, '#b69cff']];

export interface MapCallbacks {
  onSelect: (s: Selection) => void;
  onView: (b: [number, number, number, number], zoom: number) => void;
  onStyleFallback: (msg: string) => void;
  onUserMove: () => void;
  onMeasure?: (p: { lon: number; lat: number; label: string }) => void;
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
  private track: TrackPoint[] | null = null;
  private taxi: TaxiRoute | null = null;
  private hoverFrame = 0;
  private destroyed = false;
  private cb: MapCallbacks;

  constructor(container: HTMLElement, prefs: Prefs, cb: MapCallbacks) {
    this.prefs = prefs;
    this.friendSet = new Set((prefs.friends ?? []).map((f) => f.vid));
    this.styleId = prefs.mapStyle;
    this.cb = cb;
    this.map = new maplibregl.Map({
      container,
      style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#070b13' } }] },
      center: [32, 34],
      zoom: window.innerWidth < 700 ? 1.6 : 2.6,
      minZoom: 1.2,
      maxZoom: 18,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      maxTileCacheSize: 200,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      fadeDuration: 0,
    });
    if (location.search.includes('mapdebug')) (window as unknown as { __map: MLMap }).__map = this.map;
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
    loadFirs()
      .then(() => {
        if (this.destroyed) return;
        this.set('firs', firShapes() ?? EMPTY);
        this.pushAtc();
      })
      .catch(() => undefined); // boundaries are optional; stations still show as badges
  }

  destroy() {
    this.destroyed = true;
    if (this.hoverFrame) cancelAnimationFrame(this.hoverFrame);
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
    return '#ffd23f';
  }

  private aircraftColor(): ExpressionSpecification {
    const base: ExpressionSpecification =
      this.prefs.colorBy === 'altitude'
        ? (['interpolate', ['linear'], ['get', 'alt'], ...ALT_RAMP.flat()] as unknown as ExpressionSpecification)
        : (['case', ['get', 'gnd'], this.styleId === 'standard' ? '#64748b' : '#7d8aa5', this.baseColor()] as ExpressionSpecification);
    return ['case', ['get', 'sel'], '#ff4fc3', ['get', 'mine'], this.accent(), ['get', 'friend'], '#b794ff', base];
  }

  /**
   * ATC-style data block: callsign / level (green climbing, amber descending) + groundspeed / type and destination.
   * 'auto' grows the block with zoom so the map never turns into a wall of text.
   */
  private labelExpr(mode: LabelMode): ExpressionSpecification {
    const radar = this.styleId === 'radar';
    const csCol = radar ? '#b6ffd5' : '#ffffff';
    const sub = radar ? '#9df5c6' : '#cfd8ea';
    const flCol = ['match', ['get', 'trend'], 'up', '#6ee7a8', 'down', '#ffb347', sub];
    const cs = ['format', ['get', 'cs'], { 'text-color': csCol }];
    const block = ['format', ['get', 'cs'], { 'text-color': csCol }, '\n', {}, ['get', 'fl'], { 'text-color': flCol, 'font-scale': 0.95 }, '  ', {}, ['get', 'gs'], { 'text-color': sub, 'font-scale': 0.95 }];
    const block3 = [...block, '\n', {}, ['get', 'info'], { 'text-color': radar ? '#7fcfa5' : '#93a3c0', 'font-scale': 0.85 }];
    const none = ['literal', ''];
    const pick = (normal: unknown) => ['case', ['any', ['get', 'sel'], ['get', 'mine'], ['get', 'friend']], block3, normal];
    let e: unknown;
    if (mode === 'off') e = pick(none);
    else if (mode === 'callsign') e = pick(cs);
    else if (mode === 'full') e = ['step', ['zoom'], pick(block), 6.5, pick(block3)];
    else e = ['step', ['zoom'], pick(none), 4, pick(cs), 5.6, pick(block), 7.5, pick(block3)];
    return e as ExpressionSpecification;
  }

  /** Box behind the data block, only where there is text (no empty boxes when zoomed out). */
  private boxExpr(mode: LabelMode): ExpressionSpecification {
    const box = ['case', ['get', 'sel'], 'box-sel', ['get', 'mine'], 'box-mine', 'box'];
    const pick = (normal: unknown) => ['case', ['any', ['get', 'sel'], ['get', 'mine']], box, normal];
    let e: unknown;
    if (mode === 'off') e = pick('');
    else if (mode === 'callsign' || mode === 'full') e = box;
    else e = ['step', ['zoom'], pick(''), 4, box];
    return e as ExpressionSpecification;
  }

  private addLabelBoxes() {
    const m = this.map;
    const mk = (id: string, fill: string, stroke: string) => {
      if (m.hasImage(id)) return;
      const S = 32;
      const c = document.createElement('canvas');
      c.width = c.height = S;
      const g = c.getContext('2d')!;
      g.fillStyle = fill;
      g.strokeStyle = stroke;
      g.lineWidth = 2;
      g.beginPath();
      g.roundRect(1, 1, S - 2, S - 2, 6);
      g.fill();
      g.stroke();
      m.addImage(id, g.getImageData(0, 0, S, S), { pixelRatio: 2, stretchX: [[8, 24]], stretchY: [[8, 24]], content: [6, 6, 26, 26] });
    };
    const radar = this.styleId === 'radar';
    mk('box', radar ? 'rgba(2,10,6,0.88)' : 'rgba(8,13,24,0.88)', radar ? 'rgba(90,200,140,0.45)' : 'rgba(120,145,190,0.45)');
    mk('box-sel', 'rgba(40,6,30,0.92)', '#ff4fc3');
    if (m.hasImage('box-mine')) m.removeImage('box-mine');
    mk('box-mine', 'rgba(8,13,24,0.92)', this.accent());
    for (const [k, col] of Object.entries(ATC_COLORS)) mk(`atc-${k}`, 'rgba(8,13,24,0.92)', col);
    mk('twy-box', '#f2c94c', '#141005');
  }

  private install() {
    const m = this.map;
    // Skip the placeholder style and avoid double installs on the same style.
    if (!m.getStyle()?.glyphs || m.getLayer('aircraft')) return;
    addAircraftIcons(m);
    this.addLabelBoxes();
    const dark = this.dark;
    const textColor = dark ? '#d6def0' : '#172033';
    const halo = dark ? 'rgba(3,6,12,0.92)' : 'rgba(255,255,255,0.95)';
    const src = (id: string, data: FC = EMPTY, extra: Record<string, unknown> = {}) => {
      if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data, ...extra } as maplibregl.GeoJSONSourceSpecification);
    };

    // Weather radar (RainViewer) sits directly above the basemap.
    if (this.radar && this.prefs.layers.weather) this.addWeather();

    // Lat/long graticule every 10°, like an en-route chart.
    if (this.styleId !== 'satellite') {
      const grid: GeoJSON.Feature[] = [];
      for (let lon = -180; lon <= 180; lon += 10) grid.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[lon, -85], [lon, 85]] }, properties: { l: `${Math.abs(lon)}°${lon < 0 ? 'W' : lon > 0 ? 'E' : ''}` } });
      for (let lat = -80; lat <= 80; lat += 10) grid.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: Array.from({ length: 37 }, (_, i) => [-180 + i * 10, lat]) }, properties: { l: `${Math.abs(lat)}°${lat < 0 ? 'S' : lat > 0 ? 'N' : ''}` } });
      src('graticule', { type: 'FeatureCollection', features: grid });
      m.addLayer({ id: 'graticule', type: 'line', source: 'graticule', paint: { 'line-color': dark ? '#2f5f8f' : '#94a3b8', 'line-width': 0.6, 'line-opacity': 0.45 } });
      m.addLayer({ id: 'graticule-labels', type: 'symbol', source: 'graticule', minzoom: 3, layout: { 'symbol-placement': 'line', 'symbol-spacing': 600, 'text-field': ['get', 'l'], 'text-font': FONT_REG, 'text-size': 9.5 }, paint: { 'text-color': dark ? '#4f86b8' : '#64748b', 'text-halo-color': halo, 'text-halo-width': 1 } });
    }

    // Night side of the Earth (and civil twilight), redrawn every minute.
    src('night', this.nightData());
    m.addLayer({ id: 'night', type: 'fill', source: 'night', layout: { visibility: this.vis('daynight') }, paint: { 'fill-color': dark ? '#000814' : '#0f172a', 'fill-opacity': ['match', ['get', 'offset'], 0, dark ? 0.32 : 0.12, dark ? 0.14 : 0.06], 'fill-antialias': false } });

    // Traffic density, for the world view.
    src('heat');
    m.addLayer({ id: 'heat', type: 'heatmap', source: 'heat', maxzoom: 7, layout: { visibility: this.vis('heatmap') }, paint: { 'heatmap-weight': 1, 'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 1, 0.7, 6, 1.4], 'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 1, 16, 4, 26, 6, 36], 'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 7, 0], 'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(20,184,166,0)', 0.15, 'rgba(20,184,166,0.18)', 0.4, 'rgba(34,211,238,0.38)', 0.7, 'rgba(250,204,21,0.55)', 1, 'rgba(251,113,133,0.75)'] } });

    // Weather at airports (METAR): flight category dots and wind.
    src('metar');
    m.addLayer({ id: 'metar', type: 'circle', source: 'metar', minzoom: 3.5, layout: { visibility: this.vis('metar') }, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3.5, 9, 7], 'circle-color': ['match', ['get', 'cat'], 'VFR', '#3ecf6e', 'MVFR', '#4c8dff', 'IFR', '#ff5c5c', 'LIFR', '#d946ef', '#8a96aa'], 'circle-opacity': 0.9, 'circle-stroke-color': dark ? '#04080f' : '#ffffff', 'circle-stroke-width': 1.2 } });
    src('metar-labels');
    m.addLayer({ id: 'metar-wind', type: 'symbol', source: 'metar-labels', minzoom: 6, layout: { visibility: this.vis('metar'), 'text-field': ['get', 'w'], 'text-font': FONT_BOLD, 'text-size': 10.5, 'text-offset': [0, -1.1], 'text-anchor': 'bottom', 'text-optional': true }, paint: { 'text-color': ['case', ['>=', ['get', 'spd'], 25], '#ffb547', dark ? '#d7e2ee' : '#1f2937'], 'text-halo-color': halo, 'text-halo-width': 1.4 } });

    // Airport ground chart (OpenStreetMap): drawn under everything else.
    src('chart', allCharts());
    const chartMin = 11.5;
    // Navigraph/Jeppesen-style diagram: pavement drawn to real width (w10 = metres→px at z10).
    const W = (min = 1) => ['interpolate', ['exponential', 2], ['zoom'], 10, ['max', min * 0.25, ['get', 'w10']], 20, ['*', ['get', 'w10'], 1024]] as unknown as ExpressionSpecification;
    const C = dark
      ? { apron: '#1a2230', bldg: '#2c3648', bldgLine: '#3d4a60', rwy: '#3a4250', rwyEdge: '#596273', twy: '#2a3240', twyEdge: '#3a4454', cl: '#f2c94c', standFill: '#0e151c' }
      : { apron: '#e4e7ec', bldg: '#c3c9d2', bldgLine: '#a3abb7', rwy: '#59606b', rwyEdge: '#3f454e', twy: '#cfd4db', twyEdge: '#b4bbc5', cl: '#c99a00', standFill: '#ffffff' };
    const isLine = ['==', ['geometry-type'], 'LineString'];
    const isPoly = ['==', ['geometry-type'], 'Polygon'];
    const isPt = ['==', ['geometry-type'], 'Point'];
    const kindIs = (...k: string[]) => (k.length === 1 ? ['==', ['get', 'kind'], k[0]] : ['in', ['get', 'kind'], ['literal', k]]);
    const F = (...c: unknown[]) => ['all', ...c] as unknown as maplibregl.FilterSpecification;
    m.addLayer({ id: 'chart-apron', type: 'fill', source: 'chart', minzoom: chartMin, filter: F(isPoly, kindIs('apron')), paint: { 'fill-color': C.apron, 'fill-opacity': 0.95 } });
    m.addLayer({ id: 'chart-bldg', type: 'fill', source: 'chart', minzoom: chartMin, filter: F(isPoly, kindIs('terminal', 'hangar')), paint: { 'fill-color': C.bldg, 'fill-outline-color': C.bldgLine } });
    // taxiways: edge, pavement, yellow centreline
    m.addLayer({ id: 'chart-twy-edge', type: 'line', source: 'chart', minzoom: chartMin, filter: F(isLine, kindIs('taxiway', 'taxilane')), layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': C.twyEdge, 'line-width': ['+', W(), 1.5] as unknown as ExpressionSpecification } });
    m.addLayer({ id: 'chart-taxiway', type: 'line', source: 'chart', minzoom: chartMin, filter: F(isLine, kindIs('taxiway', 'taxilane')), layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': C.twy, 'line-width': W() } });
    m.addLayer({ id: 'chart-twy-cl', type: 'line', source: 'chart', minzoom: 13, filter: F(isLine, kindIs('taxiway', 'taxilane')), layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': C.cl, 'line-opacity': ['match', ['get', 'kind'], 'taxilane', 0.55, 0.95], 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 16, 1.2, 19, 2.4] } });
    // runways: edge, pavement, dashed white centreline
    m.addLayer({ id: 'chart-rwy-edge', type: 'line', source: 'chart', minzoom: chartMin, filter: F(isLine, kindIs('runway')), layout: { 'line-cap': 'butt' }, paint: { 'line-color': C.rwyEdge, 'line-width': ['+', W(2), 2] as unknown as ExpressionSpecification } });
    m.addLayer({ id: 'chart-runway', type: 'line', source: 'chart', minzoom: chartMin, filter: F(isLine, kindIs('runway')), layout: { 'line-cap': 'butt' }, paint: { 'line-color': C.rwy, 'line-width': W(2) } });
    m.addLayer({ id: 'chart-rwy-cl', type: 'line', source: 'chart', minzoom: 14, filter: F(isLine, kindIs('runway')), layout: { 'line-cap': 'butt' }, paint: { 'line-color': '#ffffff', 'line-opacity': 0.85, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.8, 18, 2], 'line-dasharray': [6, 5] } });
    m.addLayer({ id: 'chart-hold', type: 'line', source: 'chart', minzoom: 14, filter: F(isLine, kindIs('holding_position')), paint: { 'line-color': '#ff4d4d', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2, 18, 4] } });
    // runway end numbers, rotated so a pilot lining up reads them upright
    m.addLayer({ id: 'chart-rwy-ends', type: 'symbol', source: 'chart', minzoom: 12.5, filter: F(isPt, kindIs('rwy-end')), layout: { 'text-field': ['get', 'label'], 'text-font': FONT_BOLD, 'text-size': ['interpolate', ['linear'], ['zoom'], 12.5, 11, 16, 16], 'text-rotate': ['get', 'rot'], 'text-rotation-alignment': 'map', 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff', 'text-halo-color': '#111827', 'text-halo-width': 2 } });
    // taxiway names in yellow boxes with black text, like a real airport chart
    m.addLayer({ id: 'chart-taxi-labels', type: 'symbol', source: 'chart', minzoom: 13.5, filter: F(isLine, kindIs('taxiway'), ['!=', ['get', 'label'], '']), layout: { 'symbol-placement': 'line', 'symbol-spacing': 260, 'text-field': ['get', 'label'], 'text-font': FONT_BOLD, 'text-size': ['interpolate', ['linear'], ['zoom'], 13.5, 10.5, 17, 13], 'text-keep-upright': true, 'text-rotation-alignment': 'viewport', 'icon-image': 'twy-box', 'icon-text-fit': 'both', 'icon-text-fit-padding': [1, 3, 1, 3], 'icon-rotation-alignment': 'viewport' }, paint: { 'text-color': '#141005' } });
    m.addLayer({ id: 'chart-rwy-labels', type: 'symbol', source: 'chart', minzoom: 15, maxzoom: 15.5, filter: F(isLine, kindIs('runway'), ['!=', ['get', 'label'], '']), layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'label'], 'text-font': FONT_BOLD, 'text-size': 12, 'text-keep-upright': true }, paint: { 'text-color': '#ffffff', 'text-halo-color': '#111827', 'text-halo-width': 2 } });
    m.addLayer({ id: 'chart-stands', type: 'circle', source: 'chart', minzoom: 14.5, filter: F(isPt, kindIs('parking_position', 'gate')), paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14.5, 2.5, 18, 6], 'circle-color': C.standFill, 'circle-stroke-color': ['match', ['get', 'kind'], 'gate', '#3aa7ff', '#14b8a6'], 'circle-stroke-width': 1.6 } });
    m.addLayer({ id: 'chart-stand-labels', type: 'symbol', source: 'chart', minzoom: 15.5, filter: F(isPt, kindIs('parking_position', 'gate'), ['!=', ['get', 'label'], '']), layout: { 'text-field': ['get', 'label'], 'text-font': FONT_BOLD, 'text-size': 10.5, 'text-offset': [0, 1], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': dark ? '#d8f5f1' : '#0b3d38', 'text-halo-color': halo, 'text-halo-width': 1.4 } });

    // FIR boundaries: faint chart lines everywhere, filled in amber where a centre is online.
    src('firs', firShapes() ?? EMPTY);
    const firLine = this.styleId === 'radar' ? '#1f5a3c' : this.styleId === 'satellite' ? 'rgba(255,255,255,0.28)' : dark ? '#34507e' : '#9aa8bf';
    m.addLayer({ id: 'fir-lines', type: 'line', source: 'firs', layout: { visibility: this.vis('firs') }, paint: { 'line-color': firLine, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.5, 7, 1.1], 'line-opacity': 0.75 } });
    m.addLayer({ id: 'fir-active-fill', type: 'fill', source: 'firs', filter: ['in', ['get', 'id'], ['literal', []]], layout: { visibility: this.vis('atc') }, paint: { 'fill-color': ATC_COLORS.CTR, 'fill-opacity': 0.07 } });
    m.addLayer({ id: 'fir-active-line', type: 'line', source: 'firs', filter: ['in', ['get', 'id'], ['literal', []]], layout: { visibility: this.vis('atc'), 'line-join': 'round' }, paint: { 'line-color': ATC_COLORS.CTR, 'line-width': 1.6, 'line-opacity': 0.85 } });

    src('atc-rings');
    m.addLayer({ id: 'atc-ring-fill', type: 'fill', source: 'atc-rings', layout: { visibility: this.vis('atc') }, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['get', 'sel'], 0.12, 0.07] } });
    m.addLayer({ id: 'atc-ring-line', type: 'line', source: 'atc-rings', layout: { visibility: this.vis('atc') }, paint: { 'line-color': ['get', 'color'], 'line-opacity': ['case', ['get', 'sel'], 1, 0.75], 'line-width': ['case', ['get', 'sel'], 2.2, 1.3] } });

    src('runways', this.runways);
    m.addLayer({ id: 'runways', type: 'line', source: 'runways', minzoom: 9, maxzoom: 13, layout: { 'line-cap': 'butt' }, paint: { 'line-color': dark ? '#4a5770' : '#64748b', 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 9, 2, 14, 14] } });
    m.addLayer({ id: 'runway-labels', type: 'symbol', source: 'runways', minzoom: 11, maxzoom: 12.5, layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'name'], 'text-font': FONT_BOLD, 'text-size': 11, 'text-keep-upright': true }, paint: { 'text-color': textColor, 'text-halo-color': halo, 'text-halo-width': 1.4 } });

    src('airports');
    m.addLayer({ id: 'airports', type: 'circle', source: 'airports', layout: { visibility: this.vis('airports') }, filter: ['any', ['>=', ['get', 'size'], 3], ['all', ['>=', ['get', 'size'], 2], ['>=', ['zoom'], 5.5]], ['>=', ['zoom'], 8]], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 1.4, 8, 3.5], 'circle-color': dark ? '#5b6b8c' : '#64748b', 'circle-stroke-width': 0, 'circle-opacity': 0.8 } });
    m.addLayer({ id: 'airport-labels', type: 'symbol', source: 'airports', layout: { visibility: this.vis('airports'), 'text-field': ['get', 'icao'], 'text-font': FONT_REG, 'text-size': 10, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-optional': true }, filter: ['any', ['all', ['>=', ['get', 'size'], 3], ['>=', ['zoom'], 5]], ['all', ['>=', ['get', 'size'], 2], ['>=', ['zoom'], 7.5]], ['>=', ['zoom'], 10]], paint: { 'text-color': dark ? '#7f8db0' : '#475569', 'text-halo-color': halo, 'text-halo-width': 1 } });

    src('atc');
    src('atc-lbl'); // labels on their own source: a font failure can never hide the stations
    m.addLayer({ id: 'atc', type: 'circle', source: 'atc', layout: { visibility: this.vis('atc') }, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 5, 8, 9], 'circle-color': ['get', 'color'], 'circle-opacity': 0.25, 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': ['case', ['get', 'sel'], 3.5, 2.5] } });
    // Station badge: ICAO + one coloured tag per online position (ATC-client style).
    const tag = (i: number) => [' ', {}, ['coalesce', ['get', `p${i}`], ''], { 'text-color': ['coalesce', ['get', `c${i}`], '#ffffff'], 'font-scale': 0.9 }];
    m.addLayer({
      id: 'atc-labels',
      type: 'symbol',
      source: 'atc-lbl',
      minzoom: 2.6,
      layout: {
        visibility: this.vis('atc'),
        'text-field': ['format', ['get', 'name'], { 'text-color': '#ffffff' }, ...tag(0), ...tag(1), ...tag(2), ...tag(3), ...tag(4)] as unknown as ExpressionSpecification,
        'text-font': FONT_BOLD,
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10.5, 8, 12.5],
        'text-anchor': 'top',
        'text-offset': [0, 1.2],
        'icon-image': ['concat', 'atc-', ['get', 'pos']],
        'icon-text-fit': 'both',
        'icon-text-fit-padding': [3, 6, 3, 6],
        'symbol-sort-key': ['case', ['get', 'sel'], 0, 1],
        'text-allow-overlap': true,
        'icon-allow-overlap': true,
      },
      paint: { 'text-color': '#ffffff' },
    });

    // Taxi route from the pilot's clearance: bright green with a dark casing, turn labels and a hold bar.
    src('taxi');
    m.addLayer({ id: 'taxi-casing', type: 'line', source: 'taxi', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#04140b', 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 12, 5, 16, 14, 18, 28], 'line-opacity': 0.75 } });
    m.addLayer({ id: 'taxi-line', type: 'line', source: 'taxi', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#39e58c', 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 12, 2.5, 16, 7, 18, 16] } });
    m.addLayer({ id: 'taxi-arrows', type: 'symbol', source: 'taxi', filter: ['==', ['geometry-type'], 'LineString'], minzoom: 13.5, layout: { 'symbol-placement': 'line', 'symbol-spacing': 90, 'text-field': '>', 'text-font': FONT_BOLD, 'text-size': 14, 'text-keep-upright': false, 'text-rotation-alignment': 'map' }, paint: { 'text-color': '#04140b' } });
    m.addLayer({ id: 'taxi-points', type: 'circle', source: 'taxi', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': ['case', ['==', ['get', 'end'], true], 7, 4.5], 'circle-color': ['case', ['==', ['get', 'end'], true], '#ff4d4d', '#39e58c'], 'circle-stroke-color': '#04140b', 'circle-stroke-width': 2 } });
    m.addLayer({ id: 'taxi-labels', type: 'symbol', source: 'taxi', filter: ['==', ['geometry-type'], 'Point'], layout: { 'text-field': ['get', 'label'], 'text-font': FONT_BOLD, 'text-size': 12, 'text-anchor': 'bottom', 'text-offset': [0, -0.9], 'text-allow-overlap': true, 'icon-image': 'box-mine', 'icon-text-fit': 'both', 'icon-text-fit-padding': [2, 5, 2, 5] }, paint: { 'text-color': '#c9ffe0' } });

    src('plan');
    m.addLayer({ id: 'plan-casing', type: 'line', source: 'plan', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ROUTE_COLORS.plan, 'line-width': 7, 'line-opacity': 0.18, 'line-blur': 2 } });
    m.addLayer({ id: 'plan-line', type: 'line', source: 'plan', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ROUTE_COLORS.plan, 'line-width': 2.6, 'line-opacity': 0.95 } });
    m.addLayer({ id: 'plan-fixes', type: 'circle', source: 'plan', filter: ['==', ['geometry-type'], 'Point'], minzoom: 3.5, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3.5, 2, 8, 3.5], 'circle-color': dark ? '#0b0620' : '#fff', 'circle-stroke-color': ['case', ['get', 'passed'], '#6b5b95', '#c4b5fd'], 'circle-stroke-width': 1.5 } });
    m.addLayer({ id: 'plan-fix-labels', type: 'symbol', source: 'plan', filter: ['==', ['geometry-type'], 'Point'], minzoom: 4.5, layout: { 'text-field': ['get', 'ident'], 'text-font': FONT_BOLD, 'text-size': 10, 'text-offset': [0.8, 0], 'text-anchor': 'left', 'text-optional': true }, paint: { 'text-color': ['case', ['get', 'passed'], '#8b7fb0', '#ddd6fe'], 'text-halo-color': halo, 'text-halo-width': 1.3 } });

    src('route');
    m.addLayer({ id: 'route-est', type: 'line', source: 'route', filter: ['==', ['get', 'kind'], 'est'], layout: { 'line-cap': 'round' }, paint: { 'line-color': ROUTE_COLORS.flown, 'line-opacity': 0.5, 'line-width': 2, 'line-dasharray': [2, 2] } });
    m.addLayer({ id: 'route-ref', type: 'line', source: 'route', filter: ['==', ['get', 'kind'], 'ref'], paint: { 'line-color': dark ? '#ffffff' : '#0f172a', 'line-opacity': 0.22, 'line-width': 1.2, 'line-dasharray': [2, 3] } });
    m.addLayer({ id: 'route-remaining', type: 'line', source: 'route', filter: ['==', ['get', 'kind'], 'remaining'], layout: { 'line-cap': 'round' }, paint: { 'line-color': ROUTE_COLORS.remaining, 'line-opacity': 0.95, 'line-width': 1.6, 'line-dasharray': [1, 2.5] } });
    m.addLayer({ id: 'route-trail', type: 'line', source: 'route', filter: ['==', ['get', 'kind'], 'trail'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ROUTE_COLORS.flown, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2.4, 14, 3.5], 'line-opacity': 0.95 } });
    src('trail', EMPTY, { lineMetrics: true });
    m.addLayer({ id: 'trail-casing', type: 'line', source: 'trail', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': dark ? 'rgba(3,6,12,0.75)' : 'rgba(255,255,255,0.9)', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 5, 14, 7] } });
    m.addLayer({ id: 'trail-line', type: 'line', source: 'trail', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#33b1ff', 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#f2e94e', 1, '#2f7bff'], 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2.6, 14, 4] } });
    this.trailGradientSig = '';
    // Traffic alerts (ATC desk): a red link between the two aircraft and a ring on each.
    src('conflicts');
    src('conflict-lines');
    src('conflict-labels');
    m.addLayer({ id: 'conflict-link', type: 'line', source: 'conflict-lines', layout: { 'line-cap': 'round' }, paint: { 'line-color': ['case', ['==', ['get', 'level'], 'now'], '#ff4d4d', '#ffb547'], 'line-width': 2, 'line-dasharray': [1.5, 1.5] } });
    m.addLayer({ id: 'conflict-ring', type: 'circle', source: 'conflicts', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 9, 10, 16], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 2.5, 'circle-stroke-color': ['case', ['==', ['get', 'level'], 'now'], '#ff4d4d', '#ffb547'] } });
    m.addLayer({ id: 'conflict-label', type: 'symbol', source: 'conflict-labels', minzoom: 7, layout: { 'text-offset': [0, -1], 'text-field': ['get', 'label'], 'text-font': FONT_BOLD, 'text-size': 11, 'text-allow-overlap': true }, paint: { 'text-color': ['case', ['==', ['get', 'level'], 'now'], '#ffb3b3', '#ffd89a'], 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.6 } });

    // Distance tool
    src('measure');
    m.addLayer({ id: 'measure-line', type: 'line', source: 'measure', filter: ['==', ['get', 'kind'], 'seg'], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#ffd45e', 'line-width': 2.2, 'line-dasharray': [2, 1.5] } });
    m.addLayer({ id: 'measure-pts', type: 'circle', source: 'measure', filter: ['==', ['get', 'kind'], 'pt'], paint: { 'circle-radius': 5, 'circle-color': '#ffd45e', 'circle-stroke-color': dark ? '#0b1222' : '#fff', 'circle-stroke-width': 2 } });
    src('measure-labels');
    m.addLayer({ id: 'measure-label', type: 'symbol', source: 'measure-labels', layout: { 'text-field': ['get', 'label'], 'text-font': FONT_BOLD, 'text-size': 12, 'text-allow-overlap': true, 'text-offset': [0, -1] }, paint: { 'text-color': '#ffe9a8', 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.8 } });

    // A past flight picked in the logbook.
    src('logroute', EMPTY, { lineMetrics: true });
    m.addLayer({ id: 'log-casing', type: 'line', source: 'logroute', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': dark ? 'rgba(3,6,12,0.75)' : 'rgba(255,255,255,0.9)', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 5, 14, 7] } });
    m.addLayer({ id: 'log-line', type: 'line', source: 'logroute', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#33b1ff', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2.6, 14, 4] } });
    m.addLayer({ id: 'log-ends', type: 'circle', source: 'logroute', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': dark ? '#0b1222' : '#fff', 'circle-stroke-color': this.accent(), 'circle-stroke-width': 2 } });
    m.addLayer({ id: 'log-end-labels', type: 'symbol', source: 'logroute', filter: ['==', ['geometry-type'], 'Point'], layout: { 'text-field': ['get', 'icao'], 'text-font': FONT_BOLD, 'text-size': 11.5, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-allow-overlap': true }, paint: { 'text-color': dark ? '#e8eef3' : '#0f172a', 'text-halo-color': halo, 'text-halo-width': 1.5 } });
    m.addLayer({ id: 'route-ends', type: 'circle', source: 'route', filter: ['==', ['get', 'kind'], 'end'], paint: { 'circle-radius': 5, 'circle-color': dark ? '#0b1222' : '#fff', 'circle-stroke-color': ROUTE_COLORS.flown, 'circle-stroke-width': 2 } });
    m.addLayer({ id: 'route-end-labels', type: 'symbol', source: 'route', filter: ['==', ['get', 'kind'], 'end'], layout: { 'text-field': ['get', 'icao'], 'text-font': FONT_BOLD, 'text-size': 11.5, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-allow-overlap': true }, paint: { 'text-color': '#ffb3e6', 'text-halo-color': halo, 'text-halo-width': 1.5 } });

    // Short fading tails behind every aircraft: shows where each one has just been.
    src('tails');
    m.addLayer({ id: 'tails', type: 'line', source: 'tails', minzoom: 3.5, layout: { visibility: this.styleId !== 'radar' && this.prefs.layers.trails ? 'visible' : 'none', 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['case', ['get', 'mine'], this.accent(), dark ? '#8fb3ea' : '#475569'], 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.4, 9, 2.4], 'line-opacity': 0.6 } });

    src('history');
    m.addLayer({ id: 'history', type: 'circle', source: 'history', layout: { visibility: this.styleId === 'radar' && this.prefs.layers.trails ? 'visible' : 'none' }, paint: { 'circle-radius': 1.4, 'circle-color': '#7cf2b4', 'circle-opacity': ['get', 'o'] } });

    src('aircraft');
    src('aircraft-lbl');
    m.addLayer({ id: 'sel-halo', type: 'circle', source: 'aircraft', filter: ['any', ['get', 'sel'], ['get', 'mine']], paint: { 'circle-radius': 17, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ['case', ['get', 'sel'], '#ff4fc3', this.accent()], 'circle-stroke-width': 1.5 } });
    m.addLayer({
      id: 'aircraft',
      type: 'symbol',
      source: 'aircraft',
      layout: {
        'icon-image': this.styleId === 'radar' ? 'ac-radar' : ['match', ['get', 'wake'], 'L', 'ac-L', 'H', 'ac-H', 'J', 'ac-J', 'ac-M'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 1.5, this.styleId === 'radar' ? 0.5 : 0.72, 6, this.styleId === 'radar' ? 0.72 : 1.05, 11, 1.4],
        'icon-rotate': ['get', 'hdg'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'symbol-sort-key': ['case', ['get', 'sel'], 2, ['get', 'mine'], 1, 0],
      },
      paint: {
        'icon-color': this.aircraftColor(),
        'icon-halo-color': this.dark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.95)',
        'icon-halo-width': 1.6,
      },
    });
    // Data blocks in their own layer: dark box behind each label, decluttered by collision.
    m.addLayer({
      id: 'aircraft-labels',
      type: 'symbol',
      source: 'aircraft-lbl',
      layout: {
        'text-field': this.labelExpr(this.prefs.labels),
        'text-font': FONT_BOLD,
        'text-size': this.styleId === 'radar' ? 11 : 11.5,
        'text-anchor': 'top-left',
        'text-offset': [1.15, 0.55],
        'text-justify': 'left',
        'text-line-height': 1.2,
        'text-padding': 2,
        'icon-image': this.boxExpr(this.prefs.labels),
        'icon-text-fit': 'both',
        'icon-text-fit-padding': [2, 5, 2, 5],
        'symbol-sort-key': ['case', ['get', 'sel'], 0, ['get', 'mine'], 1, 2],
      },
      paint: { 'text-color': this.styleId === 'radar' ? '#b6ffd5' : '#e8eef3' }, // boxes are dark on every map style
    });
    // Station badges are placed before aircraft labels, so data blocks move out of their way.
    if (m.getLayer('atc-labels')) m.moveLayer('atc-labels');

    m.addLayer({ id: 'airport-sel', type: 'circle', source: 'route', filter: ['==', ['get', 'kind'], 'airport'], paint: { 'circle-radius': 14, 'circle-color': 'rgba(125,180,255,0.12)', 'circle-stroke-color': '#7db4ff', 'circle-stroke-width': 1.6 } });

    this.applyProjection();
    this.pushAirports();
    this.pushAtc();
    this.pushRoute();
    this.pushPlan();
    this.pushAircraft();
    this.pushTails();
    this.pushTaxi();
    this.pushLogRoute();
    this.pushConflicts();
    this.pushMeasure();
    this.pushHeat();
    this.metarAt = 0;
    this.loadMetars(true);
  }

  private conflicts: { a: string; b: string; pa: [number, number]; pb: [number, number]; level: string; hNm: number; vFt: number; inSec: number }[] = [];
  setConflicts(list: { a: string; b: string; pa: [number, number]; pb: [number, number]; level: string; hNm: number; vFt: number; inSec: number }[]) {
    this.conflicts = list;
    this.pushConflicts();
  }
  private conflictPushed = 0;
  private tailsAt = 0;
  private pushConflicts() {
    this.conflictPushed = Date.now();
    const features: GeoJSON.Feature[] = [];
    const lines: GeoJSON.Feature[] = [];
    const labels: GeoJSON.Feature[] = [];
    const now = Date.now();
    const at = (cs: string, fallback: [number, number]) => {
      const f = this.flights.find((x) => x.callsign === cs);
      return f ? this.pos(f, now) : fallback; // follow the aircraft as they move between updates
    };
    for (const c0 of this.conflicts) {
      const c = { ...c0, pa: at(c0.a, c0.pa), pb: at(c0.b, c0.pb) };
      const label = c.level === 'now' ? `${c.hNm} NM · ${c.vFt} ft` : `in ${Math.round(c.inSec)} s · ${c.hNm} NM`;
      lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [c.pa, c.pb] }, properties: { level: c.level } });
      labels.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [(c.pa[0] + c.pb[0]) / 2, (c.pa[1] + c.pb[1]) / 2] }, properties: { level: c.level, label } });
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c.pa }, properties: { level: c.level } });
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c.pb }, properties: { level: c.level } });
    }
    this.set('conflicts', { type: 'FeatureCollection', features } as FC);
    this.set('conflict-lines', { type: 'FeatureCollection', features: lines } as FC);
    this.set('conflict-labels', { type: 'FeatureCollection', features: labels } as FC);
  }

  /** Logged flights: [lon, lat, altitude in hundreds of feet]. One route is coloured by altitude; several are drawn together. */
  setLogRoute(v: { routes: { route: [number, number, number][]; dep?: string | null; arr?: string | null }[] } | null) {
    this.logRoutes = v?.routes.filter((r) => r.route.length >= 2) ?? [];
    this.pushLogRoute();
  }
  private logRoutes: { route: [number, number, number][]; dep?: string | null; arr?: string | null }[] = [];
  private pushLogRoute() {
    const rs = this.logRoutes;
    if (!rs.length) {
      this.set('logroute', EMPTY);
      return;
    }
    const features: GeoJSON.Feature[] = [];
    const ends = new Map<string, [number, number]>();
    for (const r of rs) {
      const raw = unwrap(r.route.map((p) => [p[0], p[1]] as [number, number]));
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: smoothPath(raw) }, properties: {} });
      if (r.dep) ends.set(r.dep, raw[0]);
      if (r.arr) ends.set(r.arr, raw[raw.length - 1]);
    }
    for (const [icao, c] of ends) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { icao } });
    this.set('logroute', { type: 'FeatureCollection', features } as FC);
    if (!this.map.getLayer('log-line')) return;
    if (rs.length === 1) {
      const r = rs[0].route;
      this.map.setPaintProperty('log-line', 'line-gradient', this.trailGradient(unwrap(r.map((p) => [p[0], p[1]] as [number, number])), r.map((p) => p[2] * 100)));
    } else {
      this.map.setPaintProperty('log-line', 'line-gradient', ['interpolate', ['linear'], ['line-progress'], 0, '#35d6b4', 1, '#2f7bff'] as unknown as ExpressionSpecification);
    }
  }

  private pushTaxi() {
    if (!this.map.getSource('taxi')) return;
    const r = this.taxi;
    if (!r) return this.set('taxi', EMPTY);
    const features: GeoJSON.Feature[] = [{ type: 'Feature', geometry: { type: 'LineString', coordinates: r.path }, properties: {} }];
    for (const st of r.steps) {
      if (st.turn === 'start' || st.turn === 'straight') {
        if (st.turn === 'start' && st.name) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: r.path[Math.min(st.startIdx + 1, r.path.length - 1)] }, properties: { label: st.name, end: false } });
        continue;
      }
      const label = st.turn === 'end' ? (r.destLabel.startsWith('runway') ? `HOLD ${r.destLabel.slice(7)}` : r.destLabel.toUpperCase()) : st.turn === 'cross' ? 'CROSS: WAIT FOR CLEARANCE' : `${st.turn === 'left' ? '◄' : '►'} ${st.name}`;
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: r.path[st.startIdx] }, properties: { label: label.replace(/[◄►] /, (m) => (m.startsWith('◄') ? 'LEFT ' : 'RIGHT ')), end: st.turn === 'end' } });
    }
    this.set('taxi', { type: 'FeatureCollection', features });
  }

  setTaxi(r: TaxiRoute | null) {
    this.taxi = r;
    this.pushTaxi();
  }

  /** Flat chart or 3D globe. The globe gets a thin blue atmosphere at low zoom, like the trailer. */
  private applyProjection() {
    const m = this.map;
    const globe = this.prefs.globe;
    m.setProjection({ type: globe ? 'globe' : 'mercator' });
    if (!globe) return;
    const light = this.styleId === 'standard';
    m.setSky({
      'sky-color': light ? '#cfe0f5' : '#03060d',
      'horizon-color': light ? '#e8f0fb' : '#0b2a5a',
      'fog-color': light ? '#ffffff' : '#03060d',
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.6,
      'fog-ground-blend': 0.8,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 0.85, 8, 0],
    });
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
    // Zoomed in: only aircraft around the view, so we can afford several updates a second.
    let list = this.flights;
    if (this.map.getZoom() >= 6 && !this.prefs.globe) {
      const b = this.map.getBounds();
      const padX = (b.getEast() - b.getWest()) * 0.35, padY = (b.getNorth() - b.getSouth()) * 0.35;
      const w = b.getWest() - padX, e = b.getEast() + padX, so = b.getSouth() - padY, n = b.getNorth() + padY;
      list = this.flights.filter((f) => f.key === sel || (f.lat >= so && f.lat <= n && ((f.lon >= w && f.lon <= e) || (f.lon + 360 >= w && f.lon + 360 <= e) || (f.lon - 360 >= w && f.lon - 360 <= e))));
    }
    const features: GeoJSON.Feature[] = list.map((f) => ({
      type: 'Feature',
      id: f.sessionId > 0 ? f.sessionId : undefined,
      geometry: { type: 'Point', coordinates: this.pos(f, now) },
      properties: {
        key: f.key,
        cs: f.callsign,
        fl: f.onGround ? 'GND' : f.altitude != null && f.altitude >= 18000 ? `FL${fmtAltShort(f.altitude)}` : f.altitude != null ? `A${fmtAltShort(f.altitude)}` : '',
        gs: f.groundSpeed != null ? `${Math.round(f.groundSpeed)}kt` : '',
        trend: f.verticalSpeed == null || Math.abs(f.verticalSpeed) < 300 ? 'level' : f.verticalSpeed > 0 ? 'up' : 'down',
        info: [f.aircraft, f.arr ? `> ${f.arr}` : ''].filter(Boolean).join(' '),
        alt: f.onGround ? 0 : f.altitude ?? 0,
        hdg: f.heading ?? 0,
        wake: f.wake,
        gnd: f.onGround,
        sel: f.key === sel,
        mine: this.myVid != null && f.vid === this.myVid,
        friend: this.friendSet.has(f.vid),
      },
    }));
    const fc: FC = { type: 'FeatureCollection', features };
    this.set('aircraft', fc);
    this.set('aircraft-lbl', fc); // labels separately: a font failure can never hide the aircraft
  }

  /**
   * Flown line for a flight: the recorder/IVAO track (one point a minute from pushback) up to
   * where this browser started recording, then the browser's own 15-second positions.
   */
  private flownLine(f: Flight): { pts: [number, number][]; alts: number[] } {
    const local = trails.get(f.key) ?? [];
    const track = this.track && this.track.length > 1 ? this.track : null;
    const fromLocal = (l: typeof local) => ({ pts: l.map((p) => [p[0], p[1]] as [number, number]), alts: l.map((p) => p[2] ?? 0) });
    if (!track) return fromLocal(local);
    const firstLocal = local.find((p) => p[3] != null)?.[3];
    const tr = (list: typeof track) => ({ pts: list.map((p) => [p.lon, p.lat] as [number, number]), alts: list.map((p) => (p.onGround ? 0 : p.alt ?? 0)) });
    if (firstLocal == null) return tr(track);
    const a = tr(track.filter((p) => p.t && new Date(p.t).getTime() < firstLocal));
    const b = fromLocal(local.filter((p) => p[3] != null));
    return { pts: [...a.pts, ...b.pts], alts: [...a.alts, ...b.alts] };
  }

  /** IVAO-Webeye-style colouring: yellow-green near the ground, cyan, then blue at cruise. */
  private static TRAIL_RAMP: [number, string][] = [[0, '#f2e94e'], [4000, '#8ee05a'], [12000, '#35d6b4'], [22000, '#33b1ff'], [32000, '#2f7bff'], [40000, '#3a4dff']];
  private trailGradientSig = '';
  private trailGradient(pts: [number, number][], alts: number[]): ExpressionSpecification {
    // Distance fraction of each point along the line, then at most ~48 colour stops.
    const k = Math.cos(((pts[0]?.[1] ?? 0) * Math.PI) / 180) || 1;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot((pts[i][0] - pts[i - 1][0]) * k, pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1] || 1;
    const ramp = MapController.TRAIL_RAMP;
    const colorAt = (alt: number) => {
      for (let i = ramp.length - 1; i >= 0; i--) if (alt >= ramp[i][0]) return i === ramp.length - 1 ? ramp[i][1] : mix(ramp[i][1], ramp[i + 1][1], (alt - ramp[i][0]) / (ramp[i + 1][0] - ramp[i][0]));
      return ramp[0][1];
    };
    const step = Math.max(1, Math.floor(pts.length / 48));
    const stops: (number | string)[] = [];
    let last = -1;
    for (let i = 0; i < pts.length; i += step) {
      const fr = Math.min(1, cum[i] / total);
      if (fr <= last) continue;
      stops.push(fr, colorAt(alts[i] ?? 0));
      last = fr;
    }
    const end = colorAt(alts[alts.length - 1] ?? 0);
    if (last < 1) stops.push(1, end);
    if (stops.length < 4) return ['literal', end] as unknown as ExpressionSpecification;
    return ['interpolate', ['linear'], ['line-progress'], ...stops] as unknown as ExpressionSpecification;
  }

  /** Smoothed copy of a flown line, recomputed only when a new position arrives. */
  private smoothCache = new Map<string, { sig: string; pts: [number, number][] }>();
  private smoothed(key: string, src: [number, number][]): [number, number][] {
    if (src.length < 3) return src;
    const last = src[src.length - 1];
    const sig = `${src.length}:${last[0]}:${last[1]}`;
    const hit = this.smoothCache.get(key);
    if (hit && hit.sig === sig) return hit.pts;
    const pts = smoothPath(unwrap(src));
    if (this.smoothCache.size > 20) this.smoothCache.clear();
    this.smoothCache.set(key, { sig, pts });
    return pts;
  }

  private pushTails() {
    if (!this.map.getSource('tails')) return;
    const now = Date.now();
    const features: GeoJSON.Feature[] = [];
    if (this.prefs.layers.trails && this.styleId !== 'radar') {
      for (const f of this.flights) {
        if (f.onGround) continue;
        const t = trails.get(f.key);
        if (!t || t.length < 2) continue;
        const pts = t.slice(-8).map((p) => [p[0], p[1]] as [number, number]);
        pts.push(this.pos(f, now));
        features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: smoothPath(unwrap(pts), 4) }, properties: { mine: this.myVid != null && f.vid === this.myVid } });
      }
    }
    this.set('tails', { type: 'FeatureCollection', features });
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
    const active = new Set<string>();
    const activeSel = new Set<string>();
    const firPos = new Map<string, [number, number]>();
    const sel0 = this.selection;
    for (const c of this.controllers) {
      if (c.position !== 'CTR' && c.position !== 'FSS') continue;
      const fir = firForCallsign(c.callsign);
      if (!fir) continue;
      for (const b of fir.b) {
        active.add(b);
        if (sel0?.kind === 'atc' && sel0.key === c.key) activeSel.add(b);
      }
      if (fir.label) firPos.set(c.key, fir.label);
    }
    const inSet = (ids: Set<string>) => ['in', ['get', 'id'], ['literal', [...ids]]] as unknown as maplibregl.FilterSpecification;
    if (this.map.getLayer('fir-active-fill')) {
      this.map.setFilter('fir-active-fill', inSet(active));
      this.map.setFilter('fir-active-line', inSet(active));
      this.map.setPaintProperty('fir-active-fill', 'fill-opacity', ['case', ['in', ['get', 'id'], ['literal', [...activeSel]]], 0.16, 0.07]);
      this.map.setPaintProperty('fir-active-line', 'line-width', ['case', ['in', ['get', 'id'], ['literal', [...activeSel]]], 2.6, 1.6]);
    }
    for (const c0 of this.controllers) {
      const fp = firPos.get(c0.key);
      const c = fp ? { ...c0, lon: fp[0], lat: fp[1] } : c0;
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
      const isAirport = !!top.airport && top.locationSource === 'airport';
      const positions = [...new Set(list.map((c) => c.position))].slice(0, 5);
      const props: Record<string, unknown> = { key: list.length === 1 ? top.key : '', airport: top.airport ?? '', label, name: isAirport ? top.airport : top.callsign, pos: top.position, color: ATC_COLORS[top.position], sel: isSel };
      if (isAirport) positions.forEach((p, i) => { props[`p${i}`] = p === 'OTHER' ? 'ATC' : p; props[`c${i}`] = ATC_COLORS[p]; });
      points.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [top.lon!, top.lat!] }, properties: props });
      for (const c of list) {
        const r = RING_NM[c.position];
        if (!r) continue;
        rings.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [circle(c.lat!, c.lon!, r)] }, properties: { color: ATC_COLORS[c.position], sel: isSel || (sel?.kind === 'atc' && sel.key === c.key) } });
      }
      void k;
    }
    this.set('atc', { type: 'FeatureCollection', features: points });
    this.set('atc-lbl', { type: 'FeatureCollection', features: points });
    this.set('atc-rings', { type: 'FeatureCollection', features: rings });
  }

  /** Plan applies to the selected flight when the callsign matches. */
  private planFor(f: Flight | undefined): SimbriefPlan | null {
    return f && this.plan && this.plan.callsign.toUpperCase() === f.callsign ? this.plan : null;
  }

  private pushRoute() {
    if (!this.map.getSource('route')) return;
    const features: GeoJSON.Feature[] = [];
    let selTrail: FC = EMPTY;
    const f = this.selectedFlight();
    if (f && this.showRoute) {
      const dep = getAirport(f.dep);
      const arr = getAirport(f.arr);
      const [lon, lat] = this.pos(f, Date.now());
      const plan = this.planFor(f);
      if (dep && arr && !plan) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: greatCircle(dep.lat, dep.lon, arr.lat, arr.lon, 96) }, properties: { kind: 'ref' } });
      if (!f.onGround) {
        if (plan) {
          // Remaining = rest of the SimBrief route from the aircraft's projected position.
          const pts = planPoints(plan);
          const { legIndex } = progressAlong(plan, lat, lon);
          const rest: [number, number][] = [[lon, lat], ...pts.slice(legIndex + 1).map((p) => [p.lon, p.lat] as [number, number])];
          features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: unwrap(rest) }, properties: { kind: 'remaining' } });
        } else if (arr) {
          features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: greatCircle(lat, lon, arr.lat, arr.lon, 48) }, properties: { kind: 'remaining' } });
        }
      }
      // Flown track: full IVAO session history (from the gate) when available, else what this browser observed.
      const flown = this.flownLine(f);
      const src = flown.pts;
      if (src.length > 1 || (src.length === 1 && !f.onGround)) {
        // Selected flight: its own line source so it can be coloured by altitude along its length.
        const coords = unwrap([...this.smoothed(f.key, src), [lon, lat]]);
        const alts = [...flown.alts, f.onGround ? 0 : f.altitude ?? 0];
        selTrail = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }] };
        const sig = `${f.key}:${src.length}:${alts[alts.length - 1]}`;
        if (sig !== this.trailGradientSig && this.map.getLayer('trail-line')) {
          this.trailGradientSig = sig;
          this.map.setPaintProperty('trail-line', 'line-gradient', this.trailGradient(unwrap([...src, [lon, lat]]), alts));
        }
      }
      // Before the recorded part: an estimated path from the departure airport, drawn dashed.
      const first = src[0] ?? [lon, lat];
      const fullTrack = this.track && this.track.length > 1;
      if (!fullTrack && dep && !(f.onGround && (f.departureDistance ?? 99) < 5)) {
        const gapNm = distanceNm(dep.lat, dep.lon, first[1], first[0]);
        if (gapNm > 3) {
          let est: [number, number][];
          if (plan) {
            const pts = planPoints(plan);
            const { legIndex } = progressAlong(plan, first[1], first[0]);
            est = [...pts.slice(0, legIndex + 1).map((p) => [p.lon, p.lat] as [number, number]), first];
          } else est = greatCircle(dep.lat, dep.lon, first[1], first[0], 48);
          features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: unwrap(est) }, properties: { kind: 'est' } });
        }
      }
      for (const a of [dep, arr]) if (a) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [a.lon, a.lat] }, properties: { kind: 'end', icao: a.icao } });
    }
    // Your own flight always shows its whole recorded trail, selected or not.
    const mine = this.myVid != null ? this.flights.find((x) => x.vid === this.myVid) : undefined;
    if (mine && mine !== f) {
      const t = (trails.get(mine.key) ?? []).map((p) => [p[0], p[1]] as [number, number]);
      if (t.length > 1) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: unwrap([...this.smoothed(`m${mine.key}`, t), this.pos(mine, Date.now())]) }, properties: { kind: 'trail' } });
    }
    const s = this.selection;
    if (s?.kind === 'airport') {
      const a = getAirport(s.icao);
      if (a) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [a.lon, a.lat] }, properties: { kind: 'airport' } });
    }
    this.set('route', { type: 'FeatureCollection', features });
    this.set('trail', selTrail);
  }

  private pushPlan() {
    if (!this.map.getSource('plan')) return;
    const p = this.plan;
    if (!p) return this.set('plan', EMPTY);
    const pts = planPoints(p);
    // Densify each leg along the great circle so long oceanic legs curve correctly.
    const line: [number, number][] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const seg = greatCircle(pts[i].lat, pts[i].lon, pts[i + 1].lat, pts[i + 1].lon, 8);
      line.push(...(i ? seg.slice(1) : seg));
    }
    const live = this.flights.find((x) => x.callsign === p.callsign.toUpperCase());
    const along = live && !live.onGround ? progressAlong(p, live.lat, live.lon).alongNm : live?.onGround && (live.arrivalDistance ?? 999) < 5 ? Infinity : -1;
    const features: GeoJSON.Feature[] = [{ type: 'Feature', geometry: { type: 'LineString', coordinates: unwrap(line) }, properties: {} }];
    for (const x of p.fixes) if (x.type !== 'apt' && x.ident !== 'TOC' && x.ident !== 'TOD') features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [x.lon, x.lat] }, properties: { ident: x.ident, passed: x.cumNm < along } });
    this.set('plan', { type: 'FeatureCollection', features });
  }

  // ───────── public setters

  setFlights(flights: Flight[], fetchedAt: number | null) {
    const fresh = this.flights !== flights;
    this.flights = flights;
    this.fetchedAt = fetchedAt ?? Date.now();
    this.pushAircraft();
    this.pushRoute();
    if (fresh) {
      this.pushHistory();
      this.pushTails();
      this.pushHeat();
      this.pushNight();
      if (this.plan) this.pushPlan();
    }
  }

  setTrack(t: TrackPoint[] | null) {
    this.track = t;
    this.pushRoute();
  }

  refreshCharts() {
    this.set('chart', allCharts());
  }

  setControllers(c: Controller[]) {
    this.controllers = c;
    this.pushAtc();
  }

  setSelection(s: Selection, showRoute: boolean) {
    const a = this.selection;
    const changed = !s || !a || s.kind !== a.kind || (s.kind === 'flight' && a.kind === 'flight' && s.key !== a.key);
    if (changed) this.track = null;
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

  private nightData(): FC {
    const t = Date.now();
    return { type: 'FeatureCollection', features: [nightPolygon(t, 6), nightPolygon(t, 0)] };
  }
  private nightAt = 0;
  private pushNight() {
    if (!this.prefs.layers.daynight || Date.now() - this.nightAt < 60000) return;
    this.nightAt = Date.now();
    this.set('night', this.nightData());
  }
  private pushHeat() {
    if (!this.prefs.layers.heatmap) return this.set('heat', EMPTY);
    this.set('heat', { type: 'FeatureCollection', features: this.flights.map((f) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [f.lon, f.lat] }, properties: {} })) });
  }
  // METARs for the visible area, refreshed as you pan (at most every 20 s) and every 10 minutes.
  private metarAt = 0;
  private metarBox = '';
  private metarCtl: AbortController | null = null;
  private metars = new Map<string, StationWx>();
  loadMetars(force = false) {
    if (!this.prefs.layers.metar || this.map.getZoom() < 3.5) return;
    const b = this.map.getBounds();
    const box: [number, number, number, number] = [Math.max(-180, b.getWest()), Math.max(-85, b.getSouth()), Math.min(180, b.getEast()), Math.min(85, b.getNorth())];
    const key = box.map((v) => Math.round(v)).join(',');
    if (!force && key === this.metarBox && Date.now() - this.metarAt < 600e3) return;
    if (!force && Date.now() - this.metarAt < 20e3) return;
    this.metarBox = key;
    this.metarAt = Date.now();
    this.metarCtl?.abort();
    const ctl = (this.metarCtl = new AbortController());
    fetchMetarsInBox(box, ctl.signal)
      .then((list) => {
        for (const w of list) this.metars.set(w.icao, w);
        const all = [...this.metars.values()];
        this.set('metar', { type: 'FeatureCollection', features: all.map((w) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [w.lon, w.lat] }, properties: { icao: w.icao, cat: w.cat ?? '', raw: w.raw } })) });
        this.set('metar-labels', {
          type: 'FeatureCollection',
          features: all
            .filter((w) => w.wspd != null)
            .map((w) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [w.lon, w.lat] }, properties: { spd: w.wspd ?? 0, w: w.wspd ? `${w.wdir != null ? String(w.wdir).padStart(3, '0') : 'VRB'}/${w.wspd}${w.wgst ? `G${w.wgst}` : ''}` : 'CALM' } })),
        });
      })
      .catch(() => {
        /* weather is optional; keep what we have */
      });
  }

  private friendSet = new Set<number>();
  private measuring = false;
  private measurePts: { lon: number; lat: number; label: string }[] = [];
  /** Distance tool: null turns it off. */
  setMeasure(pts: { lon: number; lat: number; label: string }[] | null) {
    this.measuring = pts != null;
    this.measurePts = pts ?? [];
    this.map.getCanvas().style.cursor = this.measuring ? 'crosshair' : '';
    this.pushMeasure();
  }
  private pushMeasure() {
    const pts = this.measurePts;
    const shapes: GeoJSON.Feature[] = [];
    const labels: GeoJSON.Feature[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      shapes.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { kind: 'pt' } });
      if (i === 0) continue;
      const a = pts[i - 1];
      const line = greatCircle(a.lat, a.lon, p.lat, p.lon, 48);
      const nm = distanceNm(a.lat, a.lon, p.lat, p.lon);
      const brg = Math.round(bearing(a.lat, a.lon, p.lat, p.lon)) % 360;
      shapes.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: line }, properties: { kind: 'seg' } });
      labels.push({ type: 'Feature', geometry: { type: 'Point', coordinates: line[Math.floor(line.length / 2)] }, properties: { label: `${nm < 10 ? nm.toFixed(1) : Math.round(nm)} NM · ${String(brg || 360).padStart(3, '0')}°` } });
    }
    this.set('measure', { type: 'FeatureCollection', features: shapes } as FC);
    this.set('measure-labels', { type: 'FeatureCollection', features: labels } as FC);
  }
  /** Interface accent colour, for "my flight" highlights on the map. */
  private accent() {
    return accentHex(this.prefs.accent, this.styleId === 'standard');
  }
  setPrefs(p: Prefs) {
    const prev = this.prefs;
    this.prefs = p;
    if (prev.accent !== p.accent && this.map.getLayer('aircraft')) {
      const m = this.map;
      m.setPaintProperty('aircraft', 'icon-color', this.aircraftColor());
      if (m.getLayer('tails')) m.setPaintProperty('tails', 'line-color', ['case', ['get', 'mine'], this.accent(), this.styleId !== 'standard' ? '#8fb3ea' : '#475569']);
      if (m.getLayer('sel-halo')) m.setPaintProperty('sel-halo', 'circle-stroke-color', ['case', ['get', 'sel'], '#ff4fc3', this.accent()]);
      if (m.getLayer('log-ends')) m.setPaintProperty('log-ends', 'circle-stroke-color', this.accent());
      this.addLabelBoxes();
    }
    if (prev.friends !== p.friends) {
      this.friendSet = new Set(p.friends.map((f) => f.vid));
      this.pushAircraft();
    }
    if (p.mapStyle !== this.styleId) {
      this.setStyle(p.mapStyle);
      return; // style.load reinstalls everything with the new prefs
    }
    const m = this.map;
    if (!m.getLayer('aircraft')) return;
    if (prev.globe !== p.globe) this.applyProjection();
    if (prev.glass !== p.glass) requestAnimationFrame(() => m.resize());
    if (prev.labels !== p.labels) {
      m.setLayoutProperty('aircraft-labels', 'text-field', this.labelExpr(p.labels));
      m.setLayoutProperty('aircraft-labels', 'icon-image', this.boxExpr(p.labels));
    }
    if (prev.colorBy !== p.colorBy) m.setPaintProperty('aircraft', 'icon-color', this.aircraftColor());
    for (const [key, layers] of [['airports', ['airports', 'airport-labels']], ['atc', ['atc', 'atc-labels', 'atc-ring-fill', 'atc-ring-line', 'fir-active-fill', 'fir-active-line']], ['firs', ['fir-lines']], ['daynight', ['night']], ['heatmap', ['heat']], ['metar', ['metar', 'metar-wind']]] as const) {
      for (const l of layers) if (m.getLayer(l)) m.setLayoutProperty(l, 'visibility', this.vis(key));
    }
    if (m.getLayer('history')) m.setLayoutProperty('history', 'visibility', this.styleId === 'radar' && p.layers.trails ? 'visible' : 'none');
    if (m.getLayer('tails')) m.setLayoutProperty('tails', 'visibility', this.styleId !== 'radar' && p.layers.trails ? 'visible' : 'none');
    if (prev.layers.trails !== p.layers.trails) this.pushTails();
    if (prev.layers.heatmap !== p.layers.heatmap) this.pushHeat();
    if (prev.layers.metar !== p.layers.metar && p.layers.metar) this.loadMetars();
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
    this.map.flyTo({ center: [20, 25], zoom: this.prefs.globe ? (window.innerWidth < 700 ? 1.1 : 1.7) : window.innerWidth < 700 ? 1.3 : 2.1, speed: 1.6, essential: true, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
  }

  /** Keep the subject clear of floating panels. */
  padding(extra = 0) {
    const w = window.innerWidth;
    // In glass mode the map runs underneath the top bar and side rail.
    const under = document.documentElement.dataset.glass === '1';
    const t0 = under ? (w < 760 ? 52 : 48) : 0;
    const l0 = under && w >= 760 ? 76 : 0;
    if (w < 760) return { top: 20 + t0 + extra, bottom: Math.round(window.innerHeight * 0.45) + extra, left: 20 + extra, right: 20 + extra };
    // The map element starts right of the sidebar and below the top bar; panels dock on top of it.
    const st = document.documentElement.dataset;
    const panel = w < 1180 ? 340 : 384;
    return { top: 30 + t0 + extra, bottom: (st.rightPanel === '1' ? 70 : 30) + extra, left: (st.leftPanel === '1' ? panel + 20 : 30) + l0 + extra, right: (st.rightPanel === '1' ? panel + 60 : 60) + extra };
  }

  // ───────── loop & events

  private tick() {
    if (this.destroyed) return;
    const zoom = this.map.getZoom();
    // Skip work while the tab is hidden or the user is panning/zooming — updating
    // a GeoJSON source mid-gesture is the main source of perceived lag.
    if (!document.hidden && !(this.map.isMoving() && !this.follow)) {
      const f = this.selectedFlight();
      if (f && this.follow) {
        const to = this.pos(f, Date.now() + 1000);
        this.map.easeTo({ center: to, duration: zoom >= 9 ? 480 : 980, easing: (t) => t, padding: this.padding() });
      }
      this.pushAircraft();
      if (this.conflicts.length && Date.now() - this.conflictPushed > 1500) this.pushConflicts();
      if (zoom >= 3.5 && Date.now() - this.tailsAt > 900) {
        this.tailsAt = Date.now();
        this.pushTails(); // keep tails attached to the moving aircraft (about once a second)
      }
      if (f && !f.onGround) this.pushRoute();
    }
    // Smooth motion when zoomed in (viewport-limited), calmer at world view.
    const interval = zoom >= 6 && !this.prefs.globe ? 200 : this.follow || zoom >= 4 ? 500 : 1000;
    this.tickHandle = window.setTimeout(this.tick, interval);
  }

  private bindEvents() {
    const m = this.map;
    const clickable = ['aircraft', 'atc', 'airports'];
    m.on('click', (e) => {
      const layers = clickable.filter((l) => m.getLayer(l));
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]];
      const hits = m.queryRenderedFeatures(box, { layers });
      if (this.measuring) {
        // Measuring: snap to an aircraft or airport under the cursor, otherwise use the click point.
        const snap = hits.find((h) => h.layer.id === 'aircraft' || h.layer.id === 'airports');
        const c = snap && snap.geometry.type === 'Point' ? (snap.geometry.coordinates as [number, number]) : ([e.lngLat.lng, e.lngLat.lat] as [number, number]);
        const label = snap ? String(snap.properties.cs ?? snap.properties.icao ?? '') : '';
        this.cb.onMeasure?.({ lon: c[0], lat: c[1], label });
        return;
      }
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
    m.on('mousemove', (ev) => {
      if (this.hoverFrame) return;
      this.hoverFrame = requestAnimationFrame(() => {
        this.hoverFrame = 0;
        this.hover(ev);
      });
    });
    m.on('mouseout', () => {
      this.popup.remove();
      this.hoverKey = null;
    });
    this.bindView();
  }

  private hover(e: maplibregl.MapMouseEvent) {
    const m = this.map;
    const clickable = ['aircraft', 'atc', 'airports', 'metar'];
    {
      const layers = clickable.filter((l) => m.getLayer(l) && m.getLayoutProperty(l, 'visibility') !== 'none');
      if (!layers.length) return;
      const hits = m.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers });
      if (!this.measuring) m.getCanvas().style.cursor = hits.length ? 'pointer' : '';
      const ac = hits.find((h) => h.layer.id === 'aircraft');
      const wx = !ac ? hits.find((h) => h.layer.id === 'metar') : undefined;
      if (wx && !window.matchMedia('(hover: none)').matches) {
        const key = `wx:${wx.properties.icao}`;
        if (key !== this.hoverKey) {
          this.hoverKey = key;
          const el = document.createElement('div');
          el.innerHTML = `<div class="tip-cs"></div><div class="tip-row mono tip-metar"></div>`;
          el.children[0].textContent = `${wx.properties.icao} · ${wx.properties.cat || 'METAR'}`;
          el.children[1].textContent = String(wx.properties.raw ?? '');
          this.popup.setDOMContent(el);
        }
        this.popup.setLngLat(wx.geometry.type === 'Point' ? (wx.geometry.coordinates as [number, number]) : e.lngLat).addTo(m);
        return;
      }
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
    }
  }

  private bindView() {
    const m = this.map;
    const emitView = () => {
      const b = m.getBounds();
      this.cb.onView([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], m.getZoom());
    };
    m.on('moveend', emitView);
    m.on('moveend', () => this.loadMetars());
    m.on('moveend', () => this.pushAircraft()); // fill in aircraft that came into view
    m.on('load', emitView);
    m.on('dragstart', () => this.cb.onUserMove());
    m.on('error', (e) => {
      // Basemap/tile failures are non-fatal; keep the map responsive.
      if (import.meta.env.DEV) console.warn('[map]', e.error?.message ?? e);
    });
  }
}
