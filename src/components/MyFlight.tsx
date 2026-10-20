import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { fetchSimbrief } from '../data/simbrief';
import { selectFlight } from '../lib/actions';
import { dash, fmtAlt, fmtDuration, fmtKt, fmtNm, fmtZulu, ago } from '../lib/format';
import { Badge, KV, Panel, Section } from './ui';
import { Navlog } from './Navlog';
import { flightProgress } from '../lib/progress';
import { IconFollow, IconImport, IconPlane, IconRoute, IconUser, IconX } from './Icons';

/**
 * "My flight": track yourself by IVAO VID and overlay your SimBrief OFP.
 * VID matching uses the public Whazzup `userId` field; nothing is sent anywhere else.
 */
export function MyFlight() {
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const flights = useStore((s) => s.flights);
  const status = useStore((s) => s.status);
  const plan = useStore((s) => s.plan);
  const setPlan = useStore((s) => s.setPlan);
  const setPanel = useStore((s) => s.setPanel);
  const [vid, setVid] = useState(prefs.myVid);
  const [sbUser, setSbUser] = useState(prefs.simbriefUser);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const mine = useMemo(() => {
    const n = Number(prefs.myVid);
    return prefs.myVid && Number.isFinite(n) ? flights.find((f) => f.vid === n) ?? null : null;
  }, [flights, prefs.myVid]);
  const planFlight = useMemo(() => (plan ? flights.find((f) => f.callsign === plan.callsign.toUpperCase()) ?? null : null), [plan, flights]);
  const progress = useMemo(() => (planFlight && plan ? flightProgress(planFlight, plan) : null), [planFlight, plan]);

  const saveVid = (e: React.FormEvent) => {
    e.preventDefault();
    const v = vid.trim();
    if (v && !/^\d{4,7}$/.test(v)) {
      useStore.getState().notify('An IVAO VID is a 4–7 digit number');
      return;
    }
    setPrefs({ myVid: v });
    const n = Number(v);
    const f = v ? useStore.getState().flights.find((x) => x.vid === n) : null;
    if (f) selectFlight(f, { follow: true });
  };

  const importPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const p = await fetchSimbrief(sbUser);
      setPlan(p);
      setPrefs({ simbriefUser: sbUser.trim() });
      const lons = [p.origin.lon, p.destination.lon, ...p.fixes.map((f) => f.lon)];
      const lats = [p.origin.lat, p.destination.lat, ...p.fixes.map((f) => f.lat)];
      useStore.getState().camera_({ type: 'fit', bounds: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], maxZoom: 7 });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel side="left" className={plan ? "wide" : ""} label="My flight" icon={<IconUser size={18} />} title="My flight" sub="Track your VID · import SimBrief" onClose={() => setPanel(null)}>
      <Section title="Track by IVAO VID" icon={<IconFollow size={15} />}>
        <form className="inline-form" onSubmit={saveVid}>
          <input className="input mono" inputMode="numeric" placeholder="e.g. 123456" value={vid} onChange={(e) => setVid(e.target.value)} aria-label="Your IVAO VID" />
          <button className="btn" type="submit">
            {prefs.myVid && prefs.myVid === vid.trim() ? 'Locate' : 'Track'}
          </button>
        </form>
        {prefs.myVid && (
          <div className="track-card">
            {mine ? (
              <button className="track-hit" onClick={() => selectFlight(mine, { follow: true, frame: 'aircraft' })}>
                <IconPlane size={18} style={{ transform: `rotate(${mine.heading ?? 0}deg)` }} />
                <span>
                  <span className="mono strong">{mine.callsign}</span>
                  <span className="dim">
                    {' '}
                    · {mine.dep ?? '····'} → {mine.arr ?? '····'}
                  </span>
                  <span className="track-tele mono">
                    {mine.onGround ? 'On ground' : fmtAlt(mine.altitude, prefs.transitionAlt)} · {fmtKt(mine.groundSpeed)}
                  </span>
                </span>
                <Badge tone="teal">Follow</Badge>
              </button>
            ) : (
              <p className="dim small">
                {status === 'demo'
                  ? 'Demo mode: switch to live IVAO data in Settings to find your VID.'
                  : status === 'live' || status === 'stale'
                    ? `VID ${prefs.myVid} is not connected as a pilot right now. We’ll pick you up automatically when you connect.`
                    : 'Waiting for the IVAO feed…'}
              </p>
            )}
            <button className="link-btn" onClick={() => { setPrefs({ myVid: '' }); setVid(''); }}>
              Stop tracking
            </button>
          </div>
        )}
        <p className="fineprint">Your aircraft is highlighted in teal and labelled on every map style. Your VID is stored only in this browser.</p>
      </Section>

      <Section title="SimBrief flight plan" icon={<IconImport size={15} />}>
        <form className="inline-form" onSubmit={importPlan}>
          <input className="input" placeholder="SimBrief username or pilot ID" value={sbUser} onChange={(e) => setSbUser(e.target.value)} aria-label="SimBrief username or pilot ID" autoComplete="username" />
          <button className="btn" type="submit" disabled={loading || !sbUser.trim()}>
            {loading ? 'Importing…' : 'Import'}
          </button>
        </form>
        {err && <p className="warn small">Import failed: {err}</p>}
        {plan && (
          <div className="ofp">
            <div className="ofp-head">
              <div>
                <div className="mono strong ofp-cs">{plan.callsign}</div>
                <div className="dim small">
                  {plan.aircraft}
                  {plan.aircraftName ? ` · ${plan.aircraftName}` : ''}
                  {plan.registration ? ` · ${plan.registration}` : ''}
                </div>
              </div>
              <button className="icon-btn small" aria-label="Remove flight plan" onClick={() => setPlan(null)}>
                <IconX size={15} />
              </button>
            </div>
            <div className="ofp-route">
              <div>
                <div className="mono rs-code">{plan.origin.icao}</div>
                <div className="dim small">{plan.origin.rwy ? `RWY ${plan.origin.rwy}` : plan.origin.name}</div>
              </div>
              <IconRoute size={18} className="dim" />
              <div className="right">
                <div className="mono rs-code">{plan.destination.icao}</div>
                <div className="dim small">{plan.destination.rwy ? `RWY ${plan.destination.rwy}` : plan.destination.name}</div>
              </div>
            </div>
            {progress && progress.source === 'plan' && planFlight && (
              <div className="ofp-progress">
                <div className="rs-track">
                  <div className="rs-fill" style={{ width: `${(progress.pct ?? 0) * 100}%` }} />
                </div>
                <div className="ofp-progress-row mono">
                  <span>
                    {Math.round(progress.flownNm ?? 0)}/{Math.round(progress.totalNm ?? 0)} NM
                  </span>
                  <span>{progress.eta ? `ETA ${fmtZulu(progress.eta)} in ${fmtDuration(progress.ete)}` : planFlight.onGround ? 'On ground' : '—'} / {Math.round(progress.remainingNm ?? 0)} NM</span>
                </div>
                {progress.offRouteNm != null && progress.offRouteNm > 10 && <p className="warn small">Aircraft is {Math.round(progress.offRouteNm)} NM off the planned route.</p>}
              </div>
            )}
            <div className="grid-kv">
              <KV k="Initial alt" v={plan.cruise ? fmtAlt(Number(plan.cruise), prefs.transitionAlt) : dash} />
              <KV k="Route dist" v={fmtNm(plan.distanceNm ?? plan.totalNm)} />
              <KV k="Air time" v={fmtDuration(plan.airTime)} />
              <KV k="Block time" v={fmtDuration(plan.blockTime)} />
              <KV k="Off blocks" v={plan.schedOut ? fmtZulu(plan.schedOut * 1000) : dash} />
              <KV k="Takeoff" v={plan.estOff ? fmtZulu(plan.estOff * 1000) : dash} />
              <KV k="Landing" v={plan.estOn ? fmtZulu(plan.estOn * 1000) : dash} />
              <KV k="On blocks" v={plan.schedIn ? fmtZulu(plan.schedIn * 1000) : dash} />
              <KV k="Block fuel" v={plan.fuel.block != null ? `${plan.fuel.block.toLocaleString('en-US')} ${plan.units ?? ''}` : dash} />
              <KV k="Trip fuel" v={plan.fuel.trip != null ? `${plan.fuel.trip.toLocaleString('en-US')} ${plan.units ?? ''}` : dash} />
              <KV k="ZFW" v={plan.weights.zfw != null ? plan.weights.zfw.toLocaleString('en-US') : dash} />
              <KV k="TOW" v={plan.weights.tow != null ? plan.weights.tow.toLocaleString('en-US') : dash} />
              <KV k="Pax" v={plan.weights.pax ?? dash} />
              <KV k="Cost index" v={plan.costIndex ?? dash} />
              <KV k="Avg wind" v={plan.avgWind ?? dash} />
              <KV k="Alternate" v={plan.alternate ?? dash} />
            </div>
            <div className="route-text mono">{plan.route || dash}</div>
            {plan.stepClimbs && <div className="dim small mono step">Steps: {plan.stepClimbs}</div>}
            <div className="ofp-actions">
              {planFlight ? (
                <button className="btn" onClick={() => selectFlight(planFlight, { frame: 'route' })}>
                  <IconPlane size={15} /> {planFlight.callsign} is online — show
                </button>
              ) : (
                <span className="dim small">Not online yet as {plan.callsign}. Connect with this callsign and the live aircraft is matched automatically.</span>
              )}
              {plan.pdfUrl && (
                <a className="btn ghost" href={plan.pdfUrl} target="_blank" rel="noopener noreferrer">
                  OFP PDF
                </a>
              )}
            </div>
            <div className="navlog-head">
              <h4>Navlog · {plan.fixes.length} waypoints</h4>
              {plan.generatedAt && <span className="dim small mono">generated {ago(plan.generatedAt * 1000)}</span>}
            </div>
            <Navlog plan={plan} live={planFlight} progress={progress} />
            {(plan.origin.metar || plan.destination.metar) && (
              <details className="remarks">
                <summary>METAR at planning time</summary>
                {plan.origin.metar && <div className="mono">{plan.origin.metar}</div>}
                {plan.destination.metar && <div className="mono">{plan.destination.metar}</div>}
              </details>
            )}
          </div>
        )}
        <p className="fineprint">Fetched from SimBrief’s public OFP endpoint. The planned route (purple) is drawn from your navlog fixes; it is your plan, not an IVAO record.</p>
      </Section>
    </Panel>
  );
}
