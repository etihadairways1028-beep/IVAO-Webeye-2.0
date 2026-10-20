import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { searchAirports } from '../data/airports';
import { selectAirport, selectController, selectFlight } from '../lib/actions';
import { fmtAlt, fmtFreq } from '../lib/format';
import { IconPlane, IconRunway, IconSearch, IconTower, IconX } from './Icons';
import type { Airport, Controller, Flight } from '../types';

type Result = { kind: 'flight'; f: Flight; why: string } | { kind: 'airport'; a: Airport } | { kind: 'atc'; c: Controller };

function matchFlight(f: Flight, q: string): string | null {
  if (f.callsign.startsWith(q)) return 'Callsign';
  if (f.registration && f.registration.replace('-', '').startsWith(q.replace('-', ''))) return 'Registration';
  if (/^\d{4,7}$/.test(q) && String(f.vid) === q) return 'VID';
  if (q.length >= 3 && f.callsign.includes(q)) return 'Callsign';
  if (f.aircraft === q) return 'Aircraft type';
  if (q.length === 4 && f.dep === q) return 'Departure';
  if (q.length === 4 && f.arr === q) return 'Arrival';
  return null;
}

export function FlightSearch({ onClose, autoFocus }: { onClose?: () => void; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const flights = useStore((s) => s.flights);
  const controllers = useStore((s) => s.controllers);
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const airportsReady = useStore((s) => s.airportsReady);
  const dq = useDeferredValue(q.trim().toUpperCase());

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const results = useMemo<Result[]>(() => {
    if (dq.length < 2) return [];
    const fr: Result[] = [];
    for (const f of flights) {
      const why = matchFlight(f, dq);
      if (why) fr.push({ kind: 'flight', f, why });
      if (fr.length >= 40) break;
    }
    fr.sort((a, b) => (a.kind === 'flight' && b.kind === 'flight' ? (a.f.callsign.startsWith(dq) ? 0 : 1) - (b.f.callsign.startsWith(dq) ? 0 : 1) || a.f.callsign.localeCompare(b.f.callsign) : 0));
    const atc: Result[] = controllers.filter((c) => c.callsign.startsWith(dq) || c.callsign.replace('_', '').startsWith(dq)).slice(0, 4).map((c) => ({ kind: 'atc', c }));
    const ap: Result[] = airportsReady ? searchAirports(dq, 5).map((a) => ({ kind: 'airport', a })) : [];
    return [...fr.slice(0, 8), ...atc, ...ap];
  }, [dq, flights, controllers, airportsReady]);

  useEffect(() => setActive(0), [dq]);

  const choose = (r: Result) => {
    if (r.kind === 'flight') selectFlight(r.f, { frame: 'route' });
    else if (r.kind === 'atc') selectController(r.c);
    else selectAirport(r.a.icao);
    setOpen(false);
    setQ('');
    input.current?.blur();
    onClose?.();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && results[active]) {
      choose(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      input.current?.blur();
      onClose?.();
    }
  };

  const loading = (status === 'connecting' || status === 'idle') && flights.length === 0;
  const showPanel = open && q.trim().length >= 2;

  return (
    <div className="search" role="combobox" aria-expanded={showPanel} aria-haspopup="listbox" aria-owns="search-results">
      <IconSearch size={16} className="search-icon" />
      <input
        ref={input}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKey}
        placeholder="Search callsign, VID, type, airport…"
        aria-label="Search flights, airports and ATC"
        aria-autocomplete="list"
        aria-controls="search-results"
        aria-activedescendant={showPanel && results[active] ? `sr-${active}` : undefined}
        spellCheck={false}
        autoComplete="off"
      />
      {q ? (
        <button className="search-clear" aria-label="Clear search" onMouseDown={(e) => e.preventDefault()} onClick={() => setQ('')}>
          <IconX size={14} />
        </button>
      ) : (
        <kbd className="search-kbd hide-mobile">/</kbd>
      )}
      {onClose && (
        <button className="search-cancel only-mobile" onClick={onClose}>
          Cancel
        </button>
      )}
      {showPanel && (
        <div className="search-panel glass" id="search-results" role="listbox">
          {loading && <div className="sr-empty">Loading live traffic…</div>}
          {!loading && status === 'error' && flights.length === 0 && <div className="sr-empty warn">Traffic unavailable: {error}</div>}
          {!loading && results.length === 0 && (
            <div className="sr-empty">
              No flights, stations or airports match “{q.trim()}”.
              <span>Try a callsign (UAE12), VID, ICAO type (A320) or airport (OMDB).</span>
            </div>
          )}
          {results.map((r, i) => (
            <div
              key={r.kind === 'flight' ? r.f.key : r.kind === 'atc' ? r.c.key : r.a.icao}
              id={`sr-${i}`}
              role="option"
              aria-selected={i === active}
              className={`sr ${i === active ? 'active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(r)}
            >
              {r.kind === 'flight' && (
                <>
                  <span className="sr-ic">
                    <IconPlane size={16} style={{ transform: `rotate(${r.f.heading ?? 0}deg)` }} />
                  </span>
                  <span className="sr-main">
                    <span className="mono strong">{r.f.callsign}</span>
                    <span className="sr-sub">
                      {r.f.aircraft ?? '—'} · {r.f.dep ?? '····'} → {r.f.arr ?? '····'}
                    </span>
                  </span>
                  <span className="sr-meta">
                    <span className="mono">{r.f.onGround ? 'GND' : fmtAlt(r.f.altitude)}</span>
                    <span className="sr-why">{r.why}</span>
                  </span>
                </>
              )}
              {r.kind === 'atc' && (
                <>
                  <span className="sr-ic">
                    <IconTower size={16} />
                  </span>
                  <span className="sr-main">
                    <span className="mono strong">{r.c.callsign}</span>
                    <span className="sr-sub">ATC · {r.c.position}</span>
                  </span>
                  <span className="sr-meta mono">{fmtFreq(r.c.frequency)}</span>
                </>
              )}
              {r.kind === 'airport' && (
                <>
                  <span className="sr-ic">
                    <IconRunway size={16} />
                  </span>
                  <span className="sr-main">
                    <span className="mono strong">
                      {r.a.icao}
                      {r.a.iata && <span className="dim"> / {r.a.iata}</span>}
                    </span>
                    <span className="sr-sub">{r.a.name}</span>
                  </span>
                  <span className="sr-meta">{r.a.country}</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
