import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { getAirport } from '../data/airports';
import { fetchEvents, type IvaoEvent } from '../data/events';
import { airportActivity } from '../lib/activity';
import { selectAirport } from '../lib/actions';
import { Panel, Section } from './ui';
import { IconGauge, IconPlane, IconRunway, IconTower } from './Icons';
import { openBoard } from './Board';

const POS_COLOR: Record<string, string> = { DEL: '#9aa6bd', GND: '#34d399', TWR: '#f87171', APP: '#60a5fa', DEP: '#60a5fa' };
const zulu = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(11, 16) + 'Z' : '');
const dayShort = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');

/** At-a-glance network overview: events, busiest airports and where ATC is online. */
export function NowPanel() {
  const flights = useStore((s) => s.flights);
  const controllers = useStore((s) => s.controllers);
  const counts = useStore((s) => s.counts);
  const [events, setEvents] = useState<IvaoEvent[] | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    fetchEvents(ac.signal).then(setEvents).catch(() => setEvents([]));
    return () => ac.abort();
  }, []);
  const act = useMemo(() => airportActivity(flights, controllers), [flights, controllers]);
  const top = act.slice(0, 10);
  const max = Math.max(1, ...top.map((a) => a.dep + a.arr));
  const air = flights.filter((f) => !f.onGround).length;
  const now = Date.now();
  const live = (events ?? []).filter((e) => (!e.start || new Date(e.start).getTime() <= now + 3 * 3600e3) && (!e.end || new Date(e.end).getTime() >= now));
  const later = (events ?? []).filter((e) => !live.includes(e) && e.start && new Date(e.start).getTime() > now).slice(0, 5);
  // Hotspots: the airports busiest right now (by traffic on the ground and close in).
  const hot = act.filter((a) => a.dep + a.arr >= 6).slice(0, 3);

  return (
    <Panel side="left" label="Network now" icon={<IconGauge size={20} />} title="Now on IVAO" sub={new Date().toUTCString().slice(17, 22) + 'Z · live'} onClose={() => useStore.getState().setPanel(null)}>
      <div className="now-kpis">
        <div>
          <b className="mono">{counts.pilots ?? flights.length}</b>
          <span>pilots</span>
        </div>
        <div>
          <b className="mono">{air}</b>
          <span>flying</span>
        </div>
        <div>
          <b className="mono">{counts.atc ?? controllers.length}</b>
          <span>ATC</span>
        </div>
      </div>

      <Section title="Events" aside={live.length ? <span className="now-live">LIVE</span> : undefined}>
        {events === null && <div className="skeleton" />}
        {events !== null && !live.length && !later.length && !hot.length && <p className="dim small">No events right now.</p>}
        <ul className="now-events">
          {live.map((e) => (
            <EventRow key={e.title + e.start} e={e} live />
          ))}
          {later.map((e) => (
            <EventRow key={e.title + e.start} e={e} />
          ))}
          {!live.length &&
            hot.map((a) => {
              const ap = getAirport(a.icao);
              return (
                <li key={a.icao} className="now-event hot">
                  <button onClick={() => selectAirport(a.icao)}>
                    <span className="ne-tag">HOTSPOT</span>
                    <span className="ne-title">
                      <span className="mono strong">{a.icao}</span> {ap?.city || ap?.name}
                    </span>
                    <span className="ne-sub dim small">
                      {a.dep} departing · {a.arr} inbound{a.soon ? ` (${a.soon} landing soon)` : ''}{a.atc.length ? ` · ${a.atc.join(' ')} online` : ' · no ATC'}
                    </span>
                  </button>
                </li>
              );
            })}
        </ul>
        {!live.length && hot.length > 0 && <p className="fineprint">Hotspots are the busiest airports right now, worked out from live traffic. Official IVAO events appear here when IVAO publishes them.</p>}
      </Section>

      <Section title="Busiest airports" aside={<span className="dim small">departing · arriving</span>}>
        <ol className="now-airports">
          {top.map((a, i) => {
            const ap = getAirport(a.icao);
            return (
              <li key={a.icao}>
                <button onClick={() => selectAirport(a.icao)} title={`${ap?.name ?? a.icao}: ${a.dep} departing, ${a.arr} arriving`}>
                  <span className="na-rank mono">{i + 1}</span>
                  <span className="na-main">
                    <span className="na-line">
                      <span className="mono strong">{a.icao}</span>
                      <span className="na-city">{ap?.city || ap?.name}</span>
                      <span className="na-atc">
                        {a.atc.map((p) => (
                          <i key={p} style={{ color: POS_COLOR[p] ?? '#cbd5e1' }}>
                            {p[0]}
                          </i>
                        ))}
                      </span>
                    </span>
                    <span className="na-bar" aria-hidden="true">
                      <span className="na-dep" style={{ width: `${(a.dep / max) * 100}%` }} />
                      <span className="na-arr" style={{ width: `${(a.arr / max) * 100}%` }} />
                    </span>
                  </span>
                  <span className="na-n mono">
                    <IconPlane size={11} style={{ transform: 'rotate(45deg)' }} /> {a.dep}
                    <IconPlane size={11} style={{ transform: 'rotate(135deg)' }} /> {a.arr}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="now-legend dim small">
          <span>
            <i className="na-dep" /> departing
          </span>
          <span>
            <i className="na-arr" /> arriving
          </span>
          <span>
            <IconTower size={12} /> D G T A = ATC online
          </span>
        </div>
      </Section>

      <div className="now-links">
        {top[0] && (
          <button className="chip-btn" onClick={() => openBoard(top[0].icao)}>
            <IconRunway size={15} /> {top[0].icao} board
          </button>
        )}
        <button className="chip-btn" onClick={() => useStore.getState().setPanel('stats')}>
          <IconGauge size={15} /> Charts &amp; leaderboards
        </button>
      </div>
    </Panel>
  );
}

function EventRow({ e, live = false }: { e: IvaoEvent; live?: boolean }) {
  const first = e.airports.find((a) => getAirport(a));
  return (
    <li className={`now-event ${live ? 'live' : ''}`}>
      <button onClick={() => (first ? selectAirport(first) : e.url && window.open(e.url, '_blank', 'noopener'))}>
        <span className="ne-tag">{live ? 'LIVE' : dayShort(e.start)}</span>
        <span className="ne-title">{e.title}</span>
        <span className="ne-sub dim small mono">
          {zulu(e.start)}
          {e.end ? `–${zulu(e.end)}` : ''}
          {e.airports.length ? ` · ${e.airports.join(' ')}` : ''}
        </span>
      </button>
    </li>
  );
}
