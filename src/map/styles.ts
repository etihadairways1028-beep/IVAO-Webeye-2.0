import type { StyleSpecification } from 'maplibre-gl';
import type { MapStyleId } from '../state/store';

/* Basemaps (no API keys required):
 *  - CARTO Dark Matter / Voyager GL styles © CARTO, © OpenStreetMap contributors.
 *    Free for non-commercial use up to CARTO's fair-use limits; commercial use
 *    needs a CARTO licence. https://carto.com/basemaps
 *  - Esri World Imagery © Esri, Maxar, Earthstar Geographics. Requires the
 *    attribution shown on-map. https://www.esri.com/en-us/legal/terms/full-master-agreement
 *  - Radar: bundled Natural Earth land/borders (public domain) — works offline. */

export const GLYPHS = 'https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf';
export const FONT_BOLD = ['Open Sans Bold'];
export const FONT_REG = ['Open Sans Regular'];

export const STYLE_META: Record<MapStyleId, { label: string; hint: string }> = {
  dark: { label: 'Midnight', hint: 'Dark vector basemap' },
  standard: { label: 'Standard', hint: 'Light vector basemap' },
  satellite: { label: 'Satellite', hint: 'Esri World Imagery' },
  radar: { label: 'Radar', hint: 'ATC-style scope, offline' },
};

const base = import.meta.env.BASE_URL;

/** Offline basemap from bundled Natural Earth data, used when a remote provider is unreachable. */
export function offlineStyle(kind: 'dark' | 'light'): StyleSpecification {
  const dark = kind === 'dark';
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      land: { type: 'geojson', data: `${base}data/land.geojson`, attribution: 'Natural Earth (offline basemap)' },
      borders: { type: 'geojson', data: `${base}data/borders.geojson` },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': dark ? '#10295a' : '#cfdbe8' } },
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': dark ? '#080b11' : '#f3f1ec' } },
      { id: 'coast', type: 'line', source: 'land', paint: { 'line-color': dark ? '#2b4d80' : '#b9c6d6', 'line-width': 0.9 } },
      { id: 'borders', type: 'line', source: 'borders', paint: { 'line-color': dark ? '#3a4d70' : '#c3c9d3', 'line-width': 0.7, 'line-dasharray': [3, 2] } },
    ],
  };
}

function radarStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      land: { type: 'geojson', data: `${base}data/land.geojson`, attribution: 'Natural Earth' },
      borders: { type: 'geojson', data: `${base}data/borders.geojson` },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#03070c' } },
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#08110f' } },
      { id: 'coast', type: 'line', source: 'land', paint: { 'line-color': '#1f4a3c', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.6, 8, 1.4] } },
      { id: 'borders', type: 'line', source: 'borders', paint: { 'line-color': '#173328', 'line-width': 0.7, 'line-dasharray': [3, 2] } },
    ],
  };
}

function satelliteStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      esri: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 18,
        attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
      },
      borders: { type: 'geojson', data: `${base}data/borders.geojson` },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#020409' } },
      { id: 'esri', type: 'raster', source: 'esri', paint: { 'raster-brightness-max': 0.82, 'raster-saturation': -0.15 } },
      { id: 'borders', type: 'line', source: 'borders', paint: { 'line-color': 'rgba(255,255,255,0.35)', 'line-width': 0.8 } },
    ],
  };
}

export function styleFor(id: MapStyleId): string | StyleSpecification {
  switch (id) {
    case 'dark':
      return 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
    case 'standard':
      return 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';
    case 'satellite':
      return satelliteStyle();
    case 'radar':
      return radarStyle();
  }
}

/** Re-tint CARTO Dark Matter toward WebEye's midnight-navy palette. */
export function tintDark(style: StyleSpecification): StyleSpecification {
  const layers = style.layers.map((l) => {
    const id = l.id.toLowerCase();
    const paint = { ...(l as { paint?: Record<string, unknown> }).paint };
    // Chart-like palette: black land, navy water, quiet blue borders.
    if (l.type === 'background') paint['background-color'] = '#080b11';
    else if (l.type === 'fill' && id.includes('water')) paint['fill-color'] = '#10295a';
    else if (l.type === 'line' && id.includes('water')) paint['line-color'] = '#1d3a66';
    else if (l.type === 'fill' && /landcover|park|landuse/.test(id)) paint['fill-color'] = '#0b0f17';
    else if (l.type === 'line' && /boundary|admin/.test(id)) paint['line-color'] = '#3a4d70';
    return { ...l, paint } as typeof l;
  });
  return { ...style, layers };
}
