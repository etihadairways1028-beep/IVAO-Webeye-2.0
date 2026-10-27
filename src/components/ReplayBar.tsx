import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { exitReplay, seekReplay, setReplay, SPEEDS } from '../data/replay';
import { IconPause, IconPlay, IconReplay } from './Icons';

const hhmm = (t: number) => new Date(t).toISOString().slice(11, 16) + 'Z';
function agoText(ms: number) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min ago`;
}

/** Time machine controls: scrub through the last 18 hours of IVAO traffic. */
export function ReplayBar() {
  const r = useStore((s) => s.replay);
  const [drag, setDrag] = useState<number | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 10000);
    return () => window.clearInterval(id);
  }, []);
  if (!r) return null;
  const nowMin = Math.floor(Date.now() / 60000);
  const lo = (r.oldest ?? nowMin - 18 * 60) * 60000;
  const hi = (r.latest ?? nowMin - 1) * 60000;
  const t = drag ?? r.t;
  const pct = hi > lo ? ((t - lo) / (hi - lo)) * 100 : 100;
  // Hour ticks along the timeline.
  const ticks: number[] = [];
  for (let h = Math.ceil(lo / 3600e3) * 3600e3; h <= hi; h += 3 * 3600e3) ticks.push(h);
  const jump = (min: number) => seekReplay(r.t + min * 60000);
  return (
    <div className="replay glass" role="region" aria-label="Time machine">
      <div className="rp-row">
        <span className="rp-badge">
          <IconReplay size={14} /> REPLAY
        </span>
        <button className="rp-play" onClick={() => setReplay({ playing: !r.playing })} aria-label={r.playing ? 'Pause' : 'Play'} title={r.playing ? 'Pause (space)' : 'Play (space)'}>
          {r.playing ? <IconPause size={18} /> : <IconPlay size={18} />}
        </button>
        <button className="chip-btn small" onClick={() => jump(-10)} title="Back 10 minutes">
          −10m
        </button>
        <button className="chip-btn small" onClick={() => jump(10)} title="Forward 10 minutes">
          +10m
        </button>
        <div className="rp-time">
          <span className="mono rp-clock">{hhmm(t)}</span>
          <span className="dim small">{r.loading ? 'loading…' : r.gap ? 'no data for this minute' : agoText(Date.now() - t)}</span>
        </div>
        <div className="seg rp-speed" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button key={s} className={r.speed === s ? 'on' : ''} aria-pressed={r.speed === s} onClick={() => setReplay({ speed: s, playing: true })} title={s === 1 ? 'Real time' : `${s}× (${s} minutes per minute)`}>
              {s}×
            </button>
          ))}
        </div>
        <button className="btn rp-live" onClick={exitReplay} title="Back to live traffic (Y)">
          <span className="live-dot" aria-hidden="true" /> LIVE
        </button>
      </div>
      <div className="rp-track">
        <input
          type="range"
          min={lo}
          max={hi}
          step={60000}
          value={t}
          aria-label="Replay time"
          aria-valuetext={`${hhmm(t)}, ${agoText(Date.now() - t)}`}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={() => drag != null && (seekReplay(drag), setDrag(null))}
          onKeyUp={() => drag != null && (seekReplay(drag), setDrag(null))}
          style={{ ['--pct' as string]: `${pct}%` }}
        />
        <div className="rp-ticks" aria-hidden="true">
          {ticks.map((h) => (
            <span key={h} style={{ left: `${((h - lo) / (hi - lo)) * 100}%` }}>
              {hhmm(h).slice(0, 2)}Z
            </span>
          ))}
        </div>
      </div>
      {r.error && <div className="warn small">Replay unavailable: {r.error}</div>}
    </div>
  );
}
