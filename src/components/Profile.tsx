import { FriendStar } from './Friends';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { badges, fetchLogbook, landingRate, type Logbook as LB } from '../data/logbook';
import { getAirport } from '../data/airports';
import { selectAirport } from '../lib/actions';
import { Panel, Section } from './ui';
import { BarList, Stat } from './charts';
import { FlightRow, hm, LinkCard } from './Logbook';
import { IconGlobe, IconShare, IconUser } from './Icons';

export function profileLink(vid: number) {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#u=${vid}`;
}

/** Public pilot profile: totals, badges, airports and every logged route on the map. */
export function Profile() {
  const vid = useStore((s) => s.profileVid);
  const myVid = useStore((s) => s.prefs.myVid);
  const logView = useStore((s) => s.logView);
  const flightsOnline = useStore((s) => s.flights);
  const [data, setData] = useState<LB | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!vid) return;
    setData(null);
    const ac = new AbortController();
    fetchLogbook(vid, ac.signal)
      .then((d) => (setData(d), setErr(null)))
      .catch((e) => !ac.signal.aborted && setErr((e as Error).message));
    return () => ac.abort();
  }, [vid]);

  const flights = data?.flights ?? [];
  const online = flightsOnline.find((f) => f.vid === vid && !f.demo);
  const callsign = online?.callsign ?? flights[0]?.callsign;
  const t = useMemo(() => {
    const min = flights.reduce((a, f) => a + f.airborneMin, 0);
    const nm = flights.reduce((a, f) => a + f.distanceNm, 0);
    const apt = new Map<string, number>();
    for (const f of flights) for (const a of [f.dep, f.arr]) if (a) apt.set(a, (apt.get(a) ?? 0) + 1);
    const types = new Map<string, number>();
    for (const f of flights) if (f.aircraft) types.set(f.aircraft, (types.get(f.aircraft) ?? 0) + 1);
    const rates = flights.map(landingRate).filter((r) => r && r.source === 'sim').map((r) => Math.abs(r!.fpm));
    return {
      min,
      nm,
      airports: [...apt.entries()].sort((a, b) => b[1] - a[1]),
      types: [...types.entries()].sort((a, b) => b[1] - a[1]),
      best: rates.length ? Math.min(...rates) : null,
    };
  }, [flights]);
  const bs = useMemo(() => badges(flights, data?.atcMinutes ?? 0), [flights, data?.atcMinutes]);
  const earned = bs.filter((b) => b.earned).length;
  const allOn = logView && !logView.landed && logView.routes.length > 1;

  const showAll = () => {
    if (allOn) return useStore.setState({ logView: null });
    const routes = flights.map((f) => ({ route: f.route, dep: f.dep, arr: f.arr }));
    useStore.setState({ logView: { routes } });
    const pts = flights.flatMap((f) => f.route);
    if (pts.length) useStore.getState().camera_({ type: 'fit', bounds: [[Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))], [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]], maxZoom: 7 });
  };
  const share = async () => {
    const url = profileLink(vid!);
    try {
      await navigator.clipboard.writeText(url);
      useStore.getState().notify('Profile link copied');
    } catch {
      useStore.getState().notify(url);
    }
  };

  if (!vid) return null;
  const mine = String(vid) === myVid;
  return (
    <Panel
      side="left"
      label="Pilot profile"
      icon={<IconUser size={20} />}
      title={<span className="mono">{callsign ?? `VID ${vid}`}</span>}
      sub={
        <>
          IVAO VID {vid}
          {online ? ' · online now' : ''}
          {mine ? ' · you' : ''}
        </>
      }
      onClose={() => {
        useStore.getState().setPanel(null);
        useStore.setState({ logView: null, profileVid: null });
        if (location.hash.startsWith('#u=')) history.replaceState(history.state, '', `${location.pathname}${location.search}`);
      }}
      actions={
        <>
          <FriendStar vid={vid} name={callsign ?? `VID ${vid}`} />
          <button className="chip-btn" onClick={share} title="Copy a link to this profile">
            <IconShare size={15} /> Share
          </button>
          <button className={`chip-btn ${allOn ? 'on' : ''}`} onClick={showAll} disabled={!flights.length} aria-pressed={!!allOn} title="Draw every logged flight on the map">
            <IconGlobe size={15} /> All routes
          </button>
        </>
      }
    >
      {err && <p className="warn small">Couldn’t load this profile: {err}</p>}
      {!data && !err && <div className="skeleton" />}
      {data && (
        <>
          <div className="stats-row">
            <Stat k="Flights" v={flights.length} />
            <Stat k="Hours" v={hm(t.min)} />
            <Stat k="Distance" v={t.nm.toLocaleString()} sub="NM" />
            <Stat k="Airports" v={t.airports.length} />
            {(data.atcMinutes ?? 0) > 0 && <Stat k="ATC" v={hm(data.atcMinutes ?? 0)} sub="hours" />}
            {t.best != null && <Stat k="Best landing" v={t.best} sub="fpm (sim)" />}
          </div>

          <Section title="Badges" aside={<span className="dim small mono">{earned}/{bs.length}</span>}>
            <ul className="badges">
              {bs.map((b) => (
                <li key={b.id} className={b.earned ? 'earned' : ''} title={b.desc}>
                  <span className="bdg-ico" aria-hidden="true">
                    <BadgeIcon id={b.id} />
                  </span>
                  <span className="bdg-name">{b.name}</span>
                  <span className="bdg-sub dim">{b.earned ? b.desc : b.progress}</span>
                </li>
              ))}
            </ul>
          </Section>

          {t.airports.length > 0 && (
            <Section title="Airports visited">
              <BarList rows={t.airports.slice(0, 8).map(([icao, n]) => ({ label: icao, sub: getAirport(icao)?.city || getAirport(icao)?.name, value: n, title: `${icao}: ${n} visit${n === 1 ? '' : 's'}` }))} onPick={(icao) => getAirport(icao) && selectAirport(icao)} />
            </Section>
          )}
          {t.types.length > 0 && (
            <Section title="Aircraft flown">
              <BarList rows={t.types.slice(0, 6).map(([ty, n]) => ({ label: ty, value: n }))} />
            </Section>
          )}

          <Section title="Recent flights">
            {!flights.length && <p className="dim small">No flights logged yet. Flights appear here after landing while connected to IVAO.</p>}
            <ol className="log-list">
              {flights.slice(0, 15).map((f) => (
                <FlightRow
                  key={f.landed}
                  f={f}
                  on={logView?.landed === f.landed}
                  onClick={() => {
                    if (logView?.landed === f.landed) return useStore.setState({ logView: null });
                    useStore.setState({ logView: { routes: [{ route: f.route, dep: f.dep, arr: f.arr }], landed: f.landed } });
                    const lons = f.route.map((p) => p[0]), lats = f.route.map((p) => p[1]);
                    if (lons.length) useStore.getState().camera_({ type: 'fit', bounds: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], maxZoom: 9 });
                  }}
                />
              ))}
            </ol>
          </Section>
          {mine && !flights.some((f) => f.touchdown) && <LinkCard />}
          <p className="fineprint">Built from IVAO’s public data by the Pulse recorder. Anyone with the link can see this profile.</p>
        </>
      )}
    </Panel>
  );
}

function BadgeIcon({ id }: { id: string }) {
  const p = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'butter':
      return (
        <svg {...p}>
          <path d="M3 17h18M6 13c3-4 9-4 12 0" />
          <path d="M12 5v4" />
        </svg>
      );
    case 'longhaul':
    case 'h10':
    case 'h100':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l3 2" />
        </svg>
      );
    case 'far':
    case 'globe':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="8" />
          <path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16" />
        </svg>
      );
    case 'streak':
      return (
        <svg {...p}>
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M4 10h16M9 3v4M15 3v4" />
        </svg>
      );
    case 'atc':
      return (
        <svg {...p}>
          <path d="M9 21l1-8h4l1 8M8 13h8l1-4H7zM12 9V5M9 5h6" />
        </svg>
      );
    default:
      return (
        <svg {...p}>
          <path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z" />
        </svg>
      );
  }
}
