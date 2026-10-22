const R_NM = 3440.065;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Point reached travelling `nm` along initial course `brg` from lat/lon. */
export function destination(lat: number, lon: number, brg: number, nm: number): [number, number] {
  const d = nm / R_NM;
  const p1 = rad(lat);
  const l1 = rad(lon);
  const b = rad(brg);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [deg(p2), ((deg(l2) + 540) % 360) - 180];
}

/** Great-circle polyline as [lon, lat] pairs, unwrapped so MapLibre draws across the antimeridian. */
export function greatCircle(lat1: number, lon1: number, lat2: number, lon2: number, steps = 64): [number, number][] {
  const p1 = rad(lat1), l1 = rad(lon1), p2 = rad(lat2), l2 = rad(lon2);
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d === 0) return [[lon1, lat1], [lon2, lat2]];
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    pts.push([deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
  }
  return unwrap(pts);
}

export function unwrap(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let offset = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) {
      const diff = pts[i][0] - pts[i - 1][0];
      if (diff > 180) offset -= 360;
      else if (diff < -180) offset += 360;
    }
    out.push([pts[i][0] + offset, pts[i][1]]);
  }
  return out;
}

export function circle(lat: number, lon: number, nm: number, steps = 48): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const [la, lo] = destination(lat, lon, (i / steps) * 360, nm);
    pts.push([lo, la]);
  }
  return unwrap(pts);
}

export type Region = 'all' | 'europe' | 'namerica' | 'samerica' | 'mideast' | 'asia' | 'africa' | 'oceania' | 'view';

export const REGIONS: { id: Region; label: string; box?: [number, number, number, number] }[] = [
  { id: 'all', label: 'Worldwide' },
  { id: 'view', label: 'Current map view' },
  { id: 'europe', label: 'Europe', box: [-25, 34, 45, 72] },
  { id: 'namerica', label: 'North America', box: [-170, 7, -50, 75] },
  { id: 'samerica', label: 'South America', box: [-92, -57, -30, 13] },
  { id: 'mideast', label: 'Middle East', box: [25, 12, 63, 42] },
  { id: 'asia', label: 'Asia', box: [60, -11, 150, 60] },
  { id: 'africa', label: 'Africa', box: [-20, -36, 52, 37] },
  { id: 'oceania', label: 'Oceania', box: [110, -50, 180, 0] },
];

export function inBox(lon: number, lat: number, box: [number, number, number, number]) {
  return lon >= box[0] && lat >= box[1] && lon <= box[2] && lat <= box[3];
}

/**
 * Smooth a flown track for drawing: drop near-duplicate points, then pass a centripetal
 * Catmull-Rom spline through the rest, so turns read as curves instead of corners. The curve
 * still goes through every reported position. Longitudes must already be continuous (unwrap).
 */
export function smoothPath(pts: [number, number][], perSpan = 6): [number, number][] {
  if (pts.length < 3) return pts;
  const k = Math.cos(((pts[Math.floor(pts.length / 2)][1] || 0) * Math.PI) / 180) || 1;
  // 1. drop points closer than ~40 m to the previous kept point (feed jitter, stationary aircraft)
  const p: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = p[p.length - 1], b = pts[i];
    if (Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) > 0.00036 || i === pts.length - 1) p.push(b);
  }
  if (p.length < 3) return p;
  const X = (q: [number, number]) => [q[0] * k, q[1]] as const;
  const out: [number, number][] = [p[0]];
  for (let i = 0; i < p.length - 1; i++) {
    const P0 = X(p[Math.max(0, i - 1)]), P1 = X(p[i]), P2 = X(p[i + 1]), P3 = X(p[Math.min(p.length - 1, i + 2)]);
    const d = (a: readonly number[], b: readonly number[]) => Math.max(1e-9, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
    const t0 = 0, t1 = t0 + d(P0, P1), t2 = t1 + d(P1, P2), t3 = t2 + d(P2, P3);
    // long straight legs need no extra points; short turning ones get more
    const n = perSpan;
    for (let s = 1; s <= n; s++) {
      const t = t1 + ((t2 - t1) * s) / n;
      const L = (a: readonly number[], b: readonly number[], ta: number, tb: number) => [((tb - t) / (tb - ta)) * a[0] + ((t - ta) / (tb - ta)) * b[0], ((tb - t) / (tb - ta)) * a[1] + ((t - ta) / (tb - ta)) * b[1]];
      const A1 = L(P0, P1, t0, t1), A2 = L(P1, P2, t1, t2), A3 = L(P2, P3, t2, t3);
      const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
      const C = L(B1, B2, t1, t2);
      out.push([C[0] / k, C[1]]);
    }
  }
  return out;
}
