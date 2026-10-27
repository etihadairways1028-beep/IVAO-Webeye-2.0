import { useEffect, useRef, useState } from 'react';
import { useStore, type Selection } from '../state/store';
import { selectAirport, selectController, selectFlight } from './actions';

/**
 * Shareable links. The URL hash mirrors the selection:
 *   #f=BAW123   a flight (by callsign)
 *   #c=EGLL_TWR an ATC station (by callsign)
 *   #a=EGLL     an airport
 * Callsigns are used rather than session ids so a link survives reconnects.
 */
type Target = { kind: 'f' | 'c' | 'a'; id: string };

/** #u=123456 opens a pilot profile. */
function openProfileFromHash(): boolean {
  const m = /^#u=(\d{3,8})$/.exec(window.location.hash);
  if (!m) return false;
  useStore.setState({ profileVid: Number(m[1]) });
  useStore.getState().setPanel('profile');
  return true;
}

function parseHash(): Target | null {
  const m = /^#([fca])=([A-Za-z0-9_-]{2,16})$/.exec(window.location.hash);
  return m ? { kind: m[1] as Target['kind'], id: m[2].toUpperCase() } : null;
}

function hashFor(sel: Selection): string {
  const s = useStore.getState();
  if (sel?.kind === 'flight') {
    const f = s.flightMap.get(sel.key);
    return f ? `#f=${encodeURIComponent(f.callsign)}` : '';
  }
  if (sel?.kind === 'atc') {
    const c = s.controllers.find((x) => x.key === sel.key);
    return c ? `#c=${encodeURIComponent(c.callsign)}` : '';
  }
  if (sel?.kind === 'airport') return `#a=${encodeURIComponent(sel.icao)}`;
  return '';
}

/** Link to the current selection, or to the map itself when nothing is selected. */
export function linkFor(sel: Selection): string {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}${hashFor(sel)}`;
}

export async function shareSelection(title: string, sel: Selection) {
  const url = linkFor(sel);
  const notify = useStore.getState().notify;
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void>; canShare?: (d: ShareData) => boolean };
  if (nav.share && window.matchMedia('(pointer: coarse)').matches) {
    try {
      await nav.share({ title, url });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    notify('Link copied');
  } catch {
    notify(url);
  }
}

/** Keeps the hash in sync with the selection and opens a shared link once data arrives. */
export function useShareLinks() {
  const pending = useRef<Target | null>(parseHash());
  const selection = useStore((s) => s.selection);
  const flights = useStore((s) => s.flights);
  const controllers = useStore((s) => s.controllers);
  const airportsReady = useStore((s) => s.airportsReady);
  const status = useStore((s) => s.status);
  const [hashTick, setHashTick] = useState(0);

  // Resolve an incoming link once the relevant data is loaded.
  useEffect(() => {
    const t = pending.current;
    if (!t || !airportsReady) return;
    if (t.kind === 'a') {
      pending.current = null;
      selectAirport(t.id);
      return;
    }
    const loaded = flights.length > 0 || controllers.length > 0 || status === 'error';
    if (!loaded) return;
    pending.current = null;
    if (t.kind === 'f') {
      const f = flights.find((x) => x.callsign === t.id);
      if (f) selectFlight(f, { frame: 'route' });
      else useStore.getState().notify(`${t.id} is not online right now`);
    } else {
      const c = controllers.find((x) => x.callsign.toUpperCase() === t.id);
      if (c) selectController(c);
      else useStore.getState().notify(`${t.id} is not online right now`);
    }
  }, [flights, controllers, airportsReady, status, hashTick]);

  useEffect(() => {
    openProfileFromHash();
  }, []);

  // Mirror the selection into the address bar without adding history entries.
  useEffect(() => {
    if (pending.current) return; // don't wipe a link before it has been opened
    if (window.location.hash.startsWith('#u=') && !selection) return; // keep a profile link
    const h = hashFor(selection);
    if (h === window.location.hash || (!h && !window.location.hash)) return;
    const { pathname, search } = window.location;
    history.replaceState(history.state, '', `${pathname}${search}${h}`);
  }, [selection, flights.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pasting a new link into the address bar of an open tab.
  useEffect(() => {
    const onHash = () => {
      if (openProfileFromHash()) return;
      const t = parseHash();
      if (!t || hashFor(useStore.getState().selection) === window.location.hash) return;
      pending.current = t;
      setHashTick((n) => n + 1);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
}
