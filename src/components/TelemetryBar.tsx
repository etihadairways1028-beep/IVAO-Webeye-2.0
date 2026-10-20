import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { dash, fmtAlt, fmtDuration, fmtHdg, fmtVs, fmtZulu } from '../lib/format';
import { flightProgress } from '../lib/progress';
import type { Flight } from '../types';

/** Bottom instrument strip for the selected aircraft (desktop/tablet). */
export function TelemetryBar({ f }: { f: Flight }) {
  const plan = useStore((s) => s.plan);
  const transition = useStore((s) => s.prefs.transitionAlt);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const pr = flightProgress(f, plan, now);
  const dest = f.arr ?? plan?.destination.icao ?? null;
  const cells: [string, string, string?][] = [
    ['Groundspeed', f.groundSpeed != null ? `${Math.round(f.groundSpeed)} kt` : dash],
    ['Altitude', f.onGround ? 'GND' : fmtAlt(f.altitude, transition)],
    ['Vertical speed', fmtVs(f.verticalSpeed), 'Derived from position reports'],
    ['Track', fmtHdg(f.heading)],
    ['Squawk', f.transponder ?? dash],
    ['Zulu time', fmtZulu(now, true).replace('Z', '')],
    [`${dest ?? 'Dest'} ETE`, pr.ete != null ? fmtDuration(pr.ete) : dash, 'Calculated at current groundspeed'],
    [`${dest ?? 'Dest'} ETA`, pr.eta != null ? fmtZulu(pr.eta) : dash, 'Calculated at current groundspeed'],
    ['Distance to go', pr.remainingNm != null ? `${Math.round(pr.remainingNm).toLocaleString('en-US')} NM` : dash, pr.source === 'plan' ? 'Along SimBrief route' : 'IVAO-reported'],
  ];
  return (
    <div className="telebar glass" role="group" aria-label={`Telemetry ${f.callsign}`}>
      <div className="telebar-cells">
        {cells.map(([k, v, note]) => (
          <div key={k} className="tcell" title={note}>
            <span className="tk">{k}</span>
            <span className="tv mono">{v}</span>
          </div>
        ))}
      </div>
      <div className="telebar-progress" aria-hidden="true">
        <span style={{ width: `${Math.max(0, Math.min(1, pr.pct ?? 0)) * 100}%` }} />
      </div>
    </div>
  );
}
