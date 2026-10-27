import { Columns } from './charts';
import { BoardTable, openBoard, useBoards } from './Board';
import type { BoardRow } from '../lib/board';
import { IconBoard } from './Icons';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { getAirport, getRunways, searchAirports, surfaceLabel } from '../data/airports';
import { fetchMetar, fetchTaf } from '../data/weather';
import { selectAirport, selectFlight } from '../lib/actions';
import { ago, dash, fmtAltShort, fmtZulu } from '../lib/format';
import { distanceNm } from '../lib/geo';
import { getMapController } from '../map/FlightMap';
import { Badge, Empty, KV, Panel, Section } from './ui';
import { IconBack, IconCloud, IconPlane, IconRunway, IconTower } from './Icons';
import { AtcRow } from './ATCStations';
import type { Airport, Flight, Metar, Runway } from '../types';
import { chartState, loadChart, onChartsChange } from '../data/charts';
import { useStore as useS } from '../state/store';
import { useSyncExternalStore } from 'react';

function FlightRows({ list, empty, field }: { list: Flight[]; empty: string; field: 'dep' | 'arr' | 'near' }) {
  if (!list.length) return <p className="dim small">{empty}</p>;
  return (
    <ul className="tlist compact">
      {list.slice(0, 40).map((f) => (
        <li key={f.key}>
          <button className="trow" onClick={() => selectFlight(f, { frame: 'route' })}>
            <span className={`phase phase-${f.onGround ? 'ground' : 'enroute'}`} />
            <span className="trow-main">
              <span className="mono strong">{f.callsign}</span>
              <span className="trow-sub">{field === 'dep' ? `to ${f.arr ?? '····'}` : field === 'arr' ? `from ${f.dep ?? '····'}` : `${f.dep ?? '····'} → ${f.arr ?? '····'}`}</span>
            </span>
            <span className="trow-type mono">{f.aircraft ?? '—'}</span>
            <span className="trow-alt mono">{f.onGround ? 'GND' : fmtAltShort(f.altitude)}</span>
            <span className="trow-gs mono">{field === 'arr' && f.arrivalDistance != null && !f.onGround ? `${Math.round(f.arrivalDistance)}nm` : f.groundSpeed ?? '—'}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Weather({ icao }: { icao: string }) {
  const [metar, setMetar] = useState<Metar | null | undefined>(undefined);
  const [taf, setTaf] = useState<string | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    setMetar(undefined);
    setTaf(undefined);
    setErr(null);
    fetchMetar(icao, ctrl.signal).then(setMetar).catch((e) => !ctrl.signal.aborted && setErr(e.message));
    fetchTaf(icao, ctrl.signal).then(setTaf).catch(() => !ctrl.signal.aborted && setTaf(null));
    return () => ctrl.abort();
  }, [icao]);
  return (
    <Section title="Weather" icon={<IconCloud size={15} />} aside={metar?.obsTime ? <span className="mono dim">{fmtZulu(metar.obsTime)} · {ago(metar.obsTime)}</span> : undefined}>
      {err && <p className="warn small">METAR unavailable ({err}).</p>}
      {metar === undefined && !err && <div className="skeleton" />}
      {metar === null && <p className="dim small">No METAR published for {icao}.</p>}
      {metar && (
        <div className="wx">
          {metar.flightCategory && <Badge tone={metar.flightCategory === 'VFR' ? 'teal' : metar.flightCategory === 'MVFR' ? 'blue' : 'red'}>{metar.flightCategory}</Badge>}
          <div className="mono wx-raw">{metar.raw}</div>
        </div>
      )}
      {taf && (
        <details className="remarks">
          <summary>TAF</summary>
          <div className="mono wx-raw">{taf}</div>
        </details>
      )}
      <p className="fineprint">Real-world observations · NOAA Aviation Weather Center. IVAO sessions may use different weather.</p>
    </Section>
  );
}

function ChartCard({ a }: { a: Airport }) {
  const st = useSyncExternalStore(onChartsChange, () => chartState(a.icao));
  return (
    <div className="chart-card">
      <div className="chart-card-text">
        <div className="strong">Ground chart</div>
        <div className="dim small">
          {!st || st.status === 'loading'
            ? 'Loading taxiways, stands and gates…'
            : st.status === 'error'
              ? `Unavailable: ${st.error}`
              : st.fc.features.length === 0
                ? 'No taxiway data mapped for this airport yet.'
                : `${st.counts.taxiways} named taxiways · ${st.counts.stands} stands · ${st.counts.gates} gates`}
        </div>
      </div>
      {st?.status === 'error' ? (
        <button className="btn ghost" onClick={() => loadChart(a.icao)}>
          Retry
        </button>
      ) : (
        <button className="btn" disabled={st?.status !== 'ready'} onClick={() => useS.getState().camera_({ type: 'fly', center: [a.lon, a.lat], zoom: a.size === 3 ? 14 : 15 })}>
          Open chart
        </button>
      )}
    </div>
  );
}

function AirportDetail({ a }: { a: Airport }) {
  const flights = useStore((s) => s.flights);
  const controllers = useStore((s) => s.controllers);
  const [runways, setRunways] = useState<Runway[] | null>(null);
  const [tab, setTab] = useState<'dep' | 'arr' | 'near'>('dep');

  useEffect(() => {
    let alive = true;
    setRunways(null);
    getRunways(a.icao)
      .then((r) => {
        if (!alive) return;
        setRunways(r);
        getMapController()?.setRunways(r.filter((x) => x.coords).map((x) => ({ name: `${x.le}/${x.he}`, coords: x.coords! })));
      })
      .catch(() => alive && setRunways([]));
    return () => {
      alive = false;
    };
  }, [a.icao]);

  const near = useMemo(() => flights.filter((f) => distanceNm(f.lat, f.lon, a.lat, a.lon) < 30 && (f.altitude ?? 0) < 15000 + (a.elevation ?? 0)), [flights, a]);
  const boards = useBoards(a);
  const atc = useMemo(() => controllers.filter((c) => c.airport === a.icao || c.callsign.startsWith(a.icao + '_')), [controllers, a.icao]);

  return (
    <>
      <div className="ap-hero">
        <div className="ap-codes">
          <span className="ap-icao mono">{a.icao}</span>
          {a.iata && <span className="ap-iata mono">{a.iata}</span>}
        </div>
        <div className="ap-name">{a.name}</div>
        <div className="ap-loc">{[a.city, a.country].filter(Boolean).join(', ')}</div>
      </div>
      <div className="grid-kv">
        <KV k="Elevation" v={a.elevation != null ? `${a.elevation.toLocaleString('en-US')} ft` : dash} />
        <KV k="Position" v={`${a.lat.toFixed(3)}, ${a.lon.toFixed(3)}`} />
        <KV k="Departures" v={boards.dep.length} />
        <KV k="Arrivals" v={boards.arr.length} />
      </div>

      <ChartCard a={a} />

      <ArrivalsOutlook rows={boards.arr} icao={a.icao} />

      <Section title="Online ATC" icon={<IconTower size={15} />}>
        {atc.length ? (
          <ul className="tlist compact">
            {atc.map((c) => (
              <AtcRow key={c.key} c={c} />
            ))}
          </ul>
        ) : (
          <p className="dim small">No IVAO controllers online for {a.icao}. Expect UNICOM 122.800.</p>
        )}
      </Section>

      <Section title="Traffic" icon={<IconPlane size={15} />} aside={<button className="chip-btn small" onClick={() => openBoard(a.icao)} title="Full-screen departures and arrivals board"><IconBoard size={14} /> Board</button>}>
        <div className="tabs small" role="tablist">
          {(
            [
              ['dep', `Departures`, boards.dep.length],
              ['arr', `Arrivals`, boards.arr.length],
              ['near', `Nearby`, near.length],
            ] as const
          ).map(([id, label, n]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label} <span className="tab-n mono">{n}</span>
            </button>
          ))}
        </div>
        {tab === 'dep' && <BoardTable rows={boards.dep} kind="dep" />}
        {tab === 'arr' && <BoardTable rows={boards.arr} kind="arr" />}
        {tab === 'near' && <FlightRows list={near} field="near" empty="No aircraft within 30 nm below FL150." />}
      </Section>

      <Weather icao={a.icao} />

      <Section title="Runways" icon={<IconRunway size={15} />}>
        {runways === null && <div className="skeleton" />}
        {runways?.length === 0 && <p className="dim small">No runway data in OurAirports for this airport.</p>}
        {runways && runways.length > 0 && (
          <table className="rwy">
            <thead>
              <tr>
                <th>Runway</th>
                <th>Length</th>
                <th>Surface</th>
                <th>Lit</th>
              </tr>
            </thead>
            <tbody>
              {runways.map((r) => (
                <tr key={r.le + r.he}>
                  <td className="mono strong">
                    {r.le}/{r.he}
                  </td>
                  <td className="mono">{r.lengthFt ? `${r.lengthFt.toLocaleString('en-US')} ft` : dash}</td>
                  <td>{surfaceLabel(r.surface)}</td>
                  <td>{r.lighted ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="fineprint">Runway table: OurAirports (public domain). Ground chart: © OpenStreetMap contributors. Not for real-world navigation.</p>
      </Section>
    </>
  );
}

export function AirportExplorer() {
  const sel = useStore((s) => (s.selection?.kind === 'airport' ? s.selection.icao : null));
  const ready = useStore((s) => s.airportsReady);
  const flights = useStore((s) => s.flights);
  const controllers = useStore((s) => s.controllers);
  const setPanel = useStore((s) => s.setPanel);
  const select = useStore((s) => s.select);
  const [q, setQ] = useState('');
  const a = sel ? getAirport(sel) : null;
  const results = useMemo(() => (ready ? searchAirports(q, 15) : []), [q, ready]);

  const busiest = useMemo(() => {
    const m = new Map<string, { dep: number; arr: number; atc: number }>();
    const bump = (icao: string | null, k: 'dep' | 'arr' | 'atc') => {
      if (!icao) return;
      const e = m.get(icao) ?? { dep: 0, arr: 0, atc: 0 };
      e[k]++;
      m.set(icao, e);
    };
    for (const f of flights) {
      bump(f.dep, 'dep');
      bump(f.arr, 'arr');
    }
    for (const c of controllers) bump(c.airport, 'atc');
    return [...m.entries()].sort((x, y) => y[1].dep + y[1].arr - (x[1].dep + x[1].arr)).slice(0, 12);
  }, [flights, controllers]);

  return (
    <Panel
      side="left"
      label="Airport explorer"
      icon={a ? (
        <button className="icon-btn small" aria-label="Back to airport search" onClick={() => select(null)}>
          <IconBack size={16} />
        </button>
      ) : <IconRunway size={18} />}
      title={a ? a.icao : 'Airports'}
      sub={a ? a.name : 'Explore activity, ATC, weather and runways'}
      onClose={() => {
        setPanel(null);
        if (a) select(null);
      }}
    >
      {a ? (
        <AirportDetail a={a} />
      ) : (
        <>
          <div className="list-tools">
            <input className="input" placeholder="Search ICAO, IATA, city or name…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search airports" autoFocus />
          </div>
          {!ready && <div className="skeleton" />}
          {q.trim().length >= 2 && results.length === 0 && ready && <Empty title="No airport found">Check the ICAO/IATA code or try the city name.</Empty>}
          {q.trim().length >= 2 ? (
            <ul className="tlist">
              {results.map((r) => (
                <li key={r.icao}>
                  <button className="trow" onClick={() => selectAirport(r.icao)}>
                    <span className="mono strong ap-code">{r.icao}</span>
                    <span className="trow-main">
                      <span className="trow-name">{r.name}</span>
                      <span className="trow-sub">{[r.city, r.country].filter(Boolean).join(', ')}</span>
                    </span>
                    <span className="trow-type mono">{r.iata}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Section title="Busiest right now" aside={<span className="dim small">dep · arr · ATC</span>}>
              {busiest.length === 0 && <p className="dim small">Activity appears once traffic has loaded.</p>}
              <ul className="tlist">
                {busiest.map(([icao, n]) => {
                  const ap = getAirport(icao);
                  return (
                    <li key={icao}>
                      <button className="trow" onClick={() => selectAirport(icao)}>
                        <span className="mono strong ap-code">{icao}</span>
                        <span className="trow-main">
                          <span className="trow-name">{ap?.name ?? 'Unknown airport'}</span>
                          <span className="trow-sub">{ap ? [ap.city, ap.country].filter(Boolean).join(', ') : ''}</span>
                        </span>
                        <span className="busy mono">
                          {n.dep}
                          <i>·</i>
                          {n.arr}
                          <i>·</i>
                          <span className={n.atc ? 'atc-on' : ''}>{n.atc}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}
        </>
      )}
    </Panel>
  );
}

/** Inbound flights by estimated arrival time, in 15-minute slots over the next two hours. */
function ArrivalsOutlook({ rows, icao }: { rows: BoardRow[]; icao: string }) {
  const slots = Array.from({ length: 8 }, (_, i) => ({ x: `+${i * 15}`, v: 0, cs: [] as string[] }));
  const now = Date.now();
  for (const r of rows) {
    if (r.time == null || r.timeKind !== 'ETA') continue;
    const i = Math.floor((r.time - now) / 60000 / 15);
    if (i >= 0 && i < slots.length) slots[i].v++, slots[i].cs.push(r.f.callsign);
  }
  const total = slots.reduce((a, b) => a + b.v, 0);
  if (!total) return null;
  return (
    <Section title="Arrivals, next 2 hours" aside={<span className="dim small">{total} expected</span>}>
      <Columns
        height={90}
        label={`Flights expected at ${icao} in 15-minute slots`}
        data={slots.map((s, i) => ({ x: s.x, v: s.v, tip: `${i * 15}–${i * 15 + 15} min: ${s.v ? s.cs.slice(0, 4).join(', ') + (s.cs.length > 4 ? ` +${s.cs.length - 4}` : '') : 'none'}` }))}
      />
      <p className="fineprint">Minutes from now, estimated from each flight's distance and groundspeed.</p>
    </Section>
  );
}

