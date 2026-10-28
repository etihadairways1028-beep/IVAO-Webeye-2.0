import { useMemo } from 'react';
import { useStore } from '../state/store';
import { trails } from '../data/feed';
import { TimeLine } from './charts';
import type { Flight } from '../types';

const hhmm = (t: number) => new Date(t).toISOString().slice(11, 16) + 'Z';

/** Altitude and groundspeed over the flight so far: the recorder's track joined to what this browser saw. */
export function FlightProfile({ f }: { f: Flight }) {
  const tp = useStore((s) => (s.trackPts?.key === f.key ? s.trackPts.pts : null));
  const fetchedAt = useStore((s) => s.fetchedAt);
  const data = useMemo(() => {
    const alt: { t: number; v: number }[] = [];
    const gs: { t: number; v: number }[] = [];
    for (const p of tp ?? []) {
      if (!p.t) continue;
      const t = new Date(p.t).getTime();
      alt.push({ t, v: Math.round(p.alt ?? 0) });
      if (p.gs != null) gs.push({ t, v: Math.round(p.gs) });
    }
    // Newer samples seen by this browser (every ~15 s) after the last recorded point.
    const last = alt.length ? alt[alt.length - 1].t : 0;
    for (const p of trails.get(f.key) ?? []) {
      const t = p[3];
      if (!t || t <= last + 20000) continue;
      alt.push({ t, v: Math.round(p[2]) });
    }
    const now = Date.now();
    if (!alt.length || now - alt[alt.length - 1].t > 10000) alt.push({ t: now, v: f.onGround ? 0 : f.altitude ?? 0 });
    if (f.groundSpeed != null) gs.push({ t: now, v: f.groundSpeed });
    return { alt, gs };
  }, [tp, f, fetchedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  if (data.alt.length < 3) return <p className="dim small">The profile builds up as the flight is tracked.</p>;
  const top = Math.max(...data.alt.map((p) => p.v));
  return (
    <div className="profile-charts">
      <div className="pc-head">
        <span>Altitude</span>
        <span className="dim small mono">max {top >= 18000 ? `FL${Math.round(top / 100)}` : `${top.toLocaleString()} ft`}</span>
      </div>
      <TimeLine points={data.alt} label="Altitude over time" fmtX={hhmm} unit=" ft" height={96} />
      {data.gs.length >= 3 && (
        <>
          <div className="pc-head">
            <span>Groundspeed</span>
            <span className="dim small mono">max {Math.max(...data.gs.map((p) => p.v))} kt</span>
          </div>
          <TimeLine points={data.gs} label="Groundspeed over time" fmtX={hhmm} unit=" kt" height={80} />
        </>
      )}
    </div>
  );
}
