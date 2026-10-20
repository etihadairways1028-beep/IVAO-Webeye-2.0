import type { Map as MLMap } from 'maplibre-gl';

// Aircraft silhouettes drawn at runtime and converted to signed-distance-field
// images, so one icon can be recoloured per aircraft (altitude ramp, selection)
// and stays crisp at any size. All shapes point north (rotated by heading).

const S = 64; // canvas size in px (rendered at pixelRatio 2 → 32 css px)
const PAD = 6;

type Draw = (c: CanvasRenderingContext2D) => void;

// Jet: swept wings, tail; `span`/`len` scale by wake category.
function jet(len: number, span: number, engines4 = false): Draw {
  return (c) => {
    const cx = S / 2;
    const top = S / 2 - len / 2;
    const bot = S / 2 + len / 2;
    const w = 2.6 + len * 0.045; // fuselage half-width
    c.beginPath();
    c.moveTo(cx, top);
    c.quadraticCurveTo(cx + w, top + 3, cx + w, top + 9);
    // right wing
    c.lineTo(cx + w, S / 2 - len * 0.06);
    c.lineTo(cx + span / 2, S / 2 + len * 0.12);
    c.lineTo(cx + span / 2, S / 2 + len * 0.19);
    c.lineTo(cx + w, S / 2 + len * 0.1);
    // tail
    c.lineTo(cx + w * 0.8, bot - len * 0.14);
    c.lineTo(cx + span * 0.2, bot - len * 0.03);
    c.lineTo(cx + span * 0.2, bot + 0.5);
    c.lineTo(cx, bot - 2.5);
    c.lineTo(cx - span * 0.2, bot + 0.5);
    c.lineTo(cx - span * 0.2, bot - len * 0.03);
    c.lineTo(cx - w * 0.8, bot - len * 0.14);
    c.lineTo(cx - w, S / 2 + len * 0.1);
    c.lineTo(cx - span / 2, S / 2 + len * 0.19);
    c.lineTo(cx - span / 2, S / 2 + len * 0.12);
    c.lineTo(cx - w, S / 2 - len * 0.06);
    c.lineTo(cx - w, top + 9);
    c.quadraticCurveTo(cx - w, top + 3, cx, top);
    c.closePath();
    c.fill();
    // engine pods
    const pods = engines4 ? [0.2, 0.34] : [0.26];
    for (const p of pods) {
      for (const sgn of [-1, 1]) {
        c.beginPath();
        c.ellipse(cx + sgn * span * p, S / 2 + len * 0.02 + span * p * 0.12, 1.9, 4, 0, 0, Math.PI * 2);
        c.fill();
      }
    }
  };
}

// Light aircraft: straight high wing.
const prop: Draw = (c) => {
  const cx = S / 2;
  c.beginPath();
  c.ellipse(cx, S / 2 - 1, 3.2, 15, 0, 0, Math.PI * 2);
  c.fill();
  c.fillRect(cx - 17, S / 2 - 7, 34, 6);
  c.fillRect(cx - 7.5, S / 2 + 10, 15, 4);
  c.fillRect(cx - 7, S / 2 - 17, 14, 1.6);
};

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

const ICONS: Record<string, Draw> = {
  'ac-L': prop,
  'ac-M': jet(34, 32),
  'ac-H': jet(44, 42),
  'ac-J': jet(50, 50, true),
  'ac-radar': radar,
};

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
