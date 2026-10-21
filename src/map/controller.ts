import maplibregl, { type GeoJSONSource, type Map as MLMap, type ExpressionSpecification, type StyleSpecification } from 'maplibre-gl';
import type { Controller, Flight, SimbriefPlan } from '../types';
import type { LabelMode, MapStyleId, Prefs, Selection } from '../state/store';
import { addAircraftIcons } from './icons';
import { FONT_BOLD, FONT_REG, offlineStyle, styleFor, tintDark } from './styles';
import { allAirports, getAirport } from '../data/airports';
import { trails } from '../data/feed';
import { circle, destination, distanceNm, greatCircle, unwrap } from '../lib/geo';
import { fmtAltShort } from '../lib/format';
import type { RadarFrame } from '../data/weather';
import type { TrackPoint } from '../data/ivao';
import { planPoints, progressAlong } from '../data/simbrief';
import { allCharts } from '../data/charts';
import { firForCallsign, firShapes, loadFirs } from '../data/firs';
import type { TaxiRoute } from '../lib/taxi';

type FC = GeoJSON.FeatureCollection;
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
    return ['case', ['get', 'sel'], '#ff4fc3', ['get', 'mine'], '#2fd6b5', base];
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
    const pick = (normal: unknown) => ['case', ['any', ['get', 'sel'], ['get', 'mine']], block3, normal];
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
    mk('box-mine', 'rgba(4,30,26,0.92)', '#2fd6b5');
    for (const [k, col] of Object.entries(ATC_COLORS)) mk(`atc-${k}`, 'rgba(8,13,24,0.92)', col);
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

    // Airport ground chart (OpenStreetMap): drawn under everything else.
    src('chart', allCharts());
    const chartMin = 11.5;
    m.addLayer({ id: 'chart-apron', type: 'fill', source: 'chart', minzoom: chartMin, filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'kind'], 'apron']], paint: { 'fill-color': dark ? '#141c2e' : '#dfe3ea', 'fill-opacity': 0.9 } });
    m.addLayer({ id: 'chart-bldg', type: 'fill', source: 'chart', minzoom: chartMin, filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['in', ['get', 'kind'], ['literal', ['terminal', 'hangar']]]], paint: { 'fill-color': dark ? '#26324a' : '#c3cad6', 'fill-outline-color': dark ? '#3a4866' : '#9aa5b5' } });
    m.addLayer({ id: 'chart-runway', type: 'line', source: 'chart', minzoom: chartMin, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'kind'], 'runway']], layout: { 'line-cap': 'butt' }, paint: { 'line-color': dark ? '#3b465e' : '#8a94a6', 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 12, 6, 16, 60, 18, 220] } });
    m.addLayer({ id: 'chart-taxiway', type: 'line', source: 'chart', minzoom: chartMin, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['in', ['get', 'kind'], ['literal', ['taxiway', 'taxilane']]]], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': dark ? '#c9a73a' : '#c89b12', 'line-opacity': ['match', ['get', 'kind'], 'taxilane', 0.45, 0.85], 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 12, 0.8, 15, 2.2, 18, 8] } });
    m.addLayer({ id: 'chart-hold', type: 'line', source: 'chart', minzoom: 14, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'kind'], 'holding_position']], paint: { 'line-color': '#ff6b6b', 'line-width': 2 } });
    m.addLayer({ id: 'chart-taxi-labels', type: 'symbol', source: 'chart', minzoom: 13.5, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'kind'], 'taxiway'], ['!=', ['get', 'label'], '']], layout: { 'symbol-placement': 'line', 'symbol-spacing': 220, 'text-field': ['get', 'label'], 'text-font': FONT_BOLD, 'text-size': 11, 'text-keep-upright': true, 'text-rotation-alignment': 'viewport' }, paint: { 'text-color': '#1a1405', 'text-halo-color': '#f2cc4d', 'text-halo-width': 3 } });
    m.addLayer({ id: 'chart-rwy-labels', type: 'symbol', source: 'chart', minzoom: 12.5, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'kind'], 'runway'], ['!=', ['get', 'label'], '']], layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'label'], 'text-font': FONT_BOLD, 'text-size': 12, 'text-keep-upright': true }, paint: { 'text-color': '#ffffff', 'text-halo-color': '#111827', 'text-halo-width': 2 } });
    m.addLayer({ id: 'chart-stands', type: 'circle', source: 'chart', minzoom: 14.5, filter: ['all', ['==', ['geometry-type'], 'Point'], ['in', ['get', 'kind'], ['literal', ['parking_position', 'gate']]]], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14.5, 2, 18, 5], 'circle-color': ['match', ['get', 'kind'], 'gate', '#7db4ff', '#3ff0d0'], 'circle-opacity': 0.9 } });
    m.addLayer({ id: 'chart-stand-labels', type: 'symbol', source: 'chart', minzoom: 15.5, filter: ['all', ['==', ['geometry-type'], 'Point'], ['in', ['get', 'kind'], ['literal', ['parking_position', 'gate']]], ['!=', ['get', 'label'], '']], layout: { 'text-field': ['get', 'label'], 'text-font': FONT_REG, 'text-size': 10, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': dark ? '#b8fff2' : '#0f5132', 'text-halo-color': halo, 'text-halo-width': 1.2 } });

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
    m.addLayer({ id: 'runways', type: 'line', source: 'runways', minzoom: 9, layout: { 'line-cap': 'butt' }, paint: { 'line-color': dark ? '#4a5770' : '#64748b', 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 9, 2, 14, 14] } });
    m.addLayer({ id: 'runway-labels', type: 'symbol', source: 'runways', minzoom: 11, layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'name'], 'text-font': FONT_BOLD, 'text-size': 11, 'text-keep-upright': true }, paint: { 'text-color': textColor, 'text-halo-color': halo, 'text-halo-width': 1.4 } });

    src('airports');
    m.addLayer({ id: 'airports', type: 'circle', source: 'airports', layout: { visibility: this.vis('airports') }, filter: ['any', ['>=', ['get', 'size'], 3], ['all', ['>=', ['get', 'size'], 2], ['>=', ['zoom'], 5.5]], ['>=', ['zoom'], 8]], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 1.4, 8, 3.5], 'circle-color': dark ? '#5b6b8c' : '#64748b', 'circle-stroke-width': 0, 'circle-opacity': 0.8 } });
    m.addLayer({ id: 'airport-labels', type: 'symbol', source: 'airports', layout: { visibility: this.vis('airports'), 'text-field': ['get', 'icao'], 'text-font': FONT_REG, 'text-size': 10, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-optional': true }, filter: ['any', ['all', ['>=', ['get', 'size'], 3], ['>=', ['zoom'], 5]], ['all', ['>=', ['get', 'size'], 2], ['>=', ['zoom'], 7.5]], ['>=', ['zoom'], 10]], paint: { 'text-color': dark ? '#7f8db0' : '#475569', 'text-halo-color': halo, 'text-halo-width': 1 } });

    src('atc');
    m.addLayer({ id: 'atc', type: 'circle', source: 'atc', layout: { visibility: this.vis('atc') }, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 5, 8, 9], 'circle-color': ['get', 'color'], 'circle-opacity': 0.25, 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': ['case', ['get', 'sel'], 3.5, 2.5] } });
    // Station badge: ICAO + one coloured tag per online position (ATC-client style).
    const tag = (i: number) => [' ', {}, ['coalesce', ['get', `p${i}`], ''], { 'text-color': ['coalesce', ['get', `c${i}`], '#ffffff'], 'font-scale': 0.9 }];
    m.addLayer({
      id: 'atc-labels',
      type: 'symbol',
      source: 'atc',
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
    m.addLayer({ id: 'route-ends', type: 'circle', source: 'route', filter: ['==', ['get', 'kind'], 'end'], paint: { 'circle-radius': 5, 'circle-color': dark ? '#0b1222' : '#fff', 'circle-stroke-color': ROUTE_COLORS.flown, 'circle-stroke-width': 2 } });
    m.addLayer({ id: 'route-end-labels', type: 'symbol', source: 'route', filter: ['==', ['get', 'kind'], 'end'], layout: { 'text-field': ['get', 'icao'], 'text-font': FONT_BOLD, 'text-size': 11.5, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-allow-overlap': true }, paint: { 'text-color': '#ffb3e6', 'text-halo-color': halo, 'text-halo-width': 1.5 } });

    // Short fading tails behind every aircraft: shows where each one has just been.
    src('tails');
    m.addLayer({ id: 'tails', type: 'line', source: 'tails', minzoom: 3.5, layout: { visibility: this.styleId !== 'radar' && this.prefs.layers.trails ? 'visible' : 'none', 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['case', ['get', 'mine'], '#2fd6b5', dark ? '#8fb3ea' : '#475569'], 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1, 9, 2], 'line-opacity': 0.5 } });

    src('history');
    m.addLayer({ id: 'history', type: 'circle', source: 'history', layout: { visibility: this.styleId === 'radar' && this.prefs.layers.trails ? 'visible' : 'none' }, paint: { 'circle-radius': 1.4, 'circle-color': '#7cf2b4', 'circle-opacity': ['get', 'o'] } });

    src('aircraft');
    m.addLayer({ id: 'sel-halo', type: 'circle', source: 'aircraft', filter: ['any', ['get', 'sel'], ['get', 'mine']], paint: { 'circle-radius': 17, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ['case', ['get', 'sel'], '#ff4fc3', '#2fd6b5'], 'circle-stroke-width': 1.5 } });
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
      source: 'aircraft',
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
      paint: { 'text-color': textColor },
    });

    m.addLayer({ id: 'airport-sel', type: 'circle', source: 'route', filter: ['==', ['get', 'kind'], 'airport'], paint: { 'circle-radius': 14, 'circle-color': 'rgba(125,180,255,0.12)', 'circle-stroke-color': '#7db4ff', 'circle-stroke-width': 1.6 } });

    this.applyProjection();
    this.pushAirports();
    this.pushAtc();
    this.pushRoute();
    this.pushPlan();
    this.pushAircraft();
    this.pushTails();
    this.pushTaxi();
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
    const features: GeoJSON.Feature[] = this.flights.map((f) => ({
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
      },
    }));
    this.set('aircraft', { type: 'FeatureCollection', features });
  }

  /**
   * Flown line for a flight: the recorder/IVAO track (one point a minute from pushback) up to
   * where this browser started recording, then the browser's own 15-second positions.
   */
  private flownLine(f: Flight): [number, number][] {
    const local = trails.get(f.key) ?? [];
    const track = this.track && this.track.length > 1 ? this.track : null;
    if (!track) return local.map((p) => [p[0], p[1]]);
    const firstLocal = local.find((p) => p[3] != null)?.[3];
    if (firstLocal == null) return track.map((p) => [p.lon, p.lat]);
    const before = track.filter((p) => p.t && new Date(p.t).getTime() < firstLocal).map((p) => [p.lon, p.lat] as [number, number]);
    return [...before, ...local.filter((p) => p[3] != null).map((p) => [p[0], p[1]] as [number, number])];
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
        features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: unwrap(pts) }, properties: { mine: this.myVid != null && f.vid === this.myVid } });
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
    this.set('atc-rings', { type: 'FeatureCollection', features: rings });
  }

  /** Plan applies to the selected flight when the callsign matches. */
  private planFor(f: Flight | undefined): SimbriefPlan | null {
    return f && this.plan && this.plan.callsign.toUpperCase() === f.callsign ? this.plan : null;
  }

  private pushRoute() {
    if (!this.map.getSource('route')) return;
    const features: GeoJSON.Feature[] = [];
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
      const src = this.flownLine(f);
      if (src.length > 1 || (src.length === 1 && !f.onGround)) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: unwrap([...src, [lon, lat]]) }, properties: { kind: 'trail' } });
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
      if (t.length > 1) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: unwrap([...t, this.pos(mine, Date.now())]) }, properties: { kind: 'trail' } });
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

  setPrefs(p: Prefs) {
    const prev = this.prefs;
    this.prefs = p;
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
    for (const [key, layers] of [['airports', ['airports', 'airport-labels']], ['atc', ['atc', 'atc-labels', 'atc-ring-fill', 'atc-ring-line', 'fir-active-fill', 'fir-active-line']], ['firs', ['fir-lines']]] as const) {
      for (const l of layers) if (m.getLayer(l)) m.setLayoutProperty(l, 'visibility', this.vis(key));
    }
    if (m.getLayer('history')) m.setLayoutProperty('history', 'visibility', this.styleId === 'radar' && p.layers.trails ? 'visible' : 'none');
    if (m.getLayer('tails')) m.setLayoutProperty('tails', 'visibility', this.styleId !== 'radar' && p.layers.trails ? 'visible' : 'none');
    if (prev.layers.trails !== p.layers.trails) this.pushTails();
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
      if (zoom >= 3.5) this.pushTails(); // keep tails attached to the moving aircraft
      if (f && !f.onGround) this.pushRoute();
    }
    const fast = this.follow || zoom >= 9;
    this.tickHandle = window.setTimeout(this.tick, fast ? 500 : 1000);
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
    const clickable = ['aircraft', 'atc', 'airports'];
    {
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
    }
  }

  private bindView() {
    const m = this.map;
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
