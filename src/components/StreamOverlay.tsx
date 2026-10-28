import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { loadAirports, getAirport } from '../data/airports';
import { startFeed } from '../data/feed';
import { flightProgress } from '../lib/progress';
import { fetchLogbook, landingRate, type LoggedFlight } from '../data/logbook';
import { fmtAlt, fmtDuration, fmtVs, fmtZulu } from '../lib/format';
import { IconLogo, IconPlane } from './Icons';

/**
 * ?overlay=<VID>: a transparent lower-third for OBS / Streamlabs (add as a Browser Source).
 * Shows the pilot's live flight, then their landing rate once they touch down.
 * Options: &style=card for a corner card, &demo=1 to preview with demo traffic.
 */
export function StreamOverlay({ vid, style, demo }: { vid: number; style: 'bar' | 'card'; demo: boolean }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.overlay = '1';
    loadAirports()
      .then(() => {
        useStore.setState({ airportsReady: true });
        startFeed(demo ? 'demo' : 'live');
        setReady(true);
      })
      .catch(() => setReady(true));
  }, [demo]);
  const flights = useStore((s) => s.flights);
  const f = useMemo(() => (demo ? flights.find((x) => !x.onGround && (x.arrivalDistance ?? 0) > 200) : flights.find((x) => x.vid === vid)) ?? null, [flights, vid, demo]);
  const [last, setLast] = useState<LoggedFlight | null>(null);
  const onGround = f?.onGround ?? null;
  useEffect(() => {
    if (demo || onGround === false) return;
    const ac = new AbortController();
    fetchLogbook(vid, ac.signal)
      .then((d) => setLast(d.flights[0] && Date.now() - d.flights[0].landed < 3 * 3600e3 ? d.flights[0] : null))
      .catch(() => undefined);
    const id = window.setInterval(() => fetchLogbook(vid).then((d) => setLast(d.flights[0] && Date.now() - d.flights[0].landed < 3 * 3600e3 ? d.flights[0] : null)).catch(() => undefined), 60000);
    return () => (ac.abort(), window.clearInterval(id));
  }, [vid, onGround, demo]);

  if (!ready) return null;
  if (!f) {
    return (
      <div className={`ov ${style === "card" ? "ov-card" : "ov-lower"}`}>
        <div className="ov-brand">
          <IconLogo />
        </div>
        <div className="ov-main">
          <div className="ov-cs mono">VID {vid}</div>
          <div className="ov-sub">Not connected to IVAO</div>
        </div>
      </div>
    );
  }
  const pr = flightProgress(f, null);
  const dep = f.dep ? getAirport(f.dep) : null;
  const arr = f.arr ? getAirport(f.arr) : null;
  const pct = pr.pct != null ? Math.max(0, Math.min(1, pr.pct)) : null;
  const lr = last && f.onGround ? landingRate(last) : null;
  return (
    <div className={`ov ${style === "card" ? "ov-card" : "ov-lower"}`}>
      <div className="ov-brand">
        <IconLogo />
      </div>
      <div className="ov-main">
        <div className="ov-top">
          <span className="ov-cs mono">{f.callsign}</span>
          <span className="ov-type mono">{f.aircraft ?? ''}</span>
          <span className="ov-phase">{f.onGround ? (lr ? 'Landed' : 'On ground') : f.state ?? 'En route'}</span>
        </div>
        <div className="ov-route">
          <span className="mono ov-apt">{f.dep ?? '····'}</span>
          <span className="ov-city">{dep?.city ?? ''}</span>
          <div className="ov-bar">
            <div className="ov-fill" style={{ width: `${(pct ?? 0) * 100}%` }} />
            {pct != null && (
              <span className="ov-plane" style={{ left: `${pct * 100}%` }}>
                <IconPlane size={14} style={{ transform: 'rotate(90deg)' }} />
              </span>
            )}
          </div>
          <span className="ov-city right">{arr?.city ?? ''}</span>
          <span className="mono ov-apt">{f.arr ?? '····'}</span>
        </div>
      </div>
      <div className="ov-cells mono">
        {lr ? (
          <>
            <div>
              <span>Landing</span>
              <b>{lr.fpm} fpm</b>
            </div>
            {last?.touchdown?.g != null && (
              <div>
                <span>G</span>
                <b>{last.touchdown.g.toFixed(2)}</b>
              </div>
            )}
            <div>
              <span>Flight time</span>
              <b>{fmtDuration((last?.airborneMin ?? 0) * 60)}</b>
            </div>
          </>
        ) : (
          <>
            <div>
              <span>Alt</span>
              <b>{f.onGround ? 'GND' : fmtAlt(f.altitude, 18000)}</b>
            </div>
            <div>
              <span>GS</span>
              <b>{f.groundSpeed ?? '—'} kt</b>
            </div>
            <div>
              <span>V/S</span>
              <b>{fmtVs(f.verticalSpeed)}</b>
            </div>
            <div>
              <span>ETA</span>
              <b>{pr.eta ? fmtZulu(pr.eta) : '—'}</b>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
