import type { Map as MLMap } from 'maplibre-gl';

// Aircraft silhouettes drawn at runtime and converted to signed-distance-field
// images, so one icon can be recoloured per aircraft (altitude ramp, selection)
// and stays crisp at any size. All shapes point north (rotated by heading).

const S = 64; // canvas size in px (rendered at pixelRatio 2 → 32 css px)
const PAD = 6;

type Draw = (c: CanvasRenderingContext2D) => void;

// Radar target: small square with a forward heading vector.
const radar: Draw = (c) => {
  const cx = S / 2;
  c.fillRect(cx - 5, S / 2 - 5, 10, 10);
  c.fillRect(cx - 1.2, S / 2 - 26, 2.4, 22);
};

function sdf(draw: Draw): { width: number; height: number; data: Uint8Array } {
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  draw(ctx);
  const alpha = ctx.getImageData(0, 0, S, S).data;
  const INF = 1e20;
  const outer = new Float64Array(S * S);
  const inner = new Float64Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const a = alpha[i * 4 + 3] / 255;
    outer[i] = a === 1 ? 0 : a === 0 ? INF : Math.max(0, 0.5 - a) ** 2;
    inner[i] = a === 1 ? INF : a === 0 ? 0 : Math.max(0, a - 0.5) ** 2;
  }
  edt(outer);
  edt(inner);
  const radius = PAD;
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const d = Math.sqrt(outer[i]) - Math.sqrt(inner[i]);
    const v = Math.max(0, Math.min(255, Math.round(255 - 255 * (d / radius + 0.25))));
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 255;
    data[i * 4 + 3] = v;
  }
  return { width: S, height: S, data };
}

// Felzenszwalb & Huttenlocher squared Euclidean distance transform.
function edt(grid: Float64Array) {
  const f = new Float64Array(S);
  const z = new Float64Array(S + 1);
  const v = new Uint16Array(S);
  const pass = (offset: number, stride: number) => {
    for (let q = 0; q < S; q++) f[q] = grid[offset + q * stride];
    let k = 0;
    v[0] = 0;
    z[0] = -1e20;
    z[1] = 1e20;
    for (let q = 1; q < S; q++) {
      let s: number;
      do {
        const r = v[k];
        s = (f[q] - f[r] + q * q - r * r) / (2 * (q - r));
      } while (s <= z[k] && --k > -1);
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = 1e20;
    }
    k = 0;
    for (let q = 0; q < S; q++) {
      while (z[k + 1] < q) k++;
      const r = v[k];
      grid[offset + q * stride] = f[r] + (q - r) * (q - r);
    }
  };
  for (let x = 0; x < S; x++) pass(x, S);
  for (let y = 0; y < S; y++) pass(y * S, 1);
}

// ───────── Type-accurate silhouettes (top view, nose up). Units: fractions of the length.
interface Plane {
  len: number; // px
  span: number; // wing span / length
  fw: number; // half fuselage width / length
  wingLE: number; // wing root leading edge (from nose)
  chord: number; // root chord
  sweep: number; // tip leading edge offset back from the root
  tipChord: number;
  tail: number; // tailplane span / length
  engines: { x: number; y: number; w: number; h: number }[]; // right side; mirrored
  rearEngines?: boolean;
  props?: boolean;
}

function airliner(p: Plane): Draw {
  return (c) => {
    const L = p.len;
    const top = S / 2 - L / 2;
    const X = (u: number) => S / 2 + u * L;
    const Y = (v: number) => top + v * L;
    const fw = p.fw;
    const half: [number, number][] = [
      [fw * 0.55, 0.035],
      [fw, 0.1],
      [fw, p.wingLE],
      [p.span / 2, p.wingLE + p.sweep],
      [p.span / 2, p.wingLE + p.sweep + p.tipChord],
      [fw, p.wingLE + p.chord],
      [fw * 0.85, 0.8],
      [p.tail / 2, 0.88 + p.sweep * 0.25],
      [p.tail / 2, 0.94 + p.sweep * 0.2],
      [fw * 0.45, 0.965],
      [0.004, 1],
    ];
    c.beginPath();
    c.moveTo(X(0), Y(0));
    for (const [u, v] of half) c.lineTo(X(u), Y(v));
    for (let i = half.length - 1; i >= 0; i--) c.lineTo(X(-half[i][0]), Y(half[i][1]));
    c.closePath();
    c.fill();
    for (const e of p.engines) {
      for (const sg of [-1, 1]) {
        c.beginPath();
        c.ellipse(X(sg * e.x), Y(e.y), e.w * L, e.h * L, 0, 0, Math.PI * 2);
        c.fill();
        if (p.props) c.fillRect(X(sg * e.x) - 0.09 * L, Y(e.y - e.h) - 1, 0.18 * L, 1.6); // propeller disc
      }
    }
  };
}

