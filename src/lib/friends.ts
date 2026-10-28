// Friends: pilots and controllers you follow by VID. Toasts (and optional browser
// notifications) when they connect, take off or land.
import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';

export function isFriend(vid: number | null | undefined) {
  return vid != null && useStore.getState().prefs.friends.some((f) => f.vid === vid);
}

export function toggleFriend(vid: number, name: string) {
  const st = useStore.getState();
  const list = st.prefs.friends;
  if (list.some((f) => f.vid === vid)) {
    st.setPrefs({ friends: list.filter((f) => f.vid !== vid) });
    st.notify(`${name} removed from friends`);
  } else {
    st.setPrefs({ friends: [...list, { vid, name }].slice(-200) });
    st.notify(`${name} added to friends: you'll be told when they connect, take off or land`);
  }
}

export async function enableFriendNotifications(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  useStore.getState().setPrefs({ friendNotify: p === 'granted' });
  return p === 'granted';
}

function tell(msg: string) {
  const st = useStore.getState();
  st.notify(msg);
  if (st.prefs.friendNotify && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try {
      new Notification('IVAO Pulse', { body: msg, icon: `${import.meta.env.BASE_URL}favicon.svg`, tag: msg });
    } catch {
      /* some browsers only allow notifications from a service worker */
    }
  }
}

/** Watches the feed for friends coming online, taking off and landing. */
export function useFriendAlerts() {
  const flights = useStore((s) => s.flights);
  const controllers = useStore((s) => s.controllers);
  const status = useStore((s) => s.status);
  const friends = useStore((s) => s.prefs.friends);
  const seen = useRef<Map<number, { cs: string; ground: boolean | null }> | null>(null);
  useEffect(() => {
    if (status !== 'live' || !friends.length) {
      if (status !== 'live') seen.current = null;
      return;
    }
    const want = new Set(friends.map((f) => f.vid));
    const now = new Map<number, { cs: string; ground: boolean | null }>();
    for (const f of flights) if (want.has(f.vid)) now.set(f.vid, { cs: f.callsign, ground: f.onGround });
    for (const c of controllers) if (want.has(c.vid) && !now.has(c.vid)) now.set(c.vid, { cs: c.callsign, ground: null });
    const before = seen.current;
    seen.current = now;
    if (!before) return; // first snapshot: don't announce everyone already online
    for (const [vid, n] of now) {
      const b = before.get(vid);
      if (!b) tell(`${n.cs} is online${n.ground === null ? ' (ATC)' : ''}`);
      else if (b.ground === true && n.ground === false) tell(`${n.cs} took off`);
      else if (b.ground === false && n.ground === true) tell(`${n.cs} landed`);
    }
    for (const [vid, b] of before) if (!now.has(vid)) tell(`${b.cs} went offline`);
    // Keep stored names fresh (callsigns change between sessions).
    const st = useStore.getState();
    let changed = false;
    const list = st.prefs.friends.map((f) => {
      const n = now.get(f.vid);
      if (n && n.cs !== f.name) {
        changed = true;
        return { ...f, name: n.cs };
      }
      return f;
    });
    if (changed) st.setPrefs({ friends: list });
  }, [flights, controllers, status, friends]);
}
