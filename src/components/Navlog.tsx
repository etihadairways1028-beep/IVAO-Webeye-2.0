import { memo } from 'react';
import type { Flight, SimbriefPlan } from '../types';
import { fmtAltShort, fmtDuration, fmtZulu } from '../lib/format';
import type { Progress } from '../lib/progress';
import { useStore } from '../state/store';

/**
 * SimBrief navlog with per-waypoint ETE/ETA.
 * Planned ETA = SimBrief estimated takeoff + cumulative time.
 * Live ETA (when the plan's callsign is online) = now + remaining distance along the route ÷ current GS.
 */
export const Navlog = memo(function Navlog({ plan, live, progress }: { plan: SimbriefPlan; live: Flight | null; progress: Progress | null }) {
  const now = Date.now();
  const gs = live && !live.onGround && (live.groundSpeed ?? 0) > 100 ? live.groundSpeed! : null;
  const flown = progress?.flownNm ?? null;
  const camera = useStore.getState().camera_;
  return (
    <div className="navlog-wrap">
      <table className="navlog">
        <thead>
          <tr>
            <th>Waypoint</th>
            <th>Via</th>
            <th className="r">Alt</th>
            <th className="r">Dist</th>
            <th className="r">ETE</th>
            <th className="r">{gs ? 'ETA live' : 'ETA plan'}</th>
            <th className="r">Fuel</th>
          </tr>
        </thead>
        <tbody>
          {plan.fixes.map((f, i) => {
            const passed = flown != null && f.cumNm <= flown + 0.5;
            const isNext = progress?.source === 'plan' && i === progress.nextFix && !!live && !live.onGround;
            const remNm = flown != null ? f.cumNm - flown : null;
            const liveEte = gs && remNm != null && remNm > 0 ? (remNm / gs) * 3600 : null;
            const planEta = plan.estOff != null && f.cumSec != null ? (plan.estOff + f.cumSec) * 1000 : null;
            const eta = liveEte != null ? now + liveEte * 1000 : planEta;
            const ete = liveEte ?? f.cumSec;
            return (
              <tr key={i} className={`${passed ? 'passed' : ''} ${isNext ? 'next' : ''} ${f.type === 'apt' ? 'apt' : ''}`} onClick={() => camera({ type: 'fly', center: [f.lon, f.lat], zoom: 7 })} title={[f.name, f.wind ? `Wind ${f.wind}` : '', f.oat != null ? `OAT ${f.oat}°C` : '', f.tas ? `TAS ${f.tas}` : '', f.freq ? `Freq ${f.freq}` : ''].filter(Boolean).join(' · ')}>
                <td className="mono strong">
                  {isNext && <span className="next-dot" aria-label="Next waypoint" />}
                  {f.ident}
                </td>
                <td className="mono dim">{f.airway === 'DCT' ? 'DCT' : f.airway || ''}</td>
                <td className="mono r">{f.alt != null ? (f.alt >= 18000 ? fmtAltShort(f.alt) : Math.round(f.alt / 100) * 100) : '—'}</td>
                <td className="mono r">{passed || remNm == null ? Math.round(f.cumNm) : Math.round(Math.max(0, remNm))}</td>
                <td className="mono r">{passed ? '—' : fmtDuration(ete)}</td>
                <td className="mono r">{passed ? '✓' : eta ? fmtZulu(eta) : '—'}</td>
                <td className="mono r dim">{f.fuelOnboard != null ? (f.fuelOnboard / 1000).toFixed(1) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="fineprint">
        Dist = {flown != null ? 'remaining NM to each waypoint along the route' : 'cumulative NM from departure'}. ETE from {gs ? 'now at current groundspeed (calculated)' : 'planned takeoff (SimBrief)'}. Fuel in {plan.units === 'lbs' ? 'thousand lb' : 'tonnes'} on board. Tap a row to show it on the map.
      </p>
    </div>
  );
});