const NARROW = airliner({ len: 38, span: 0.98, fw: 0.05, wingLE: 0.36, chord: 0.24, sweep: 0.2, tipChord: 0.06, tail: 0.36, engines: [{ x: 0.17, y: 0.4, w: 0.035, h: 0.07 }] });
const WIDE2 = airliner({ len: 48, span: 0.98, fw: 0.052, wingLE: 0.34, chord: 0.26, sweep: 0.24, tipChord: 0.05, tail: 0.34, engines: [{ x: 0.2, y: 0.39, w: 0.042, h: 0.08 }] });
const WIDE4 = airliner({ len: 50, span: 0.98, fw: 0.056, wingLE: 0.33, chord: 0.27, sweep: 0.25, tipChord: 0.05, tail: 0.34, engines: [{ x: 0.17, y: 0.38, w: 0.033, h: 0.07 }, { x: 0.32, y: 0.47, w: 0.03, h: 0.065 }] });
const SUPER = airliner({ len: 52, span: 1.04, fw: 0.068, wingLE: 0.3, chord: 0.32, sweep: 0.24, tipChord: 0.06, tail: 0.38, engines: [{ x: 0.18, y: 0.37, w: 0.036, h: 0.07 }, { x: 0.33, y: 0.46, w: 0.034, h: 0.066 }] });
const REGIONAL = airliner({ len: 32, span: 0.86, fw: 0.05, wingLE: 0.42, chord: 0.22, sweep: 0.17, tipChord: 0.06, tail: 0.32, engines: [{ x: 0.085, y: 0.74, w: 0.035, h: 0.08 }], rearEngines: true });
const BIZJET = airliner({ len: 27, span: 0.86, fw: 0.05, wingLE: 0.44, chord: 0.2, sweep: 0.15, tipChord: 0.07, tail: 0.32, engines: [{ x: 0.085, y: 0.73, w: 0.04, h: 0.08 }], rearEngines: true });
const TURBOPROP = airliner({ len: 32, span: 1.08, fw: 0.05, wingLE: 0.36, chord: 0.14, sweep: 0.005, tipChord: 0.09, tail: 0.32, engines: [{ x: 0.17, y: 0.36, w: 0.035, h: 0.09 }], props: true });
const GA = airliner({ len: 24, span: 1.3, fw: 0.06, wingLE: 0.3, chord: 0.17, sweep: 0, tipChord: 0.15, tail: 0.44, engines: [], props: false });

const HELI: Draw = (c) => {
  const cx = S / 2, cy = S / 2 - 4;
  c.beginPath();
  c.ellipse(cx, cy, 4.2, 7, 0, 0, Math.PI * 2);
  c.fill();
  c.fillRect(cx - 1.1, cy + 5, 2.2, 15); // tail boom
  c.fillRect(cx - 4, cy + 18, 8, 1.8); // tail rotor
  c.lineWidth = 1.6;
  c.strokeStyle = '#fff';
  c.beginPath();
  c.arc(cx, cy, 13, 0, Math.PI * 2); // rotor disc
  c.stroke();
  c.fillRect(cx - 13, cy - 0.8, 26, 1.6);
  c.fillRect(cx - 0.8, cy - 13, 1.6, 26);
};

const FIGHTER: Draw = (c) => {
  const cx = S / 2, top = S / 2 - 15;
  c.beginPath();
  c.moveTo(cx, top);
  c.lineTo(cx + 2.5, top + 9);
  c.lineTo(cx + 14, top + 21);
  c.lineTo(cx + 14, top + 24);
  c.lineTo(cx + 3, top + 22);
  c.lineTo(cx + 7, top + 29);
  c.lineTo(cx + 2, top + 30);
  c.lineTo(cx, top + 28);
  c.lineTo(cx - 2, top + 30);
  c.lineTo(cx - 7, top + 29);
  c.lineTo(cx - 3, top + 22);
  c.lineTo(cx - 14, top + 24);
  c.lineTo(cx - 14, top + 21);
  c.lineTo(cx - 2.5, top + 9);
  c.closePath();
  c.fill();
};

