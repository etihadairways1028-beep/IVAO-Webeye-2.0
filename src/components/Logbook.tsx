import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { fetchLogbook, landingRate, type Logbook as LB, type LoggedFlight } from '../data/logbook';
import { ago } from '../lib/format';
import { Panel, Section } from './ui';
import { Columns, Stat } from './charts';
import { IconClock, IconPlane, IconRefresh, IconUser } from './Icons';
import { LINK_EXE, LINK_PY } from '../data/logbook';

export function openProfile(vid: number) {
  useStore.setState({ profileVid: vid, selection: null });
  history.replaceState(history.state, '', `${location.pathname}${location.search}#u=${vid}`);
  useStore.getState().setPanel('profile');
}

/** Download card for the Pulse Link sim add-on. */
export function LinkCard() {
  return (
    <div className="link-card">
      <div className="link-card-head">
        <strong>Get exact landing rates</strong>
        <span className="badge badge-teal">MSFS · X-Plane</span>
      </div>
      <p className="small">Pulse Link runs next to your sim and sends your real touchdown: fpm, G-force, bounces and fuel used. Run it, type your VID once, fly.</p>
      <div className="link-card-actions">
        <a className="btn" href={LINK_EXE} rel="noopener">
          Download for Windows
        </a>
        <a className="link-btn" href={LINK_PY} rel="noopener">
          Mac / Linux (X-Plane, Python)
        </a>
      </div>
      <p className="fineprint">Windows may warn that the app is from an unknown publisher: choose More info → Run anyway. It only sends your VID and touchdown numbers.</p>
    </div>
  );
}

export function FlightRow({ f, on, onClick }: { f: LoggedFlight; on: boolean; onClick: () => void }) {
  const lr = landingRate(f);
  const td = f.touchdown;
  return (
    <li>
      <button className={`log-row ${on ? 'on' : ''}`} onClick={onClick} aria-pressed={on}>
        <div className="log-top">
          <span className="mono strong">{f.dep ?? '····'}</span>
          <IconPlane size={13} style={{ transform: 'rotate(90deg)' }} />
          <span className="mono strong">{f.arr ?? '····'}</span>
          <span className="dim small mono">
            {f.callsign}
            {f.aircraft ? ` · ${f.aircraft}` : ''}
          </span>
          <span className="log-date dim small">{day(f.landed)}</span>
        </div>
        <div className="log-meta mono small">
          <span>
            {zulu(f.takeoff)}–{zulu(f.landed)}
          </span>
          <span>{hm(f.airborneMin)} h</span>
          <span>{f.distanceNm} NM</span>
          <span>FL{Math.round(f.maxAlt / 100)}</span>
          {lr && (
            <span className={`log-rate ${lr.source}`} title={lr.source === 'sim' ? `Exact touchdown from Pulse Link (${td?.sim}).` : lr.source === 'seen' ? 'Vertical speed on the last report before touchdown, seen by this browser. An estimate.' : 'Average descent over the last minute before touchdown. A rough estimate, not the touchdown rate.'}>
              {lr.fpm} fpm {lr.source === 'est' ? '(est.)' : `· ${grade(lr.fpm)}`}
              {lr.source === 'sim' && <i className="sim-tag">sim</i>}
            </span>
          )}
        </div>
        {td && (
          <div className="log-td mono small">
            {td.g != null && <span>{td.g.toFixed(2)} G</span>}
            {td.ias != null && <span>{td.ias} kt</span>}
            {td.pitch != null && <span>pitch {td.pitch}°</span>}
            {td.bank != null && <span>bank {td.bank}°</span>}
            <span>{td.bounces ? `${td.bounces} bounce${td.bounces > 1 ? 's' : ''}` : 'no bounce'}</span>
            {td.fuelUsedKg != null && <span>{td.fuelUsedKg.toLocaleString()} kg fuel</span>}
          </div>
        )}
      </button>
    </li>
  );
}

