import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useStore } from '../state/store';
import { allAirports, getAirport } from '../data/airports';
import { chartState, loadChart, onChartsChange } from '../data/charts';
import { parseClearance, planTaxi, runwayLabels, taxiProgress, taxiwayNames } from '../lib/taxi';
import type { Flight } from '../types';
import { IconRunway, IconRoute } from './Icons';
import { Section } from './ui';

const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);

/** Airport an aircraft on the ground is at (nearest within ~5 km). */
function airportAt(f: Flight | null): string | null {
  if (!f) return null;
  let best: string | null = null, bd = 0.05 ** 2;
  const k = Math.cos((f.lat * Math.PI) / 180);
  for (const a of allAirports()) {
    const d = ((a.lon - f.lon) * k) ** 2 + (a.lat - f.lat) ** 2;
    if (d < bd) (bd = d), (best = a.icao);
  }
  return best;
}

/**
 * ATC clearance helper for your own flight: the squawk you were given (checked against
 * your live transponder) and a taxi clearance drawn on the airport's ground chart.
 * IVAO doesn't publish what controllers tell pilots, so both are typed in by you.
 */
export function ClearanceTools({ flight, planOrigin }: { flight: Flight | null; planOrigin: string | null }) {
  const taxi = useStore((s) => s.taxi);
  const assigned = useStore((s) => s.assignedSquawk);
  const onGround = !!flight?.onGround;
  const autoIcao = (onGround ? airportAt(flight) : null) ?? (flight && (flight.departureDistance ?? 99) < 5 ? flight.dep : null) ?? planOrigin ?? '';
  const [icao, setIcao] = useState(autoIcao);
  const [text, setText] = useState(taxi?.text ?? '');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (autoIcao && !taxi) setIcao(autoIcao);
  }, [autoIcao]); // eslint-disable-line react-hooks/exhaustive-deps

  const code = icao.trim().toUpperCase();
  const ap = getAirport(code);
  useEffect(() => {
    if (ap) loadChart(ap.icao);
  }, [ap]);
  const chart = useSyncExternalStore(onChartsChange, () => (ap ? chartState(ap.icao) : null));
  const fc = chart?.status === 'ready' ? chart.fc : null;
  const names = useMemo(() => (fc ? taxiwayNames(fc) : []), [fc]);
  const rwys = useMemo(() => (fc ? [...new Set(runwayLabels(fc))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })) : []), [fc]);

  const livePos: [number, number] | null = flight && onGround && airportAt(flight) === ap?.icao ? [flight.lon, flight.lat] : null;

  const show = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!fc || !ap) return;
    const c = parseClearance(text);
    const r = planTaxi(fc, livePos, c);
    if (!r.ok) {
      setErr(r.error);
      useStore.setState({ taxi: null });
      return;
    }
    setErr(null);
    useStore.setState({ taxi: { icao: ap.icao, text, route: r.route } });
    const lons = r.route.path.map((p) => p[0]), lats = r.route.path.map((p) => p[1]);
    useStore.getState().camera_({ type: 'fit', bounds: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], maxZoom: 16.5 });
  };
  const clear = () => {
    useStore.setState({ taxi: null });
    setErr(null);
  };
  const add = (tok: string, kind: 'rwy' | 'twy') => {
    let t = text.trim();
    if (kind === 'rwy') t = `${tok}${t.toUpperCase().includes('VIA') ? ' ' + t.slice(t.toUpperCase().indexOf('VIA')) : ''}`;
    else t = t.toUpperCase().includes('VIA') ? `${t} ${tok}` : `${t || '?'} via ${tok}`;
    setText(t);
  };

  // Live guidance along the route.
  const route = taxi?.icao === ap?.icao ? taxi?.route ?? null : null;
  const prog = route && flight && onGround ? taxiProgress(route, [flight.lon, flight.lat]) : null;

  // Squawk check against the live transponder from the IVAO feed.
  const sq = assigned.trim();
  const sqValid = /^[0-7]{4}$/.test(sq);
  const live = flight?.transponder ?? null;

  return (
    <>
      <Section title="ATC clearance" icon={<IconRoute size={15} />}>
        <div className="clr-row">
          <label className="clr-field">
            <span className="dim small">Squawk ATC gave you</span>
            <input className="input mono" inputMode="numeric" maxLength={4} placeholder="e.g. 4521" value={assigned} onChange={(e) => useStore.setState({ assignedSquawk: e.target.value.replace(/[^0-9]/g, '') })} aria-label="Assigned squawk" />
          </label>
          <div className="clr-field">
            <span className="dim small">Your transponder (IVAO)</span>
            <div className={`sq-live mono ${sqValid && live ? (live === sq ? 'ok' : 'bad') : ''}`}>{live ?? '—'}</div>
          </div>
        </div>
        {sq && !sqValid && <p className="warn small">A squawk is 4 digits from 0 to 7.</p>}
        {sqValid && live && live === sq && <p className="ok-text small">Squawk {sq} is set correctly.</p>}
        {sqValid && live && live !== sq && <p className="warn small">ATC gave you {sq}, but your transponder shows {live}. Set {sq}.</p>}
        {sqValid && !live && <p className="dim small">Your transponder code appears here once you’re connected to IVAO.</p>}
        <p className="fineprint">IVAO doesn’t publish what controllers tell pilots, so type in your squawk and taxi clearance; WebEye checks and draws them.</p>
      </Section>

      <Section title="Taxi" icon={<IconRunway size={15} />} aside={route ? <span className="mono dim">{fmtM(route.lengthM)}</span> : undefined}>
        <form className="taxi-form" onSubmit={show}>
          <input className="input mono taxi-apt" placeholder="ICAO" value={icao} maxLength={4} onChange={(e) => setIcao(e.target.value.toUpperCase())} aria-label="Airport" />
          <input className="input mono" placeholder="34R via A B1   ·   stand C3 via K A" value={text} onChange={(e) => setText(e.target.value)} aria-label="Taxi clearance" />
          <button className="btn" type="submit" disabled={!fc || !text.trim()}>
            Show
          </button>
        </form>
        {!ap && code.length === 4 && <p className="warn small">Unknown airport {code}.</p>}
        {chart?.status === 'loading' && <p className="dim small">Loading the {code} ground chart from OpenStreetMap…</p>}
        {chart?.status === 'error' && (
          <p className="warn small">
            Ground chart unavailable: {chart.error}{' '}
            <button className="link-btn" onClick={() => ap && loadChart(ap.icao)}>
              Retry
            </button>
          </p>
        )}
        {fc && !names.length && <p className="dim small">OpenStreetMap has no named taxiways mapped at {code} yet.</p>}
        {err && <p className="warn small">{err}</p>}
        {!livePos && fc && <p className="dim small">Not on the ground at {code} right now: add “from stand C3” to preview a route.</p>}
        {fc && rwys.length > 0 && (
          <div className="chips" aria-label="Runways">
            {rwys.map((r) => (
              <button key={r} className="chip rwy" type="button" onClick={() => add(r, 'rwy')}>
                {r}
              </button>
            ))}
          </div>
        )}
        {fc && names.length > 0 && (
          <div className="chips" aria-label="Taxiways">
            {names.slice(0, 60).map((n) => (
              <button key={n} className="chip twy" type="button" onClick={() => add(n, 'twy')}>
                {n}
              </button>
            ))}
          </div>
        )}

        {route && (
          <div className="taxi-card">
            {route.suggested && <div className="notice small">Suggested shortest route, not an ATC clearance. Always follow the controller.</div>}
            {prog && prog.offM > 60 && <div className="warn small">You’re {fmtM(prog.offM)} off the taxi route.</div>}
            {prog && (
              <div className="taxi-next">
                <span className="dim small">{prog.stepIdx === route.steps.length - 1 ? 'Next' : `In ${fmtM(prog.toNextM)}`}</span>
                <strong>{route.steps[Math.min(prog.stepIdx + 1, route.steps.length - 1)].text}</strong>
              </div>
            )}
            <ol className="taxi-steps">
              {route.steps.map((s, i) => (
                <li key={i} className={`t-${s.turn} ${prog && i === prog.stepIdx ? 'now' : ''} ${prog && i < prog.stepIdx ? 'done' : ''}`}>
                  <span className="t-ico" aria-hidden="true">
                    {s.turn === 'left' ? '↰' : s.turn === 'right' ? '↱' : s.turn === 'cross' ? '!' : s.turn === 'end' ? '■' : '↑'}
                  </span>
                  <span className="t-text">{s.text}</span>
                  {s.lengthM > 0 && <span className="t-len mono dim">{fmtM(s.lengthM)}</span>}
                </li>
              ))}
            </ol>
            <button className="link-btn" onClick={clear}>
              Clear route
            </button>
          </div>
        )}
        <p className="fineprint">Ground charts load automatically for any airport you zoom into, with or without ATC. Data © OpenStreetMap contributors; it can be incomplete, so always follow ATC and real charts.</p>
      </Section>
    </>
  );
}
