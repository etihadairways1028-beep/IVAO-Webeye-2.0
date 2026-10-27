import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { getAirport } from '../data/airports';
import { arrivals, departures, hhmmZ, type BoardRow } from '../lib/board';
import { selectFlight } from '../lib/actions';
import { IconBoard, IconX } from './Icons';
import type { Airport } from '../types';

/** Text in split-flap cells; changed characters flip. */
function Flap({ text, width, className = '' }: { text: string; width: number; className?: string }) {
  const padded = text.toUpperCase().slice(0, width).padEnd(width, ' ');
  const prev = useRef(padded);
  const [flip, setFlip] = useState<boolean[]>([]);
  useEffect(() => {
    if (prev.current === padded) return;
    const changed = [...padded].map((c, i) => c !== prev.current[i]);
    prev.current = padded;
    setFlip(changed);
    const id = window.setTimeout(() => setFlip([]), 900);
    return () => window.clearTimeout(id);
  }, [padded]);
  return (
    <span className={`flap ${className}`} aria-label={text}>
      {[...padded].map((c, i) => (
        <span key={i} className={`flap-c ${flip[i] ? 'flip' : ''}`} style={flip[i] ? { animationDelay: `${i * 35}ms` } : undefined} aria-hidden="true">
          {c === ' ' ? ' ' : c}
        </span>
      ))}
    </span>
  );
}

function cityOf(icao: string | null) {
  if (!icao) return '····';
  const a = getAirport(icao);
  return a ? a.city || a.name : icao;
}

export function BoardTable({ rows, kind, big = false, limit = 40 }: { rows: BoardRow[]; kind: 'dep' | 'arr'; big?: boolean; limit?: number }) {
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches;
  const W = narrow ? { cs: 7, place: 9, st: 9 } : { cs: 8, place: 13, st: 12 };
  if (!rows.length) return <p className="dim small board-empty">{kind === 'dep' ? 'No departures right now.' : 'No arrivals right now.'}</p>;
  return (
    <table className={`fids ${big ? 'big' : ''}`}>
      <thead>
        <tr>
          <th>{kind === 'dep' ? 'Dep' : 'ETA'}</th>
          <th>Flight</th>
          <th>{kind === 'dep' ? 'To' : 'From'}</th>
          {big && <th>Type</th>}
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, limit).map((r) => (
          <tr key={r.f.key} onClick={() => !big && selectFlight(r.f, { frame: 'route' })} className={big ? '' : 'clickable'}>
            <td className="mono">{big ? <Flap text={r.time ? hhmmZ(r.time) : '--:--'} width={5} /> : r.time ? hhmmZ(r.time) : '--:--'}</td>
            <td className="mono strong">{big ? <Flap text={r.f.callsign} width={W.cs} /> : r.f.callsign}</td>
            <td className="fids-place">
              {big ? (
                <Flap text={cityOf(r.other)} width={W.place} />
              ) : (
                <>
                  <span className="mono">{r.other ?? '····'}</span> <span className="dim">{cityOf(r.other)}</span>
                </>
              )}
            </td>
            {big && (
              <td className="mono">
                <Flap text={r.f.aircraft ?? ''} width={4} />
              </td>
            )}
            <td>{big ? <Flap text={r.status} width={W.st} className={`st-${r.tone}`} /> : <span className={`fids-st st-${r.tone}`}>{r.status}</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function useBoards(a: Airport) {
  const flights = useStore((s) => s.flights);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, []);
  return useMemo(() => ({ dep: departures(a, flights, now), arr: arrivals(a, flights, now) }), [a, flights, now]);
}

export function openBoard(icao: string) {
  useStore.setState({ board: icao });
  history.replaceState(history.state, '', `${location.pathname}${location.search}#board=${icao}`);
}
export function closeBoard() {
  useStore.setState({ board: null });
  if (location.hash.startsWith('#board=')) history.replaceState(history.state, '', `${location.pathname}${location.search}`);
}

/** Full-screen airport board: departures and arrivals side by side, for second screens and streams. */
export function BoardOverlay() {
  const icao = useStore((s) => s.board);
  const a = icao ? getAirport(icao) : null;
  useEffect(() => {
    const m = /^#board=([A-Z0-9]{3,4})$/i.exec(location.hash);
    if (m) useStore.setState({ board: m[1].toUpperCase() });
  }, []);
  useEffect(() => {
    if (!icao) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && closeBoard();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [icao]);
  if (!icao) return null;
  if (!a) return null;
  return <BoardScreen a={a} />;
}

function BoardScreen({ a }: { a: Airport }) {
  const { dep, arr } = useBoards(a);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const controllers = useStore((s) => s.controllers);
  const atc = useMemo(() => controllers.filter((c) => c.airport === a.icao || c.callsign.startsWith(a.icao + '_')), [controllers, a.icao]);
  return (
    <div className="board-screen" role="dialog" aria-label={`${a.icao} airport board`}>
      <header className="bs-head">
        <div className="bs-title">
          <IconBoard size={26} />
          <div>
            <div className="bs-name">{a.name}</div>
            <div className="bs-sub mono">
              {a.icao}
              {a.iata ? ` · ${a.iata}` : ''} · {a.city}
              {a.country ? `, ${a.country}` : ''}
            </div>
          </div>
        </div>
        <div className="bs-atc">
          {atc.length ? atc.map((c) => <span key={c.key} className={`bs-pos mono pos-${c.position}`}>{c.position}</span>) : <span className="dim small">No ATC online · UNICOM 122.800</span>}
        </div>
        <div className="bs-clock mono">
          {new Date(clock).toISOString().slice(11, 19)}
          <span>UTC</span>
        </div>
        <button className="icon-btn" onClick={closeBoard} aria-label="Close board" title="Close (Esc)">
          <IconX />
        </button>
      </header>
      <div className="bs-cols">
        <section>
          <h2>
            Departures <span className="mono dim">{dep.length}</span>
          </h2>
          <BoardTable rows={dep} kind="dep" big limit={14} />
        </section>
        <section>
          <h2>
            Arrivals <span className="mono dim">{arr.length}</span>
          </h2>
          <BoardTable rows={arr} kind="arr" big limit={14} />
        </section>
      </div>
      <footer className="bs-foot dim small">Live from IVAO · times are estimates from distance and groundspeed · IVAO WebEye</footer>
    </div>
  );
}
