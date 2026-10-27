import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { fetchNetHistory, type NetHistory } from '../data/logbook';
import { getAirport } from '../data/airports';
import { selectAirport } from '../lib/actions';
import { Panel, Section } from './ui';
import { BarList, Stat, TimeLine } from './charts';
import { IconGauge } from './Icons';

const POS_NAME: Record<string, string> = { DEL: 'Delivery', GND: 'Ground', TWR: 'Tower', APP: 'Approach', DEP: 'Departure', CTR: 'Centre', FSS: 'Flight service', RMP: 'Ramp', OTHER: 'Other' };
const hhmm = (t: number) => new Date(t).toISOString().slice(11, 16) + 'Z';

/** Live network statistics from the IVAO feed, plus 18 h of history from the recorder. */
export function StatsPanel() {
  const flights = useStore((s) => s.flights);
  const controllers = useStore((s) => s.controllers);
  const [hist, setHist] = useState<NetHistory | null>(null);
  const [histErr, setHistErr] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    const load = () =>
      fetchNetHistory(ac.signal)
        .then((h) => (setHist(h), setHistErr(null)))
        .catch((e) => !ac.signal.aborted && setHistErr((e as Error).message));
    load();
    const id = window.setInterval(load, 300000);
    return () => (ac.abort(), window.clearInterval(id));
  }, []);

  const s = useMemo(() => {
    const live = flights.filter((f) => !f.demo);
    const air = live.filter((f) => !f.onGround).length;
    const apt = new Map<string, { dep: number; arr: number }>();
    const types = new Map<string, number>();
    for (const f of live) {
      if (f.dep) (apt.get(f.dep) ?? apt.set(f.dep, { dep: 0, arr: 0 }).get(f.dep)!).dep++;
      if (f.arr) (apt.get(f.arr) ?? apt.set(f.arr, { dep: 0, arr: 0 }).get(f.arr)!).arr++;
      if (f.aircraft) types.set(f.aircraft, (types.get(f.aircraft) ?? 0) + 1);
    }
    const busiest = [...apt.entries()]
      .map(([icao, c]) => ({ label: icao, sub: getAirport(icao)?.city || getAirport(icao)?.name, value: c.dep + c.arr, title: `${icao}: ${c.dep} departing, ${c.arr} arriving` }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
    const pos = new Map<string, number>();
    for (const c of controllers) pos.set(c.position, (pos.get(c.position) ?? 0) + 1);
    const byPos = [...pos.entries()].map(([p, n]) => ({ label: p, sub: POS_NAME[p], value: n })).sort((a, b) => b.value - a.value);
    const topTypes = [...types.entries()].map(([t, n]) => ({ label: t, value: n })).sort((a, b) => b.value - a.value).slice(0, 8);
    return { total: live.length, air, ground: live.length - air, busiest, byPos, topTypes };
  }, [flights, controllers]);

  const series = (hist?.hist ?? []).map((h) => ({ t: new Date(h.t).getTime(), v: h.pilots }));
  const peak = series.length ? series.reduce((a, b) => (b.v > a.v ? b : a)) : null;

  return (
    <Panel side="left" label="Network stats" icon={<IconGauge size={20} />} title="Network stats" sub="IVAO right now" onClose={() => useStore.getState().setPanel(null)}>
      <div className="stats-row">
        <Stat k="Pilots" v={s.total} sub={`${s.air} flying · ${s.ground} on ground`} />
        <Stat k="ATC" v={controllers.length} sub="stations online" />
        <Stat k="Peak 18 h" v={peak ? peak.v : '—'} sub={peak ? `at ${hhmm(peak.t)}` : 'collecting'} />
      </div>

      <Section title="Pilots online, last 18 hours">
        {histErr ? <p className="warn small">History unavailable: {histErr}</p> : <TimeLine points={series} label="Pilots online over the last 18 hours" fmtX={hhmm} unit=" pilots" />}
      </Section>

      <Section title="Busiest airports" aside={<span className="dim small">departing + arriving</span>}>
        <BarList rows={s.busiest} onPick={(icao) => getAirport(icao) && selectAirport(icao)} empty="No flight plans filed yet." />
      </Section>

      <Section title="ATC online by position">
        <BarList rows={s.byPos} empty="No controllers online." />
      </Section>

      <Section title="Most flown aircraft">
        <BarList rows={s.topTypes} empty="No aircraft types filed yet." />
      </Section>
      <p className="fineprint">Live counts from IVAO’s public feed; history is sampled every 10 minutes by the WebEye recorder.</p>
    </Panel>
  );
}
