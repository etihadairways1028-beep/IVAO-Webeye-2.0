import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { enterReplay } from '../data/replay';
import { IconBoard, IconClock, IconHeadset, IconLogo, IconReplay, IconRuler, IconRunway, IconSearch, IconStar, IconX } from './Icons';

const KEY = 'webeye2.seenVersion';
const VERSION = '3.0';

const FEATURES: { icon: ReactNode; title: string; text: string; key?: string }[] = [
  { icon: <IconReplay size={20} />, title: 'Time machine', text: 'Replay the last 18 hours of IVAO traffic at up to 300× speed. Scrub back to any minute.', key: 'Y' },
  { icon: <IconBoard size={20} />, title: 'Airport boards', text: 'Split-flap departures and arrivals for any airport, full screen for a second monitor or your stream.' },
  { icon: <IconStar size={20} />, title: 'Friends', text: 'Follow pilots and controllers. They glow purple on the map and you’re told when they connect, take off or land.', key: 'U' },
  { icon: <IconClock size={20} />, title: 'Automatic logbook', text: 'Every flight logged on landing, with exact touchdown rate, G and fuel from the WebEye Link sim add-on.', key: 'B' },
  { icon: <IconRunway size={20} />, title: 'Ground charts', text: 'Real-scale taxiways, runways and stands at any airport, plus taxi routes from ATC drawn turn by turn.' },
  { icon: <IconHeadset size={20} />, title: 'ATC desk', text: 'Verified controllers send squawks and taxi routes, and get traffic conflict alerts in their airspace.', key: 'D' },
  { icon: <IconRuler size={20} />, title: 'Distance tool', text: 'Measure distance, bearing and flying time between any points, aircraft or airports.', key: 'X' },
  { icon: <IconSearch size={20} />, title: 'Command palette', text: 'Find any flight, controller, airport or action in a keystroke.', key: 'Ctrl K' },
];

/** Shown once per major version: what WebEye can do now. */
export function WhatsNew() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(KEY);
    } catch {
      /* storage blocked: show nothing rather than every visit */
      return;
    }
    // Not on top of a shared link or the board screen.
    if (seen !== VERSION && !location.hash) window.setTimeout(() => setOpen(true), 1200);
    const o = () => setOpen(true);
    window.addEventListener('webeye:whatsnew', o);
    return () => window.removeEventListener('webeye:whatsnew', o);
  }, []);
  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(KEY, VERSION);
    } catch {
      /* ignore */
    }
  };
  if (!open) return null;
  return (
    <div className="wn-wrap" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="wn glass" role="dialog" aria-label="What's new in IVAO WebEye 3.0">
        <button className="icon-btn wn-x" onClick={close} aria-label="Close">
          <IconX />
        </button>
        <div className="wn-hero">
          <span className="wn-logo">
            <IconLogo />
          </span>
          <div>
            <h2>IVAO WebEye 3.0</h2>
            <p className="dim">The whole network, live, with tools you won’t find anywhere else.</p>
          </div>
        </div>
        <ul className="wn-grid">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <span className="wn-ico">{f.icon}</span>
              <div>
                <div className="wn-title">
                  {f.title}
                  {f.key && <kbd>{f.key}</kbd>}
                </div>
                <div className="wn-text small">{f.text}</div>
              </div>
            </li>
          ))}
        </ul>
        <div className="wn-actions">
          <button
            className="chip-btn"
            onClick={() => {
              close();
              enterReplay();
            }}
          >
            <IconReplay size={15} /> Try the time machine
          </button>
          <button className="btn" onClick={close}>
            Start exploring
          </button>
        </div>
      </div>
    </div>
  );
}

export function showWhatsNew() {
  useStore.getState().setOverlay(null);
  window.dispatchEvent(new Event('webeye:whatsnew'));
}
