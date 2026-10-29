import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { getAirport } from '../data/airports';
import { selectAirport } from '../lib/actions';
import { ago, dash, fmtDuration, fmtLat, fmtLon, fmtNm, fmtZulu, RULES_LABEL, WAKE_LABEL } from '../lib/format';
import { distanceNm } from '../lib/geo';
import { Badge, KV, Panel } from './ui';
import { IconClock, IconCrosshair, IconFollow, IconPlane, IconRoute, IconShare } from './Icons';
import { shareSelection } from '../lib/share';
import { openProfile } from './Logbook';
import { FriendStar } from './Friends';
import { FlightProfile } from './FlightProfile';
import { airlineName, airlineOf } from '../data/airlines';
import { openAirline } from './AirlinePanel';
import { IconUser } from './Icons';
import type { Flight } from '../types';
import { flightProgress, type Progress } from '../lib/progress';

function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => set((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

function RouteStrip({ f, pr }: { f: Flight; pr: Progress }) {
  const dep = getAirport(f.dep);
  const arr = getAirport(f.arr);
  const pct = pr.pct != null ? Math.max(0, Math.min(1, pr.pct)) : null;
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
        <div className="rs-dist mono">
          {pr.totalNm != null ? `${Math.round(pr.flownNm ?? 0)}/${Math.round(pr.totalNm)} NM` : dep && arr ? `${fmtNm(distanceNm(dep.lat, dep.lon, arr.lat, arr.lon))} GC` : dash}
          {pr.eta != null && <span className="rs-eta">ETA {fmtZulu(pr.eta)} in {fmtDuration(pr.ete)} · {Math.round(pr.remainingNm ?? 0)} NM</span>}
        </div>
      </div>
      <button className="rs-end right" onClick={() => f.arr && selectAirport(f.arr)} disabled={!arr} title={arr?.name}>
        <span className="rs-code mono">{f.arr ?? '····'}</span>
        <span className="rs-name">{arr ? arr.city || arr.name : f.arr ? 'Unknown airport' : ''}</span>
      </button>
    </div>
  );
}

function Ess({ k, v, u, cls = '' }: { k: string; v: string; u: string; cls?: string }) {
  return (
    <div className="ess">
      <span className="ess-k">{k}</span>
      <span className={`ess-v mono ${cls}`}>
        {v}
        {u && <small className="ess-u">{u}</small>}
      </span>
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
  const trackInfo = useStore((s) => (s.trackInfo?.key === f.key ? s.trackInfo : null));
  const pr = flightProgress(f, plan);
  const mine = myVid && Number(myVid) === f.vid;
  const planMatch = plan && plan.callsign.toUpperCase() === f.callsign;
  const trend = f.verticalSpeed == null || Math.abs(f.verticalSpeed) < 300 ? '' : f.verticalSpeed > 0 ? 'up' : 'down';
  const trackOk = !!trackInfo && trackInfo.points > 1;
  const trackTitle = !trackInfo
    ? 'Loading the flown track…'
    : trackOk
      ? `${trackInfo.points} positions from ${trackInfo.source === 'recorder' ? 'the Pulse recorder, one a minute from pushback' : 'IVAO'}, joined to what this browser has seen.`
      : `The full track isn't available: ${trackInfo.note ?? trackInfo.error ?? 'no history yet'}. The line shows what this browser has seen since you opened it, with a dashed estimate back to the departure airport.`;

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
          <button className={`chip-btn ${showRoute ? 'on' : ''}`} aria-pressed={showRoute} onClick={() => st.setShowRoute(!showRoute)} title="Show route">
            <IconRoute size={15} /> Route
          </button>
          <span className="actions-spacer" />
          <button className="chip-btn icon-only" onClick={() => st.camera_({ type: 'fly', center: [f.lon, f.lat] })} title="Centre on aircraft (C)" aria-label="Centre on aircraft">
            <IconCrosshair size={16} />
          </button>
          {!f.demo && <FriendStar vid={f.vid} name={f.callsign} compact />}
          <button className="chip-btn icon-only" onClick={() => shareSelection(`${f.callsign} on IVAO Pulse`, { kind: 'flight', key: f.key })} title="Copy a link to this flight" aria-label="Share this flight">
            <IconShare size={16} />
          </button>
        </>
      }
    >
      <RouteStrip f={f} pr={pr} />

      {/* The essentials, readable at a glance */}
      <div className="essentials">
        <Ess k="Altitude" v={f.onGround ? 'GND' : f.altitude == null ? '—' : f.altitude >= transition ? `FL${String(Math.round(f.altitude / 100)).padStart(3, '0')}` : Math.round(f.altitude).toLocaleString('en-US')} u={f.onGround || f.altitude == null || f.altitude >= transition ? '' : 'ft'} cls={trend} />
        <Ess k="Speed" v={f.groundSpeed == null ? '—' : String(Math.round(f.groundSpeed))} u="kt" />
        <Ess k="Heading" v={f.heading == null ? '—' : `${String(Math.round(f.heading) % 360).padStart(3, '0')}°`} u="" />
        <Ess k="Vertical" v={f.verticalSpeed == null ? '—' : Math.abs(f.verticalSpeed) < 100 ? 'level' : `${f.verticalSpeed > 0 ? '+' : '−'}${Math.abs(Math.round(f.verticalSpeed / 50) * 50).toLocaleString('en-US')}`} u={f.verticalSpeed != null && Math.abs(f.verticalSpeed) >= 100 ? 'fpm' : ''} cls={trend} />
      </div>
      <div className="ess-meta">
        {f.state && <Badge tone="blue" title="Flight state reported by IVAO">{f.state}</Badge>}
        {f.transponder && <Badge title="Transponder code">SQK {f.transponder}</Badge>}
        <span className="dim small mono">{f.trackTime ? ago(f.trackTime) : fetchedAt ? ago(fetchedAt) : ''}</span>
      </div>

      <div className={`track-chip ${trackOk ? 'ok' : trackInfo ? 'warn' : ''}`} title={trackTitle}>
        <span className="lg lg-trail" />
        <span className="tc-text">
          {!trackInfo ? 'Loading flown track…' : trackOk ? (trackInfo.source === 'recorder' ? 'Flown track from pushback' : 'Flown track from the gate') : 'Flown track: only since you opened the page'}
          {trackInfo && !trackOk && <span className="tc-why">{(trackInfo.note ?? trackInfo.error ?? '').replace(/^the /, 'The ')}</span>}
        </span>
        <span className="dim small">colour = altitude</span>
      </div>

      <details className="fold" open={!f.demo}>
        <summary>Profile</summary>
        <FlightProfile f={f} />
      </details>

      <details className="fold">
        <summary>Flight details</summary>
        <div className="grid-kv">
          <KV optional k="Cruise" v={f.cruiseLevel ?? dash} />
          <KV optional k="Cruise speed" v={f.cruiseSpeed ?? dash} />
          <KV k="Remaining" v={fmtNm(pr.remainingNm)} note={pr.source === 'plan' ? 'Along your SimBrief route' : 'Distance to arrival as reported by IVAO'} />
          <KV k="Flown" v={fmtNm(pr.flownNm)} note={pr.source === 'plan' ? 'Along your SimBrief route' : 'Distance from departure as reported by IVAO'} />
          <KV k="Est. arrival" v={pr.eta ? fmtZulu(pr.eta) : dash} note="Estimated from remaining distance at current groundspeed — not authoritative" />
          <KV optional k="Filed EET" v={fmtDuration(f.eet)} />
          <KV optional k="Alternate" v={f.alt ?? dash} />
          <KV optional k="POB" v={f.pob ?? dash} />
          <KV optional k="Rules" v={f.rules ? RULES_LABEL[f.rules] ?? f.rules : dash} mono={false} />
          <KV optional k="Wake" v={f.wake !== '?' ? WAKE_LABEL[f.wake] : dash} mono={false} />
          <KV k="Position" v={`${fmtLat(f.lat)} ${fmtLon(f.lon)}`} wide />
        </div>
        {f.route && (
          <div className="route-text mono" aria-label="Filed route">
            {f.route}
          </div>
        )}
        {f.remarks && (
          <details className="remarks">
            <summary>Remarks</summary>
            <div className="mono">{f.remarks}</div>
          </details>
        )}
      </details>

      <details className="fold">
        <summary>Pilot</summary>
        <div className="grid-kv">
          <KV k="IVAO VID" v={f.demo ? `${f.vid} (demo)` : f.vid} />
          <KV k="Online" v={f.connectedAt ? fmtDuration((Date.now() - new Date(f.connectedAt).getTime()) / 1000) : dash} />
          <KV optional k="Server" v={f.server ?? dash} />
          <KV optional k="Simulator" v={f.simulator ?? dash} />
          <KV optional k="Software" v={f.software ?? dash} wide />
        </div>
        <div className="row-gap">
          {!f.demo && (
            <button className="chip-btn" onClick={() => openProfile(f.vid)} title="Logbook, hours and badges for this pilot">
              <IconUser size={15} /> Pilot profile &amp; logbook
            </button>
          )}
          {airlineOf(f.callsign) && (
            <button className="chip-btn" onClick={() => openAirline(airlineOf(f.callsign)!)} title="Every flight of this airline online now">
              <IconPlane size={15} /> {airlineName(airlineOf(f.callsign)!) ?? airlineOf(f.callsign)}
            </button>
          )}
        </div>
      </details>

      <details className="fold">
        <summary>Map key</summary>
        <div className="legend-row">
          <span className="lg lg-trail" /> Flown (colour = altitude)
          <span className="lg lg-est" /> Estimated from departure
          <span className="lg lg-rem" /> Remaining{planMatch ? '' : ' (great circle)'}
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
        <p className="fineprint">{trackTitle}</p>
      </details>
      <div className="panel-foot mono">
        <IconClock size={13} /> Source: {f.demo ? 'demonstration generator' : 'IVAO Whazzup'}
      </div>
    </Panel>
  );
}
