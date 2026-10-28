import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { airlineName } from '../data/airlines';
import { getAirport } from '../data/airports';
import { selectFlight } from '../lib/actions';
import { fmtAltShort } from '../lib/format';
import { Panel, Section } from './ui';
import { BarList, Stat } from './charts';
import { IconCopy, IconFilter, IconPlane } from './Icons';

export function openAirline(code: string) {
  useStore.setState({ airline: code.toUpperCase() });
  useStore.getState().setPanel('airline');
}

/** Everything one airline has online right now, plus an embeddable map for its website. */
export function AirlinePanel() {
  const code = useStore((s) => s.airline);
  const flights = useStore((s) => s.flights);
  const only = useStore((s) => s.airlineFilter);
  const [copied, setCopied] = useState(false);
  const list = useMemo(() => (code ? flights.filter((f) => f.callsign.startsWith(code) && /\d/.test(f.callsign.charAt(code.length))) : []), [flights, code]);
  const stats = useMemo(() => {
    const air = list.filter((f) => !f.onGround).length;
    const types = new Map<string, number>();
    const routes = new Map<string, number>();
    for (const f of list) {
      if (f.aircraft) types.set(f.aircraft, (types.get(f.aircraft) ?? 0) + 1);
      if (f.dep || f.arr) routes.set(`${f.dep ?? '····'}–${f.arr ?? '····'}`, (routes.get(`${f.dep ?? '····'}–${f.arr ?? '····'}`) ?? 0) + 1);
    }
    return { air, types: [...types].sort((a, b) => b[1] - a[1]).slice(0, 6), routes: [...routes].sort((a, b) => b[1] - a[1]).slice(0, 6) };
  }, [list]);
  if (!code) return null;
  const name = airlineName(code);
  const base = `${location.origin}${location.pathname}`;
  const embed = `<iframe src="${base}?embed=1&airline=${code}" width="100%" height="520" style="border:0;border-radius:12px" title="${name ?? code} live on IVAO" loading="lazy"></iframe>`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(embed);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      useStore.getState().notify('Copy failed: select the code and copy it by hand');
    }
  };
  return (
    <Panel
      side="left"
      label={`Airline ${code}`}
      icon={<IconPlane size={20} />}
      title={<span className="mono">{code}</span>}
      sub={name ?? 'Airline / virtual airline'}
      onClose={() => (useStore.getState().setPanel(null), useStore.setState({ airlineFilter: null }))}
      actions={
        <button className={`chip-btn ${only === code ? 'on' : ''}`} aria-pressed={only === code} onClick={() => useStore.setState({ airlineFilter: only === code ? null : code })} title="Show only this airline on the map">
          <IconFilter size={15} /> {only === code ? 'Showing only ' + code : 'Show only ' + code}
        </button>
      }
    >
      <div className="stats-row">
        <Stat k="Online" v={list.length} />
        <Stat k="Flying" v={stats.air} />
        <Stat k="On ground" v={list.length - stats.air} />
      </div>
      <Section title="Flights">
        {!list.length && <p className="dim small">No {name ?? code} flights online right now.</p>}
        <ul className="tlist compact">
          {list.slice(0, 60).map((f) => (
            <li key={f.key}>
              <button className="trow" onClick={() => selectFlight(f, { frame: 'route' })}>
                <span className={`phase phase-${f.onGround ? 'ground' : 'enroute'}`} />
                <span className="trow-main">
                  <span className="mono strong">{f.callsign}</span>
                  <span className="trow-sub">
                    {f.dep ?? '····'} → {f.arr ?? '····'}
                    {f.arr && getAirport(f.arr) ? ` · ${getAirport(f.arr)!.city}` : ''}
                  </span>
                </span>
                <span className="trow-type mono">{f.aircraft ?? '—'}</span>
                <span className="trow-alt mono">{f.onGround ? 'GND' : fmtAltShort(f.altitude)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
      {stats.types.length > 0 && (
        <Section title="Fleet online">
          <BarList rows={stats.types.map(([label, value]) => ({ label, value }))} />
        </Section>
      )}
      {stats.routes.length > 0 && (
        <Section title="Routes">
          <BarList rows={stats.routes.map(([label, value]) => ({ label, value }))} />
        </Section>
      )}
      <Section title="Put this on your website">
        <p className="small">Running a virtual airline? Paste this into your site to show your live flights on a map.</p>
        <pre className="embed-code mono">{embed}</pre>
        <button className="btn small" onClick={copy}>
          <IconCopy size={14} /> {copied ? 'Copied' : 'Copy embed code'}
        </button>
        <p className="fineprint">
          Also works with <span className="mono">&amp;airport=OMDB</span> for an airport’s traffic, and <span className="mono">&amp;theme=light</span>.
        </p>
      </Section>
    </Panel>
  );
}
