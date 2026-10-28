import { ALERT_SOUND_KEY, type Conflict } from '../lib/conflicts';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from '../state/store';
import { getAirport } from '../data/airports';
import { chartState, loadChart, onChartsChange } from '../data/charts';
import { firBounds, firForCallsign } from '../data/firs';
import { atcMe, atcSend, atcStart, atcVerify, freeSquawk, saveAtcSession, taxiText, type SentClearance, type TaxiInstr } from '../data/atc';
import { parseClearance, planTaxi, runwayLabels, taxiwayNames } from '../lib/taxi';
import { selectFlight, copyText } from '../lib/actions';
import { distanceNm } from '../lib/geo';
import { ago, fmtFreq } from '../lib/format';
import { Badge, Panel, Section } from './ui';
import { IconAlert, IconCopy, IconHeadset, IconPlane, IconX } from './Icons';
import type { Flight } from '../types';

const AIRPORT_POS = new Set(['DEL', 'GND', 'TWR', 'APP', 'DEP', 'RMP']);
const TAXI_POS = new Set(['DEL', 'GND', 'TWR', 'RMP']);
const POS_NAME: Record<string, string> = { DEL: 'Delivery', GND: 'Ground', TWR: 'Tower', APP: 'Approach', DEP: 'Departure', CTR: 'Centre', FSS: 'Flight service', RMP: 'Ramp' };

/**
 * ATC desk: a controller verifies which station they are (one-time code in their ATIS),
 * then sends squawks and taxi routes to pilots at their airport.
 */
export function AtcDesk() {
  const session = useStore((s) => s.atcSession);
  const setPanel = useStore((s) => s.setPanel);
  return (
    <Panel side="left" className="wide" label="ATC desk" icon={<IconHeadset size={18} />} title="ATC desk" sub={session ? `Controlling ${session.callsign}` : 'For IVAO controllers'} onClose={() => setPanel(null)}>
      {session ? <Controlling /> : <Verify />}
    </Panel>
  );
}

// ───────── 1–2: choose your station, prove it's you

