import { useEffect, useState } from 'react';
import { fetchLeaderboard, type Leaderboard as LBD, type LeaderRow } from '../data/logbook';
import { useStore } from '../state/store';
import { Section } from './ui';
import { hm, LinkCard, openProfile } from './Logbook';

const day = (t: string | number | Date) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

function Board({ rows, value, empty }: { rows: LeaderRow[]; value: (r: LeaderRow) => string; empty: string }) {
  const myVid = Number(useStore((s) => s.prefs.myVid));
  if (!rows.length) return <p className="dim small">{empty}</p>;
  return (
    <ol className="board">
      {rows.map((r, i) => (
        <li key={r.vid}>
          <button className={`board-row ${r.vid === myVid ? 'me' : ''}`} onClick={() => openProfile(r.vid)} title={`Open VID ${r.vid}'s profile`}>
            <span className={`board-rank mono ${i < 3 ? `top top${i + 1}` : ''}`}>{i + 1}</span>
            <span className="board-who">
              <span className="mono strong">{r.callsign}</span>
              <span className="dim small mono"> {r.vid}{r.vid === myVid ? ' · you' : ''}</span>
            </span>
            <span className="board-val mono">{value(r)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** This week's top pilots and controllers on IVAO, from the Pulse recorder. */
export function Leaderboard() {
  const [which, setWhich] = useState<'this' | 'last'>('this');
  const [data, setData] = useState<LBD | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    setData(null);
    fetchLeaderboard(which, ac.signal)
      .then((d) => (setData(d), setErr(null)))
      .catch((e) => !ac.signal.aborted && setErr((e as Error).message));
    return () => ac.abort();
  }, [which]);
  const to = data ? new Date(new Date(data.from).getTime() + 6 * 864e5) : null;
  return (
    <>
      <div className="seg board-seg" role="tablist" aria-label="Week">
        <button role="tab" aria-selected={which === 'this'} className={which === 'this' ? 'on' : ''} onClick={() => setWhich('this')}>
          This week
        </button>
        <button role="tab" aria-selected={which === 'last'} className={which === 'last' ? 'on' : ''} onClick={() => setWhich('last')}>
          Last week
        </button>
      </div>
      {data && to && <p className="dim small seg-note">Week of {day(data.from)} – {day(to)} (UTC)</p>}
      {err && <p className="warn small">Leaderboard unavailable: {err}</p>}
      {!data && !err && <div className="skeleton" />}
      {data && (
        <>
          <Section title="Most hours flown">
            <Board rows={data.hours} value={(r) => `${hm(r.minutes ?? 0)} h`} empty="No flights logged yet this week." />
          </Section>
          <Section title="Smoothest landings" aside={<span className="dim small">Pulse Link</span>}>
            <Board rows={data.landings} value={(r) => `${r.fpm} fpm`} empty="No exact touchdowns yet: they come from the Pulse Link sim add-on." />
          </Section>
          <Section title="Most flights">
            <Board rows={data.flights} value={(r) => `${r.flights}`} empty="No flights logged yet this week." />
          </Section>
          <Section title="Most time on ATC">
            <Board rows={data.atc} value={(r) => `${hm(r.minutes ?? 0)} h`} empty="No ATC time recorded yet this week." />
          </Section>
          {!data.landings.length && <LinkCard />}
          <p className="fineprint">Weeks run Monday to Sunday, UTC. Flights count when the recorder sees a takeoff and landing on IVAO; ATC time is counted every 5 minutes. Tap anyone to see their profile.</p>
        </>
      )}
    </>
  );
}
