// Day/night terminator: the part of the Earth where the sun is below the horizon.
const rad = Math.PI / 180;

/** Sub-solar point (lat, lon) at time t. */
export function subsolar(t: number): [number, number] {
  const d = t / 864e5 - 10957.5; // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  let lon = (ra / rad - gmst * 15) % 360;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return [dec / rad, lon];
}

/** Night-side polygon; `offset` degrees below the horizon gives the twilight bands. */
export function nightPolygon(t: number, offset = 0): GeoJSON.Feature {
  const [dec, slon] = subsolar(t);
  const pts: [number, number][] = [];
  const decR = dec * rad;
  for (let lon = -180; lon <= 180; lon += 2) {
    const H = (lon - slon) * rad;
    // Latitude where the sun's altitude equals -offset.
    const a = Math.cos(H) * Math.cos(decR);
    const b = Math.sin(decR);
    const s = Math.sin(-offset * rad);
    // sin(alt) = sinφ·b + cosφ·a  ⇒  φ = asin(s / R) − atan2(a, b)
    const R = Math.hypot(a, b);
    const x = Math.max(-1, Math.min(1, s / R));
    const psi = Math.atan2(a, b);
    const wrap = (v: number) => ((v + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    let phi = wrap(Math.asin(x) - psi);
    if (Math.abs(phi) > Math.PI / 2) phi = wrap(Math.PI - Math.asin(x) - psi);
    const lat = phi / rad;
    pts.push([lon, Math.max(-89.9, Math.min(89.9, lat))]);
  }
  // Close over the pole that's in darkness.
  const pole = dec > 0 ? -90 : 90;
  const ring: [number, number][] = [...pts, [180, pole], [-180, pole], pts[0]];
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { offset } };
}
