// Builds the static geodata bundled with WebEye 2.0.
//   Airports & runways: OurAirports (public domain) https://ourairports.com/data/
//   Coastlines / borders: Natural Earth 1:50m (public domain) https://www.naturalearthdata.com/
// Usage: node scripts/build-data.mjs <dir-with-airports.csv,runways.csv,land.geojson,countries.geojson>
import fs from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
const out = path.resolve('public/data');
fs.mkdirSync(out, { recursive: true });

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const r2 = (n, d = 4) => Math.round(Number(n) * 10 ** d) / 10 ** d;
const SIZE = { large_airport: 3, medium_airport: 2, small_airport: 1 };

const airports = parseCSV(fs.readFileSync(path.join(src, 'airports.csv'), 'utf8'));
const list = [];
const keep = new Map();
for (const a of airports) {
  const size = SIZE[a.type];
  if (!size) continue;
  const code = /^[A-Z]{4}$/.test(a.icao_code) ? a.icao_code : /^[A-Z]{4}$/.test(a.gps_code) && size > 1 ? a.gps_code : '';
  if (!code || keep.has(code)) continue;
  keep.set(code, size);
  // [icao, iata, name, lat, lon, elevFt, country, city, size]
  list.push([code, a.iata_code || '', a.name, r2(a.latitude_deg), r2(a.longitude_deg), a.elevation_ft === '' ? null : Number(a.elevation_ft), a.iso_country, a.municipality, size]);
}
fs.writeFileSync(path.join(out, 'airports.json'), JSON.stringify(list));

const byRef = new Map(airports.map((a) => [a.ident, a]));
const runways = {};
for (const r of parseCSV(fs.readFileSync(path.join(src, 'runways.csv'), 'utf8'))) {
  const ap = byRef.get(r.airport_ident);
  if (!ap || r.closed === '1') continue;
  const code = /^[A-Z]{4}$/.test(ap.icao_code) ? ap.icao_code : ap.gps_code;
  if ((keep.get(code) ?? 0) < 2) continue;
  // [leIdent, heIdent, lengthFt, widthFt, surface, lighted, leLat, leLon, heLat, heLon]
  const coords = r.le_latitude_deg && r.he_latitude_deg ? [r2(r.le_latitude_deg, 5), r2(r.le_longitude_deg, 5), r2(r.he_latitude_deg, 5), r2(r.he_longitude_deg, 5)] : [null, null, null, null];
  (runways[code] ??= []).push([r.le_ident, r.he_ident, Number(r.length_ft) || null, Number(r.width_ft) || null, r.surface, r.lighted === '1' ? 1 : 0, ...coords]);
}
fs.writeFileSync(path.join(out, 'runways.json'), JSON.stringify(runways));

function shrink(file, name) {
  const g = JSON.parse(fs.readFileSync(path.join(src, file), 'utf8'));
  const round = (c) => (typeof c[0] === 'number' ? [r2(c[0], 2), r2(c[1], 2)] : c.map(round));
  g.features = g.features.map((f) => ({ type: 'Feature', properties: {}, geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) } }));
  fs.writeFileSync(path.join(out, name), JSON.stringify(g));
}
shrink('land.geojson', 'land.geojson');
shrink('countries.geojson', 'borders.geojson');

for (const f of fs.readdirSync(out)) console.log(f, (fs.statSync(path.join(out, f)).size / 1024).toFixed(0) + ' KB');
console.log('airports', list.length, 'with runways', Object.keys(runways).length);