const ICONS: Record<string, Draw> = {
  'ac-L': GA,
  'ac-M': NARROW,
  'ac-H': WIDE2,
  'ac-J': SUPER,
  'ac-narrow': NARROW,
  'ac-wide2': WIDE2,
  'ac-wide4': WIDE4,
  'ac-super': SUPER,
  'ac-regional': REGIONAL,
  'ac-biz': BIZJET,
  'ac-turboprop': TURBOPROP,
  'ac-ga': GA,
  'ac-heli': HELI,
  'ac-fighter': FIGHTER,
  'ac-radar': radar,
};

// ICAO type designator → silhouette family.
const FAMILIES: [RegExp, string][] = [
  [/^A38/, 'ac-super'],
  [/^(B74|A34|IL96|A124|AN22|C5$|C5M|B52|K35R|KC135|E3TF|E3CF|E6|A400)/, 'ac-wide4'],
  [/^(A30|A310|A33|A35|B76|B77|B78|MD11|DC10|L101|IL86|KC10|KC46|C17$|A3ST|BLCF)/, 'ac-wide2'],
  [/^(CRJ|E1[3-9]|E14|E17|E19|E29|E75|E9|F70|F100|RJ|B46|BA46|SU95|ARJ|MD8|MD9|DC9|B712|F28)/, 'ac-regional'],
  [/^(C25|C5[0-9]|C68|C75|CL3|CL6|GLF|GL5|GL6|GL7|GLEX|FA[0-9]|F2TH|F900|LJ|H25|E35|E50|E55|PRM|HDJT|PC24|SF50|EA50|BE40)/, 'ac-biz'],
  [/^(AT[4-7]|DH8|Q4|SF34|SB20|JS3|JS4|F27|F50|E120|D228|D328|B190|BE20|BE30|BE35|BE9|PC12|C208|C30J|C130|AN2[4-6]|AN32|L410|DHC6|TBM|PA31|PA42|C441|P180|M28)/, 'ac-turboprop'],
  [/^(EC|AS3|AS5|AS6|B06|B407|B412|B429|R22|R44|R66|S76|S92|H60|UH|AW1|A109|A119|A139|A169|A189|MI8|BK17|H125|H135|H145|H160|H175|CH47)/, 'ac-heli'],
  [/^(F15|F16|F18|F22|F35|FA18|EUFI|TOR|RFAL|M200|SU27|SU30|SU35|MIG|F4|F5|T38|HAWK|A10|GRIF|JF17|J10|J20)/, 'ac-fighter'],
  [/^(C1[5-9][0-9]|C2[0-9][0-9]|C17[0-9]|P28|PA[0-9]|DA[2-6]|SR2|BE[0-9]{2}|M20|DR4|TB[0-9]|C42|PIVI|RV|G1|ULAC|AAT|CH7|TAMP|SIRA|AN2)/, 'ac-ga'],
  [/^(A318|A319|A32|A2[01]N|B73|B38|B39|B3M|BCS|A22|C919|MC21|TU20|B72|B75|YK42)/, 'ac-narrow'],
];
/** Icon id for an aircraft: its type family, else by wake category. */
const familyCache = new Map<string, string>();
export function iconFor(type: string | null, wake: string): string {
  const key = `${type ?? ''}|${wake}`;
  const hit = familyCache.get(key);
  if (hit) return hit;
  const t = (type ?? '').toUpperCase();
  let id = wake === 'L' ? 'ac-ga' : wake === 'H' ? 'ac-wide2' : wake === 'J' ? 'ac-super' : 'ac-narrow';
  if (t) for (const [re, fam] of FAMILIES) if (re.test(t)) { id = fam; break; }
  familyCache.set(key, id);
  return id;
}

const cache = new Map<string, ReturnType<typeof sdf>>();

export function addAircraftIcons(map: MLMap) {
  for (const [id, draw] of Object.entries(ICONS)) {
    if (map.hasImage(id)) continue;
    let img = cache.get(id);
    if (!img) {
      img = sdf(draw);
      cache.set(id, img);
    }
    map.addImage(id, img, { sdf: true, pixelRatio: 2 });
  }
}
