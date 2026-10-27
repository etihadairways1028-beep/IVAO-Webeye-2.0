import { useMemo } from 'react';
import { useStore } from '../state/store';
import { enableFriendNotifications, toggleFriend } from '../lib/friends';
import { selectController, selectFlight } from '../lib/actions';
import { openProfile } from './Logbook';
import { Panel, Section } from './ui';
import { IconBell, IconPlane, IconStar, IconTower, IconUser, IconX } from './Icons';
import { fmtAltShort } from '../lib/format';

/** The pilots and controllers you follow: who's online now and what they're doing. */
export function FriendsPanel() {
  const friends = useStore((s) => s.prefs.friends);
  const notify = useStore((s) => s.prefs.friendNotify);
  const flights = useStore((s) => s.flights);
  const controllers = useStore((s) => s.controllers);
  const rows = useMemo(
    () =>
      friends
        .map((fr) => ({ fr, f: flights.find((x) => x.vid === fr.vid && !x.demo) ?? null, c: controllers.find((x) => x.vid === fr.vid && !x.demo) ?? null }))
        .sort((a, b) => Number(!!(b.f || b.c)) - Number(!!(a.f || a.c)) || a.fr.name.localeCompare(b.fr.name)),
    [friends, flights, controllers],
  );
  const online = rows.filter((r) => r.f || r.c).length;
  const canNotify = typeof window !== 'undefined' && 'Notification' in window;
  return (
    <Panel side="left" label="Friends" icon={<IconStar size={20} />} title="Friends" sub={friends.length ? `${online} of ${friends.length} online` : 'Follow pilots and controllers'} onClose={() => useStore.getState().setPanel(null)}>
      {canNotify && friends.length > 0 && (
        <div className="friend-notify">
          <IconBell size={16} />
          <span className="small">{notify ? 'Browser notifications are on: you’ll hear about friends even with this tab in the background.' : 'Get a notification when a friend connects, takes off or lands, even with this tab in the background.'}</span>
          {notify ? (
            <button className="link-btn" onClick={() => useStore.getState().setPrefs({ friendNotify: false })}>
              Turn off
            </button>
          ) : (
            <button className="btn small" onClick={() => enableFriendNotifications().then((ok) => !ok && useStore.getState().notify('Notifications are blocked in this browser’s site settings'))}>
              Enable
            </button>
          )}
        </div>
      )}
      <Section title="Following">
        {!friends.length && (
          <p className="dim small">
            Tap the <IconStar size={13} /> star on any aircraft, controller or pilot profile to follow them. They’re highlighted on the map and listed here, and you’re told when they connect, take off or land.
          </p>
        )}
        <ul className="friends">
          {rows.map(({ fr, f, c }) => (
            <li key={fr.vid} className={f || c ? 'on' : ''}>
              <button className="friend-main" onClick={() => (f ? selectFlight(f, { frame: 'route' }) : c ? selectController(c) : openProfile(fr.vid))} title={f || c ? 'Show on the map' : 'Open their profile'}>
                <span className={`friend-ico ${f ? 'pilot' : c ? 'atc' : ''}`}>{f ? <IconPlane size={15} style={{ transform: `rotate(${f.heading ?? 0}deg)` }} /> : c ? <IconTower size={15} /> : <IconUser size={15} />}</span>
                <span className="friend-text">
                  <span className="mono strong">{f?.callsign ?? c?.callsign ?? fr.name}</span>
                  <span className="dim small">
                    {f ? `${f.dep ?? '····'} → ${f.arr ?? '····'} · ${f.onGround ? 'on ground' : fmtAltShort(f.altitude)}${f.aircraft ? ` · ${f.aircraft}` : ''}` : c ? `Controlling${c.frequency ? ` · ${c.frequency.toFixed(3)}` : ''}` : `Offline · VID ${fr.vid}`}
                  </span>
                </span>
              </button>
              <button className="icon-btn small" onClick={() => toggleFriend(fr.vid, fr.name)} aria-label={`Unfollow ${fr.name}`} title="Unfollow">
                <IconX size={14} />
              </button>
            </li>
          ))}
        </ul>
      </Section>
      <p className="fineprint">Your friends list is saved in this browser only.</p>
    </Panel>
  );
}

/** Star toggle used on flight, controller and profile panels. */
export function FriendStar({ vid, name }: { vid: number; name: string }) {
  const on = useStore((s) => s.prefs.friends.some((f) => f.vid === vid));
  if (!vid) return null;
  return (
    <button className={`chip-btn ${on ? 'on star-on' : ''}`} aria-pressed={on} onClick={() => toggleFriend(vid, name)} title={on ? 'Unfollow' : 'Follow: get told when they connect, take off or land'}>
      <IconStar size={15} filled={on} /> {on ? 'Friend' : 'Add friend'}
    </button>
  );
}