function Verify() {
  const controllers = useStore((s) => s.controllers);
  const [vid, setVid] = useState(() => { try { return localStorage.getItem('webeye2.atcVid') ?? ''; } catch { return ''; } });
  const [station, setStation] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const n = Number(vid);
  const mine = useMemo(() => (Number.isFinite(n) && n > 0 ? controllers.filter((c) => c.vid === n) : []), [controllers, n]);
  useEffect(() => {
    if (mine.length === 1) setStation(mine[0].callsign);
  }, [mine]);

  const start = async () => {
    setErr(null);
    setBusy(true);
    try {
      try {
        localStorage.setItem('webeye2.atcVid', vid.trim());
      } catch {
        /* ignore */
      }
      const r = await atcStart(station, n);
      setCode(r.code);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = useCallback(async () => {
    setBusy(true);
    try {
      const s = await atcVerify(station);
      saveAtcSession(s);
      useStore.setState({ atcSession: s });
      useStore.getState().notify(`Verified as ${s.callsign}. You can remove the code from your ATIS now.`);
    } catch (e) {
      const er = e as Error & { waiting?: boolean };
      setWaiting(!!er.waiting);
      setErr(er.message);
      if (!er.waiting) setCode(null);
    } finally {
      setBusy(false);
    }
  }, [station]);

  // While the code is out, check again every 15 s (IVAO's feed refreshes about that often).
  useEffect(() => {
    if (!code) return;
    const id = window.setInterval(verify, 15000);
    return () => window.clearInterval(id);
  }, [code, verify]);

  return (
    <>
      <Section title="1. Which station are you?">
        <p className="dim small">Connect to IVAO in your ATC app first, then type your VID.</p>
        <input className="input mono" inputMode="numeric" placeholder="Your IVAO VID" value={vid} onChange={(e) => setVid(e.target.value.replace(/\D/g, ''))} aria-label="Your IVAO VID" disabled={!!code} />
        {vid.length >= 4 && !mine.length && <p className="dim small">No ATC station is online under VID {vid} yet. It appears here about 15 seconds after you connect.</p>}
        {mine.length > 0 && (
          <div className="desk-stations">
            {mine.map((c) => (
              <button key={c.key} className={`desk-station ${station === c.callsign ? 'on' : ''}`} onClick={() => setStation(c.callsign)} disabled={!!code}>
                <span className="mono strong">{c.callsign}</span>
                <span className="dim small">
                  {POS_NAME[c.position] ?? c.position} · {fmtFreq(c.frequency)}
                </span>
              </button>
            ))}
          </div>
        )}
        {!code && (
          <button className="btn" disabled={!station || busy} onClick={start}>
            {busy ? 'Checking…' : station ? `Continue as ${station}` : 'Pick your station'}
          </button>
        )}
      </Section>

      {code && (
        <Section title="2. Prove it's you">
          <p className="small">Add this code anywhere in your ATIS / controller info in the IVAO ATC app, and update it:</p>
          <div className="desk-code">
            <span className="mono">{code}</span>
            <button className="icon-btn small" aria-label="Copy code" onClick={() => copyText(code)}>
              <IconCopy size={15} />
            </button>
          </div>
          <p className="dim small">Pulse reads IVAO's public feed and checks the code is on {station}. No password needed, and nobody else can claim your station. It checks again every 15 seconds.</p>
          <div className="row-gap">
            <button className="btn" disabled={busy} onClick={verify}>
              {busy ? 'Checking…' : 'Check now'}
            </button>
            <button className="link-btn" onClick={() => { setCode(null); setErr(null); }}>
              Cancel
            </button>
          </div>
        </Section>
      )}
      {err && <p className={waiting ? 'dim small desk-msg' : 'warn small desk-msg'}>{err}</p>}
    </>
  );
}

// ───────── 3: control your area

function Controlling() {
  const session = useStore((s) => s.atcSession)!;
  const flights = useStore((s) => s.flights);
  const [sent, setSent] = useState<SentClearance[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const icao = session.callsign.split('_')[0];
  const ap = getAirport(icao);
  const airportPos = AIRPORT_POS.has(session.position);

  const signOut = useCallback((msg?: string) => {
    saveAtcSession(null);
    useStore.setState({ atcSession: null, taxi: null });
    if (msg) useStore.getState().notify(msg);
  }, []);

  // Refresh what you've sent (and see wilcos); drop the session when your ATC connection ends.
  useEffect(() => {
    let alive = true;
    const load = () =>
      atcMe(session.token)
        .then((r) => alive && setSent(r.sent))
        .catch((e: Error & { status?: number }) => alive && e.status === 401 && signOut('Your ATC connection ended, so you were signed out of the ATC desk.'));
    load();
    const id = window.setInterval(load, 15000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [session.token, signOut]);

  // Pilots in your area: departing/arriving at your airport, or inside your FIR for a centre.
  const area = useMemo(() => {
    let list: Flight[];
    if (airportPos) list = flights.filter((f) => f.dep === icao || f.arr === icao);
    else {
      const fir = firForCallsign(session.callsign);
      const box = fir && firBounds(fir.b);
      list = box ? flights.filter((f) => f.lon >= box[0][0] && f.lon <= box[1][0] && f.lat >= box[0][1] && f.lat <= box[1][1]) : [];
    }
    const d = (f: Flight) => (ap ? distanceNm(f.lat, f.lon, ap.lat, ap.lon) : 0);
    return list.sort((a, b) => Number(b.onGround) - Number(a.onGround) || d(a) - d(b)).slice(0, 80);
  }, [flights, icao, airportPos, session.callsign, ap]);

  const picked = pick ? flights.find((f) => f.callsign === pick) ?? null : null;
  const lastFor = (cs: string) => sent.find((s) => s.pilot === cs);

  return (
    <>
      <div className="desk-head">
        <div>
          <div className="mono strong desk-cs">{session.callsign}</div>
          <div className="dim small">
            {POS_NAME[session.position] ?? session.position}
            {session.frequency ? ` · ${fmtFreq(session.frequency)}` : ''} · verified
          </div>
        </div>
        <button className="link-btn" onClick={() => signOut('Signed out of the ATC desk.')}>
          Sign out
        </button>
      </div>

      <TrafficAlerts />

      {picked ? (
        <SendForm key={picked.key} flight={picked} icao={icao} canTaxi={TAXI_POS.has(session.position)} last={lastFor(picked.callsign)} onClose={() => { setPick(null); useStore.setState({ taxi: null }); }} />
      ) : (
        <Section title={airportPos ? `Pilots at or bound for ${icao}` : 'Pilots in your airspace'} aside={<span className="mono dim">{area.length}</span>}>
          {!area.length && <p className="dim small">No pilots in your area right now.</p>}
          <div className="desk-pilots">
            {area.map((f) => {
              const l = lastFor(f.callsign);
              return (
                <button key={f.key} className="desk-pilot" onClick={() => { setPick(f.callsign); selectFlight(f); }}>
                  <IconPlane size={15} style={{ transform: `rotate(${f.heading ?? 0}deg)` }} />
                  <span className="mono strong">{f.callsign}</span>
                  <span className="dim small">
                    {f.dep ?? '····'} → {f.arr ?? '····'} · {f.onGround ? 'on ground' : f.altitude ? `${Math.round(f.altitude / 100) * 100} ft` : ''}
                  </span>
                  {l && (l.ack ? <Badge tone="teal">Wilco</Badge> : <Badge>Sent</Badge>)}
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {sent.length > 0 && !picked && (
        <Section title="Sent">
          <ul className="desk-sent">
            {sent.slice(0, 12).map((s) => (
              <li key={`${s.pilot}${s.at}`}>
                <span className="mono strong">{s.pilot}</span>
                <span className="small">{[s.squawk && `squawk ${s.squawk}`, s.taxi && taxiText(s.taxi)].filter(Boolean).join(' · ') || s.note}</span>
                <span className="dim small">{s.ack ? `wilco ${ago(s.ack)}` : `sent ${ago(s.at)}`}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function SendForm({ flight, icao, canTaxi, last, onClose }: { flight: Flight; icao: string; canTaxi: boolean; last?: SentClearance; onClose: () => void }) {
  const flights = useStore((s) => s.flights);
  const session = useStore((s) => s.atcSession)!;
  const [squawk, setSquawk] = useState(last?.squawk ?? '');
  const [dest, setDest] = useState<{ kind: 'runway' | 'stand'; id: string } | null>(last?.taxi ? { kind: last.taxi.kind, id: last.taxi.dest } : null);
  const [via, setVia] = useState<string[]>(last?.taxi?.via ?? []);
  const [hold, setHold] = useState(last?.taxi?.hold ?? '');
  const [stand, setStand] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const chart = useSyncExternalStore(onChartsChange, () => chartState(icao));
  useEffect(() => {
    if (canTaxi) loadChart(icao);
  }, [icao, canTaxi]);
  const fc = chart?.status === 'ready' ? chart.fc : null;
  const names = useMemo(() => (fc ? taxiwayNames(fc) : []), [fc]);
  const rwys = useMemo(() => (fc ? [...new Set(runwayLabels(fc))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })) : []), [fc]);
  const inUse = useMemo(() => new Set(flights.map((f) => f.transponder).filter(Boolean) as string[]), [flights]);

  const taxi: TaxiInstr | undefined = dest ? { kind: dest.kind, dest: dest.id, via, ...(hold ? { hold } : {}), airport: icao } : undefined;

  // Preview the route on the map from the pilot's live position.
  const previewErr = useRef<string | null>(null);
  useEffect(() => {
    previewErr.current = null;
    if (!fc || !taxi) {
      useStore.setState({ taxi: null });
      return;
    }
    const r = planTaxi(fc, flight.onGround ? [flight.lon, flight.lat] : null, parseClearance(taxiText(taxi)));
    if (r.ok) {
      useStore.setState({ taxi: { icao, text: taxiText(taxi), route: r.route } });
      const lons = r.route.path.map((p) => p[0]), lats = r.route.path.map((p) => p[1]);
      useStore.getState().camera_({ type: 'fit', bounds: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], maxZoom: 16 });
    }
    else {
      previewErr.current = r.error;
      useStore.setState({ taxi: null });
    }
  }, [fc, dest?.id, dest?.kind, via.join(' '), hold, flight.lon, flight.lat]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await atcSend(session.token, flight.callsign, { squawk: squawk || undefined, taxi, note: note.trim() || undefined });
      setMsg({ ok: true, text: `Sent to ${flight.callsign}. You'll see "Wilco" when the pilot confirms.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title={`Clearance for ${flight.callsign}`}
      aside={
        <button className="icon-btn small" aria-label="Back to pilot list" onClick={onClose}>
          <IconX size={15} />
        </button>
      }
    >
      <div className="dim small">
        {flight.aircraft ?? ''} · {flight.dep ?? '····'} → {flight.arr ?? '····'} · transponder {flight.transponder ?? '—'}
      </div>

      <div className="pop-label">Squawk</div>
      <div className="row-gap">
        <input className="input mono" inputMode="numeric" maxLength={4} placeholder="e.g. 4521" value={squawk} onChange={(e) => setSquawk(e.target.value.replace(/[^0-7]/g, ''))} aria-label="Squawk" />
        <button className="btn ghost" onClick={() => setSquawk(freeSquawk(inUse))}>
          Assign free code
        </button>
      </div>

      {canTaxi && (
        <>
          <div className="pop-label">Taxi</div>
          {chart?.status === 'loading' && <p className="dim small">Loading the {icao} ground chart…</p>}
          {chart?.status === 'error' && (
            <p className="warn small">
              {chart.error}{' '}
              <button className="link-btn" onClick={() => loadChart(icao)}>
                Retry
              </button>
            </p>
          )}
          {fc && (
            <>
              <div className="dim small">Runway</div>
              <div className="chips">
                {rwys.map((r) => (
                  <button key={r} type="button" className={`chip rwy ${dest?.kind === 'runway' && dest.id === r ? 'on' : ''}`} onClick={() => setDest({ kind: 'runway', id: r })}>
                    {r}
                  </button>
                ))}
              </div>
              <div className="dim small">Or a stand (arrivals)</div>
              <div className="row-gap">
                <input className="input mono" placeholder="e.g. C3" value={stand} maxLength={6} onChange={(e) => setStand(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} aria-label="Stand" />
                <button className="btn ghost" disabled={!stand} onClick={() => setDest({ kind: 'stand', id: stand })}>
                  Set stand
                </button>
              </div>
              <div className="dim small">Via (tap in order)</div>
              <div className="chips">
                {names.slice(0, 80).map((n) => (
                  <button key={n} type="button" className="chip twy" onClick={() => setVia((v) => [...v, n].slice(0, 10))}>
                    {n}
                  </button>
                ))}
              </div>
              <div className="desk-route">
                <span className="mono">{taxi ? taxiText(taxi) : 'Pick a runway or stand'}</span>
                {via.length > 0 && (
                  <button className="link-btn" onClick={() => setVia((v) => v.slice(0, -1))}>
                    Undo
                  </button>
                )}
                {(via.length > 0 || dest) && (
                  <button className="link-btn" onClick={() => { setVia([]); setDest(null); setHold(''); }}>
                    Clear
                  </button>
                )}
              </div>
              {dest?.kind === 'runway' && (
                <input className="input mono" placeholder="Holding point (optional), e.g. A1" value={hold} maxLength={5} onChange={(e) => setHold(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} aria-label="Holding point" />
              )}
              {taxi && previewErr.current && <p className="dim small">Preview: {previewErr.current} You can still send it.</p>}
              {taxi && !previewErr.current && <p className="dim small">The route is previewed in green on the map.</p>}
            </>
          )}
        </>
      )}

      <div className="pop-label">Note (optional)</div>
      <input className="input" maxLength={90} placeholder="e.g. Contact tower 118.750 when ready" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />

      <button className="btn desk-send" disabled={busy || (!squawk && !taxi && !note.trim())} onClick={send}>
        {busy ? 'Sending…' : `Send to ${flight.callsign}`}
      </button>
      {msg && <p className={msg.ok ? 'ok-text small' : 'warn small'}>{msg.text}</p>}
      {last && <p className="dim small">Last sent {ago(last.at)}{last.ack ? ` · wilco ${ago(last.ack)}` : ' · waiting for wilco'}.</p>}
      <p className="fineprint">This is a visual aid: always give the clearance on frequency as well. The pilot sees it in Pulse under My flight.</p>
    </Section>
  );
}

/** Current and predicted losses of separation in your area. */
function TrafficAlerts() {
  const conflicts = useStore((s) => s.conflicts);
  const [sound, setSound] = useState(() => {
    try {
      return localStorage.getItem(ALERT_SOUND_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () => {
    const v = !sound;
    setSound(v);
    try {
      localStorage.setItem(ALERT_SOUND_KEY, v ? '1' : '0');
    } catch {
      /* storage blocked */
    }
  };
  const show = (c: Conflict) => {
    const st = useStore.getState();
    st.camera_({ type: 'fit', bounds: [[Math.min(c.pa[0], c.pb[0]), Math.min(c.pa[1], c.pb[1])], [Math.max(c.pa[0], c.pb[0]), Math.max(c.pa[1], c.pb[1])]], maxZoom: 10 });
  };
  return (
    <Section
      title="Traffic alerts"
      icon={<IconAlert size={15} />}
      aside={
        <button className={`chip-btn small ${sound ? 'on' : ''}`} aria-pressed={sound} onClick={toggle} title="Play a chime for new alerts">
          {sound ? 'Sound on' : 'Sound off'}
        </button>
      }
    >
      {!conflicts.length ? (
        <p className="ok-text small">No conflicts in your area. Pulse checks every update for aircraft closer than 3 NM (near your field) or 5 NM and 1,000 ft, now or within 2 minutes.</p>
      ) : (
        <ul className="alerts">
          {conflicts.map((c) => (
            <li key={c.id}>
              <button className={`alert-row ${c.level}`} onClick={() => show(c)}>
                <span className="alert-tag">{c.level === 'now' ? 'NOW' : `${Math.round(c.inSec)} s`}</span>
                <span className="mono strong">
                  {c.a} · {c.b}
                </span>
                <span className="dim small mono">
                  {c.level === 'now' ? `${c.nowNm} NM · ${c.nowFt} ft apart` : `closest ${c.hNm} NM · ${c.vFt} ft`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="fineprint">Advisory only: IVAO positions are up to 15 seconds old. Use your radar client for separation.</p>
    </Section>
  );
}
