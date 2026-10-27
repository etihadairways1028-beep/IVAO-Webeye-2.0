import { useState } from 'react';
import { useStore } from '../state/store';
import { bearing, distanceNm } from '../lib/geo';
import { IconRuler, IconX } from './Icons';

const fmtDur = (h: number) => {
  const m = Math.round(h * 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};

/** Distance tool readout: total, legs, time at a chosen speed. */
export function MeasureCard() {
  const pts = useStore((s) => s.measure);
  const sel = useStore((s) => (s.selection?.kind === 'flight' ? s.flightMap.get(s.selection.key) : undefined));
  const [kt, setKt] = useState<number | null>(null);
  if (!pts) return null;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += distanceNm(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
  const speed = kt ?? (sel?.groundSpeed && sel.groundSpeed > 60 ? sel.groundSpeed : 450);
  const last = pts.length >= 2 ? pts[pts.length - 1] : null;
  const prev = pts.length >= 2 ? pts[pts.length - 2] : null;
  const brg = last && prev ? Math.round(bearing(prev.lat, prev.lon, last.lat, last.lon)) % 360 : null;
  const names = pts.map((p) => p.label).filter(Boolean);
  return (
    <div className="measure glass" role="region" aria-label="Distance tool">
      <span className="measure-ico">
        <IconRuler size={16} />
      </span>
      {pts.length < 2 ? (
        <span className="small">{pts.length ? 'Click the next point' : 'Click two or more points on the map: aircraft and airports snap.'}</span>
      ) : (
        <>
          <div className="measure-main">
            <span className="mono measure-total">{total < 10 ? total.toFixed(1) : Math.round(total).toLocaleString()} NM</span>
            <span className="dim small mono">
              {(total * 1.852).toFixed(0)} km · {pts.length - 1} leg{pts.length > 2 ? 's' : ''}
              {brg != null ? ` · last leg ${String(brg || 360).padStart(3, '0')}°T` : ''}
            </span>
            {names.length > 0 && <span className="small measure-names mono">{names.join(' → ')}</span>}
          </div>
          <label className="measure-speed">
            <span className="dim small">at</span>
            <input className="input mono" inputMode="numeric" value={speed} onChange={(e) => setKt(Number(e.target.value.replace(/\D/g, '')) || null)} aria-label="Groundspeed in knots" />
            <span className="dim small">kt</span>
            <strong className="mono">{fmtDur(total / Math.max(1, speed))}</strong>
          </label>
        </>
      )}
      {pts.length > 0 && (
        <button className="chip-btn small" onClick={() => useStore.setState({ measure: pts.slice(0, -1) })} title="Remove the last point">
          Undo
        </button>
      )}
      <button className="icon-btn small" onClick={() => useStore.setState({ measure: null })} aria-label="Close distance tool" title="Close (Esc)">
        <IconX size={15} />
      </button>
    </div>
  );
}
