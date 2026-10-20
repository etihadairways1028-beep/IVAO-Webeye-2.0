import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { getAirport } from '../data/airports';
import { copyText, selectAirport } from '../lib/actions';
import { ago, dash, fmtAlt, fmtDuration, fmtHdg, fmtKt, fmtLat, fmtLon, fmtNm, fmtVs, fmtZulu, RULES_LABEL, WAKE_LABEL } from '../lib/format';
import { distanceNm } from '../lib/geo';
import { Badge, KV, Panel, Section } from './ui';
import { IconClock, IconCopy, IconCrosshair, IconFollow, IconGauge, IconPlane, IconRoute, IconUser } from './Icons';
import type { Flight } from '../types';

function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => set((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

function RouteStrip({ f }: { f: Flight }) {
  const dep = getAirport(f.dep);
  const arr = getAirport(f.arr);
  // Progress from IVAO-reported distances when both are present.
  const pct = f.departureDistance != null && f.arrivalDistance != null && f.departureDistance + f.arrivalDistance > 0 ? f.departureDistance / (f.departureDistance + f.arrivalDistance) : null;
  return (
    <div className="routestrip">
      <button className="rs-end" onClick={() => f.dep && selectAirport(f.dep)} disabled={!dep} title={dep?.name}>
        <span className="rs-code mono">{f.dep ?? '····'}</span>
        <span className="rs-name">{dep ? dep.city || dep.name : f.dep ? 'Unknown airport' : 'No flight plan'}</span>
      </button>
      <div className="rs-mid" aria-label={pct != null ? `${Math.round(pct * 100)}% of distance flown` : undefined}>
        <div className="rs-track">
          <div className="rs-fill" style={{ width: `${(pct ?? 0) * 100}%` }} />
          {pct != null && (
            <span className="rs-plane" style={{ left: `${pct * 100}%` }}>
              <IconPlane size={14} style={{ transform: 'rotate(90deg)' }} />
            </span>
          )}
        </div>
        <div className="rs-dist mono">{f.arrivalDistance != null ? `${fmtNm(f.arrivalDistance)} to go` : dep && arr ? `${fmtNm(distanceNm(dep.lat, dep.lon, arr.lat, arr.lon))} GC` : dash}</div>
      </div>
      <button className="rs-end right" onClick={() => f.arr && selectAirport(f.arr)} disabled={!arr} title={arr?.name}>
        <span className="rs-code mono">{f.arr ?? '····'}</span>
        <span className="rs-name">{arr ? arr.city || arr.name : f.arr ? 'Unknown airport' : ''}</span>
      </button>
    </div>
  );
}

export function AircraftDetailsPanel({ flight: f }: { flight: Flight }) {
  const follow = useStore((s) => s.follow);
  const showRoute = useStore((s) => s.showRoute);
  const transition = useStore((s) => s.prefs.transitionAlt);
  const myVid = useStore((s) => s.prefs.myVid);
  const plan = useStore((s) => s.plan);
  const fetchedAt = useStore((s) => s.fetchedAt);
  useTick(5000);

  const st = useStore.getState();
  const mine = myVid && Number(myVid) === f.vid;
  // ETA shown only when en route with a sensible speed, and labelled as an estimate.
  const eta = !f.onGround && f.arrivalDistance != null && f.groundSpeed != null && f.groundSpeed > 100 ? Date.now() + (f.arrivalDistance / f.groundSpeed) * 3600000 : null;
  const planMatch = plan && plan.callsign.toUpperCase() === f.callsign;

  return (
    <Panel
      side="right"
      label={`Flight ${f.callsign}`}
      icon={<IconPlane size={20} style={{ transform: `rotate(${f.heading ?? 0}deg)` }} />}
      title={
        <span className="cs-title">
          <span className="mono">{f.callsign}</span>
          {f.demo && <Badge tone="demo" title="Synthetic demonstration record">DEMO</Badge>}
          {mine && <Badge tone="teal">MY FLIGHT</Badge>}
        </span>
      }
      sub={
        <>
          {f.aircraft ?? 'Type not filed'}
          {f.aircraftModel ? ` · ${f.aircraftModel}` : ''}
          {f.registration ? ` · ${f.registration}` : ''}
        </>
      }
      onClose={() => st.select(null)}
      actions={
        <>
          <button className={`chip-btn ${follow ? 'on' : ''}`} aria-pressed={follow} onClick={() => st.setFollow(!follow)} title="Follow aircraft (F)">
            <IconFollow size={15} /> {follow ? 'Following' : 'Follow'}
          </button>
          <button className="chip-btn" onClick={() => st.camera_({ type: 'fly', center: [f.lon, f.lat] })} title="Centre on aircraft (C)">
            <IconCrosshair size={15} /> Centre
          </button>
          <button className={`chip-btn ${showRoute ? 'on' : ''}`} aria-pressed={showRoute} onClick={() => st.setShowRoute(!showRoute)} title="Show route">
            <IconRoute size={15} /> Route
          </button>
          <button className="chip-btn" onClick={() => copyText(f.callsign)} title="Copy callsign">
            <IconCopy size={15} /> Copy
          </button>
        </>
      }
    >
      <div className="badges">
        {f.state && <Badge tone="blue" title="Flight state reported by IVAO">{f.state}</Badge>}
        {f.onGround && <Badge>On ground</Badge>}
        {f.rules && <Badge>{RULES_LABEL[f.rules] ?? f.rules}</Badge>}
        {f.wake !== '?' && <Badge title="Wake turbulence category">{WAKE_LABEL[f.wake]}</Badge>}
        {f.military && <Badge tone="amber">Military</Badge>}
        {f.transponder && <Badge title="Transponder code">SQK {f.transponder}</Badge>}
      </div>

      <RouteStrip f={f} />

      <Section title="Live telemetry" icon={<IconGauge size={15} />} aside={<span className="mono dim">{f.trackTime ? `${fmtZulu(f.trackTime, true)} · ${ago(f.trackTime)}` : fetchedAt ? ago(fetchedAt) : dash}</span>}>
        <div className="grid-kv big">
          <KV k="Altitude" v={f.onGround ? 'GND' : fmtAlt(f.altitude, transition)} />
          <KV k="Groundspeed" v={fmtKt(f.groundSpeed)} />
          <KV k="Track" v={fmtHdg(f.heading)} note="Heading as reported by the IVAO feed" />
          <KV k="Vertical speed" v={fmtVs(f.verticalSpeed)} note="Derived from consecutive position reports — not reported by IVAO" />
          <KV k="Latitude" v={fmtLat(f.lat)} />
          <KV k="Longitude" v={fmtLon(f.lon)} />
        </div>
      </Section>

      <Section title="Route" icon={<IconRoute size={15} />}>
        <div className="grid-kv">
          <KV k="Cruise" v={f.cruiseLevel ?? dash} />
          <KV k="Cruise speed" v={f.cruiseSpeed ?? dash} />
          <KV k="Remaining" v={fmtNm(f.arrivalDistance)} note="Distance to arrival as reported by IVAO" />
          <KV k="Flown" v={fmtNm(f.departureDistance)} note="Distance from departure as reported by IVAO" />
          <KV k="Filed EET" v={fmtDuration(f.eet)} />
          <KV k="Est. arrival" v={eta ? fmtZulu(eta) : dash} note="Estimated from remaining distance at current groundspeed — not authoritative" />
          <KV k="Alternate" v={f.alt ?? dash} />
          <KV k="POB" v={f.pob ?? dash} />
        </div>
        {f.route && (
          <div className="route-text mono" aria-label="Filed route">
            {f.route}
          </div>
        )}
        <div className="legend-row">
          <span className="lg lg-trail" /> Observed trail <span className="lg lg-rem" /> Remaining (great circle)
          {planMatch ? (
            <>
              <span className="lg lg-plan" /> SimBrief plan
            </>
          ) : (
            <>
              <span className="lg lg-ref" /> Dep–arr reference
            </>
          )}
        </div>
        <p className="fineprint">The filed route is shown as text; plotted lines are a great-circle reference unless a matching SimBrief plan is loaded.</p>
      </Section>

      <Section title="Pilot" icon={<IconUser size={15} />}>
        <div className="grid-kv">
          <KV k="IVAO VID" v={f.demo ? `${f.vid} (demo)` : f.vid} />
          <KV k="Online" v={f.connectedAt ? fmtDuration((Date.now() - new Date(f.connectedAt).getTime()) / 1000) : dash} />
          <KV k="Server" v={f.server ?? dash} />
          <KV k="Simulator" v={f.simulator ?? dash} />
          <KV k="Software" v={f.software ?? dash} wide />
        </div>
        {f.remarks && (
          <details className="remarks">
            <summary>Remarks</summary>
            <div className="mono">{f.remarks}</div>
          </details>
        )}
      </Section>
      <div className="panel-foot mono">
        <IconClock size={13} /> Source: {f.demo ? 'demonstration generator' : 'IVAO Whazzup'}
      </div>
    </Panel>
  );
}
