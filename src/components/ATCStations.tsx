import { firForCallsign } from '../data/firs';
import { shareSelection } from '../lib/share';
import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { selectAirport, selectController, copyText } from '../lib/actions';
import { ago, dash, fmtDuration, fmtFreq, fmtZulu } from '../lib/format';
import { ATC_COLORS } from '../map/controller';
import { Badge, Empty, KV, Panel, Section } from './ui';
import { IconCopy, IconCrosshair, IconShare, IconTower } from './Icons';
import { getAirport } from '../data/airports';
import { FeedProblem } from './TrafficDirectory';
import type { AtcPosition, Controller } from '../types';

const ORDER: AtcPosition[] = ['CTR', 'APP', 'DEP', 'TWR', 'GND', 'DEL', 'RMP', 'FSS', 'OTHER'];
const POS_LABEL: Record<AtcPosition, string> = { CTR: 'Centre', APP: 'Approach', DEP: 'Departure', TWR: 'Tower', GND: 'Ground', DEL: 'Delivery', RMP: 'Ramp', FSS: 'Flight service', OTHER: 'Other' };

export function PosTag({ p }: { p: AtcPosition }) {
  return (
    <span className="postag mono" style={{ color: ATC_COLORS[p], borderColor: ATC_COLORS[p] + '66' }}>
      {p === 'OTHER' ? 'ATC' : p}
    </span>
  );
}

export function AtcRow({ c, selected }: { c: Controller; selected?: boolean }) {
  return (
    <li>
      <button className={`trow atc ${selected ? 'sel' : ''}`} onClick={() => selectController(c)}>
        <PosTag p={c.position} />
        <span className="trow-main">
          <span className="mono strong">{c.callsign}</span>
          <span className="trow-sub">{c.airport ? getAirport(c.airport)?.name ?? c.airport : POS_LABEL[c.position]}</span>
        </span>
        <span className="trow-freq mono">{fmtFreq(c.frequency)}</span>
      </button>
    </li>
  );
}

export function ATCStations() {
  const controllers = useStore((s) => s.controllers);
  const setPanel = useStore((s) => s.setPanel);
  const sel = useStore((s) => (s.selection?.kind === 'atc' ? s.selection.key : null));
  const [pos, setPos] = useState<AtcPosition | 'all'>('all');
  const [q, setQ] = useState('');
  const counts = useMemo(() => {
    const m = new Map<AtcPosition, number>();
    for (const c of controllers) m.set(c.position, (m.get(c.position) ?? 0) + 1);
    return m;
  }, [controllers]);
  const list = useMemo(() => {
    const s = q.trim().toUpperCase();
    return controllers
      .filter((c) => (pos === 'all' || c.position === pos) && (!s || c.callsign.includes(s)))
      .sort((a, b) => ORDER.indexOf(a.position) - ORDER.indexOf(b.position) || a.callsign.localeCompare(b.callsign));
  }, [controllers, pos, q]);

  return (
    <Panel side="left" label="Online ATC" icon={<IconTower size={18} />} title="Online ATC" sub={`${controllers.length} stations`} onClose={() => setPanel(null)}>
      <div className="chips wrap">
        <button className={`chip ${pos === 'all' ? 'on' : ''}`} onClick={() => setPos('all')}>
          All <span className="mono dim">{controllers.length}</span>
        </button>
        {ORDER.filter((p) => counts.get(p)).map((p) => (
          <button key={p} className={`chip ${pos === p ? 'on' : ''}`} onClick={() => setPos(p)}>
            <span className="dot" style={{ background: ATC_COLORS[p] }} />
            {POS_LABEL[p]} <span className="mono dim">{counts.get(p)}</span>
          </button>
        ))}
      </div>
      <div className="list-tools">
        <input className="input" placeholder="Filter by callsign…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter ATC by callsign" />
      </div>
      <FeedProblem />
      {list.length === 0 && controllers.length > 0 && <Empty title="No stations match">Clear the filter to see every online station.</Empty>}
      {controllers.length === 0 && (useStore.getState().status === 'live' || useStore.getState().status === 'stale') && <Empty icon={<IconTower size={22} />} title="No ATC online right now">Stations appear here as soon as controllers connect.</Empty>}
      <ul className="tlist">
        {list.map((c) => (
          <AtcRow key={c.key} c={c} selected={c.key === sel} />
        ))}
      </ul>
    </Panel>
  );
}

export function AtcDetailsPanel({ c }: { c: Controller }) {
  const st = useStore.getState();
  const ap = getAirport(c.airport);
  const fir = firForCallsign(c.callsign);
  return (
    <Panel
      side="right"
      label={`ATC ${c.callsign}`}
      icon={<IconTower size={20} />}
      title={
        <span className="cs-title">
          <span className="mono">{c.callsign}</span>
          {c.demo && <Badge tone="demo">DEMO</Badge>}
        </span>
      }
      sub={POS_LABEL[c.position]}
      onClose={() => st.select(null)}
      actions={
        <>
          {(c.lat != null || fir) && (
            <button className="chip-btn" onClick={() => selectController(c)}>
              <IconCrosshair size={15} /> Locate
            </button>
          )}
          {c.frequency != null && (
            <button className="chip-btn" onClick={() => copyText(fmtFreq(c.frequency))}>
              <IconCopy size={15} /> Copy freq
            </button>
          )}
          {ap && (
            <button className="chip-btn" onClick={() => selectAirport(ap.icao)}>
              Airport
            </button>
          )}
          <button className="chip-btn" onClick={() => shareSelection(`${c.callsign} on IVAO WebEye`, { kind: 'atc', key: c.key })} title="Copy a link to this station">
            <IconShare size={15} /> Share
          </button>
        </>
      }
    >
      <div className="freq-hero">
        <PosTag p={c.position} />
        <span className="freq mono">{fmtFreq(c.frequency)}</span>
        <span className="dim">MHz</span>
      </div>
      <Section title="Station">
        <div className="grid-kv">
          <KV k="Position" v={POS_LABEL[c.position]} mono={false} />
          <KV k="Online" v={c.connectedAt ? fmtDuration((Date.now() - new Date(c.connectedAt).getTime()) / 1000) : dash} />
          <KV k="IVAO VID" v={c.vid} />
          <KV k="Airport" v={ap ? `${ap.icao} · ${ap.city || ap.name}` : dash} mono={false} />
          {fir && <KV k="Airspace" v={`${fir.n} (${fir.b.join(', ')})`} mono={false} wide note="Boundary from the VATSpy Data Project; the controller's actual sector split may differ" />}
          <KV k="Map position" v={fir ? 'FIR boundary' : c.locationSource === 'feed' ? 'From feed' : c.locationSource === 'airport' ? 'Airport reference point' : 'Not plotted'} mono={false} wide note={fir ? undefined : 'Coverage rings on the map are indicative only, not real sector boundaries'} />
        </div>
      </Section>
      <Section title="ATIS / Information" aside={c.atisTime ? <span className="mono dim">{fmtZulu(c.atisTime)} · {ago(c.atisTime)}</span> : undefined}>
        {c.atis.length ? (
          <pre className="atis mono">{c.atis.join('\n')}</pre>
        ) : (
          <p className="dim small">No ATIS or controller information published.</p>
        )}
      </Section>
    </Panel>
  );
}