export const hm = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`;
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const zulu = (t: number) => new Date(t).toISOString().slice(11, 16) + 'Z';

/** Plain-language feel for a touchdown descent rate. */
export function grade(fpm: number): string {
  const v = Math.abs(fpm);
  return v < 150 ? 'Butter' : v < 300 ? 'Smooth' : v < 500 ? 'Normal' : v < 700 ? 'Firm' : 'Hard';
}

function weekStart(t: number) {
  const d = new Date(t);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.getTime();
}

export function Logbook() {
  const myVid = useStore((s) => s.prefs.myVid);
  const setPrefs = useStore((s) => s.setPrefs);
  const logView = useStore((s) => s.logView);
  const [vid, setVid] = useState(myVid);
  const [data, setData] = useState<LB | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  const n = Number(myVid);
  useEffect(() => {
    if (!myVid || !Number.isFinite(n)) return;
    const ac = new AbortController();
    setBusy(true);
    fetchLogbook(n, ac.signal)
      .then((d) => (setData(d), setErr(null)))
      .catch((e) => !ac.signal.aborted && setErr((e as Error).message))
      .finally(() => setBusy(false));
    const id = window.setInterval(() => setNonce((x) => x + 1), 120000);
    return () => (ac.abort(), window.clearInterval(id));
  }, [myVid, nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const flights = data?.flights ?? [];
  const totals = useMemo(() => {
    const min = flights.reduce((a, f) => a + f.airborneMin, 0);
    const nm = flights.reduce((a, f) => a + f.distanceNm, 0);
    const rates = flights.map(landingRate).filter((r): r is NonNullable<typeof r> => !!r);
    const avg = rates.length ? Math.round(rates.reduce((a, r) => a + Math.abs(r.fpm), 0) / rates.length) : null;
    const best = rates.length ? Math.min(...rates.map((r) => Math.abs(r.fpm))) : null;
    return { min, nm, avg, best };
  }, [flights]);

  const weeks = useMemo(() => {
    const now = weekStart(Date.now());
    const out = Array.from({ length: 8 }, (_, i) => ({ t: now - (7 - i) * 7 * 864e5, min: 0, n: 0 }));
    for (const f of flights) {
      const w = out.find((o) => o.t === weekStart(f.takeoff));
      if (w) (w.min += f.airborneMin), w.n++;
    }
    return out.map((o) => ({ x: day(o.t), v: Math.round((o.min / 60) * 10) / 10, tip: `Week of ${day(o.t)}: ${hm(o.min)} h · ${o.n} flight${o.n === 1 ? '' : 's'}` }));
  }, [flights]);

  const show = (f: LoggedFlight) => {
    const st = useStore.getState();
    if (logView?.landed === f.landed) {
      useStore.setState({ logView: null });
      return;
    }
    useStore.setState({ logView: { routes: [{ route: f.route, dep: f.dep, arr: f.arr }], landed: f.landed } });
    const lons = f.route.map((p) => p[0]), lats = f.route.map((p) => p[1]);
    if (lons.length) st.camera_({ type: 'fit', bounds: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], maxZoom: 9 });
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const v = vid.trim();
    if (/^\d{3,8}$/.test(v)) setPrefs({ myVid: v });
  };

  return (
    <Panel side="left" label="Logbook" icon={<IconClock size={20} />} title="Logbook" sub={myVid ? `IVAO VID ${myVid}` : 'Your flights, logged automatically'} onClose={() => (useStore.getState().setPanel(null), useStore.setState({ logView: null }))}
      actions={myVid ? (
        <>
          <button className="chip-btn" onClick={() => openProfile(Number(myVid))} title="Your pilot profile and badges">
            <IconUser size={15} /> Profile
          </button>
          <button className="chip-btn" onClick={() => setNonce((x) => x + 1)} disabled={busy} title="Refresh">
            <IconRefresh size={15} /> {busy ? 'Loading…' : 'Refresh'}
          </button>
        </>
      ) : undefined}
    >
      {!myVid ? (
        <Section title="Start your logbook">
          <p className="small">Enter your IVAO VID once. Every flight you fly on IVAO from now on is logged when you land: route, time, distance, altitude and landing rate. Nothing to install, no sign-in.</p>
          <form className="taxi-form" onSubmit={save}>
            <input className="input mono" inputMode="numeric" placeholder="IVAO VID" value={vid} onChange={(e) => setVid(e.target.value.replace(/\D/g, ''))} aria-label="IVAO VID" />
            <button className="btn" type="submit" disabled={!/^\d{3,8}$/.test(vid)}>
              Start
            </button>
          </form>
        </Section>
      ) : (
        <>
          {err && <p className="warn small">Couldn’t load the logbook: {err}</p>}
          {data?.active.map((a) => (
            <div key={a.session} className="log-active">
              <span className="live-dot" aria-hidden="true" />
              <span className="mono strong">{a.callsign}</span>
              <span className="mono">{a.dep ?? '····'} → {a.arr ?? '····'}</span>
              <span className="dim small">airborne {ago(a.takeoff).replace(' ago', '')} · logs when you land</span>
            </div>
          ))}

          <div className="stats-row">
            <Stat k="Flights" v={flights.length} />
            <Stat k="Hours" v={hm(totals.min)} />
            <Stat k="Distance" v={`${totals.nm.toLocaleString()}`} sub="NM" />
            <Stat k="Landing" v={totals.avg != null ? `${totals.avg}` : "—"} sub={totals.best != null ? `avg fpm · best ${totals.best}` : "avg fpm"} />
          </div>

          {!flights.some((f) => f.touchdown) && <LinkCard />}

          <Section title="Hours flown per week">
            <Columns data={weeks} label="Hours flown per week, last 8 weeks" fmt={(v) => `${v} h`} />
          </Section>

          <Section title="Flights" aside={<span className="dim small">tap to show on the map</span>}>
            {data && !flights.length && <p className="dim small">No flights yet. Take off and land while connected to IVAO, and the flight appears here a minute after touchdown.</p>}
            <ol className="log-list">
              {flights.map((f) => (
                <FlightRow key={f.landed} f={f} on={logView?.landed === f.landed} onClick={() => show(f)} />
              ))}
            </ol>
          </Section>
          <p className="fineprint">Flights are logged by the Pulse recorder from IVAO’s public data, for every pilot, whether or not this page is open. Landing rates marked “sim” are exact, from Pulse Link; the others come from IVAO position reports and are estimates. <button className="link-btn" onClick={() => setPrefs({ myVid: '' })}>Change VID</button></p>
        </>
      )}
    </Panel>
  );
}
