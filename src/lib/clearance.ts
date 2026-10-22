import { useEffect } from 'react';
import { useStore } from '../state/store';
import { fetchClearance } from '../data/atc';
import { RECORDER_URL } from '../data/endpoints';

/**
 * While you're tracking your own VID, check every 20 s whether a verified controller has sent
 * your callsign a clearance. Only your own flight is checked.
 */
export function usePilotClearance() {
  const vid = useStore((s) => s.prefs.myVid);
  const mine = useStore((s) => {
    const n = Number(s.prefs.myVid);
    return s.prefs.myVid && Number.isFinite(n) ? s.flights.find((f) => f.vid === n && !f.demo) ?? null : null;
  });
  const cs = mine?.callsign ?? null;
  const session = mine?.sessionId ?? 0;
  useEffect(() => {
    if (!RECORDER_URL || !cs || !session) {
      useStore.setState({ incoming: null });
      return;
    }
    let alive = true;
    const check = () =>
      fetchClearance(cs, session)
        .then((c) => {
          if (!alive) return;
          const prev = useStore.getState().incoming;
          if (!c) {
            if (prev) useStore.setState({ incoming: null });
            return;
          }
          if (prev && prev.at === c.at && prev.ack === c.ack) return;
          useStore.setState({ incoming: c });
          let seen = 0;
          try {
            seen = Number(localStorage.getItem('webeye2.clrSeen')) || 0;
            localStorage.setItem('webeye2.clrSeen', String(c.at));
          } catch {
            /* ignore */
          }
          if (c.at !== seen && !c.ack) useStore.getState().notify(`${c.from} sent you a clearance. Open My flight to see it.`);
        })
        .catch(() => undefined);
    check();
    const id = window.setInterval(check, 20000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [cs, session, vid]);
}
