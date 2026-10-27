// Small single-series charts in the app accent. One axis, recessive grid, hover tooltips.
import { useRef, useState, type ReactNode } from 'react';

/** Horizontal bars, labelled by name with the value at the end. */
export function BarList({ rows, unit = '', onPick, empty = 'Nothing to show yet.' }: { rows: { label: string; sub?: string; value: number; title?: string }[]; unit?: string; onPick?: (label: string) => void; empty?: string }) {
  if (!rows.length) return <p className="dim small">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="barlist">
      {rows.map((r) => {
        const body = (
          <>
            <span className="bl-label">
              <span className="mono strong">{r.label}</span>
              {r.sub && <span className="dim small"> {r.sub}</span>}
            </span>
            <span className="bl-track">
              <span className="bl-fill" style={{ width: `${(r.value / max) * 100}%` }} />
            </span>
            <span className="bl-val mono">
              {r.value}
              {unit}
            </span>
          </>
        );
        return (
          <li key={r.label} title={r.title ?? `${r.label}: ${r.value}${unit}`}>
            {onPick ? (
              <button className="bl-row" onClick={() => onPick(r.label)}>
                {body}
              </button>
            ) : (
              <div className="bl-row">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Vertical columns with a hover tooltip (e.g. hours flown per week). */
export function Columns({ data, height = 120, fmt = (v) => String(v), label }: { data: { x: string; v: number; tip?: string }[]; height?: number; fmt?: (v: number) => string; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.v), 0) || 1;
  const W = 300, H = height, pad = 18, bw = (W - 4) / data.length;
  return (
    <figure className="chart" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" onMouseLeave={() => setHover(null)}>
        <line x1={0} x2={W} y1={H - pad + 0.5} y2={H - pad + 0.5} className="ch-axis" />
        {data.map((d, i) => {
          const h = (d.v / max) * (H - pad - 14);
          const x = 2 + i * bw;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}>
              <rect x={x} y={0} width={bw} height={H} fill="transparent" />
              {d.v > 0 && <path className={`ch-bar ${hover === i ? 'on' : ''}`} d={roundTop(x + 2, H - pad - h, Math.max(2, bw - 4), h)} />}
              {i % Math.ceil(data.length / 4) === 0 && (
                <text x={x + bw / 2} y={H - 4} className="ch-tick" textAnchor="middle">
                  {d.x}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="ch-tip mono" style={tipPos((2 + hover * bw + bw / 2) / W)}>
          {data[hover].tip ?? `${data[hover].x}: ${fmt(data[hover].v)}`}
        </div>
      )}
    </figure>
  );
}

/** Keep the tooltip inside the chart near either edge. */
function tipPos(f: number): React.CSSProperties {
  return { left: `${f * 100}%`, transform: `translate(${f > 0.7 ? '-100%' : f < 0.3 ? '0' : '-50%'}, -100%)` };
}

function roundTop(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** A line over time with a crosshair tooltip. */
export function TimeLine({ points, height = 130, label, fmtX, unit = '' }: { points: { t: number; v: number }[]; height?: number; label: string; fmtX: (t: number) => string; unit?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <p className="dim small">Collecting history: the chart fills in over the next hours.</p>;
  const W = 300, H = height, padB = 18, padT = 10;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const vmax = Math.max(...points.map((p) => p.v)) * 1.1 || 1;
  const X = (t: number) => ((t - t0) / (t1 - t0 || 1)) * W;
  const Y = (v: number) => H - padB - (v / vmax) * (H - padB - padT);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const area = `${d}L${W},${H - padB}L0,${H - padB}Z`;
  const move = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const t = t0 + ((e.clientX - r.left) / r.width) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i].t - t) < Math.abs(points[best].t - t)) best = i;
    setHover(best);
  };
  const ticks: ReactNode[] = [];
  for (let i = 0; i <= 4; i++) {
    const t = t0 + ((t1 - t0) * i) / 4;
    ticks.push(
      <text key={i} x={Math.min(W - 16, Math.max(16, X(t)))} y={H - 4} className="ch-tick" textAnchor="middle">
        {fmtX(t)}
      </text>,
    );
  }
  const h = hover != null ? points[hover] : null;
  return (
    <figure className="chart" aria-label={label}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" onPointerMove={move} onPointerLeave={() => setHover(null)}>
        {[0.5, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={Y(vmax * f / 1.1)} y2={Y(vmax * f / 1.1)} className="ch-grid" />
        ))}
        <text x={2} y={Y(vmax / 1.1) - 3} className="ch-tick">
          {Math.round(vmax / 1.1)}
        </text>
        <line x1={0} x2={W} y1={H - padB + 0.5} y2={H - padB + 0.5} className="ch-axis" />
        <path d={area} className="ch-area" />
        <path d={d} className="ch-line" />
        {h && (
          <>
            <line x1={X(h.t)} x2={X(h.t)} y1={padT} y2={H - padB} className="ch-cross" />
            <circle cx={X(h.t)} cy={Y(h.v)} r={4} className="ch-dot" />
          </>
        )}
        {ticks}
      </svg>
      {h && (
        <div className="ch-tip mono" style={tipPos(X(h.t) / W)}>
          {fmtX(h.t)} · {h.v}
          {unit}
        </div>
      )}
    </figure>
  );
}

export function Stat({ k, v, sub }: { k: string; v: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-k">{k}</span>
      <span className="stat-v mono">{v}</span>
      {sub && <span className="stat-sub dim small">{sub}</span>}
    </div>
  );
}
