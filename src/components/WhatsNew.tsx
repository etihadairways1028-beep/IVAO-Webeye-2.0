import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { enterReplay } from '../data/replay';
import { IconPulse, IconRunway, IconCloud, IconGauge, IconGlobe, IconLogo, IconPlane, IconReplay, IconSearch, IconSun, IconUser, IconX } from './Icons';

const KEY = 'webeye2.seenVersion';
const VERSION = '3.2';

const FEATURES: { icon: ReactNode; title: string; text: string; key?: string }[] = [
  { icon: <IconPulse size={20} />, title: 'Now on IVAO', text: 'Events, live hotspots and the 10 busiest airports with departures, arrivals and ATC online. First tab on the left.', key: '1' },
  { icon: <IconRunway size={20} />, title: 'Busiest airports on the map', text: 'The top 12 airports get a ring and their traffic count at world view. Click one to open it.' },
  { icon: <IconPlane size={20} />, title: 'Faster, with real aircraft shapes', text: 'Loads much faster, and every type has its own silhouette: A380, 747, 737, ATR, bizjets, helicopters…' },
  { icon: <IconCloud size={20} />, title: 'Airport weather', text: 'Live METARs on the map: VFR, MVFR, IFR and LIFR at a glance, winds from zoom 6, full METAR on hover.' },
  { icon: <IconSun size={20} />, title: 'Day and night', text: 'The night side of the Earth and twilight, moving in real time, plus a traffic heatmap for the world view.' },
  { icon: <IconPlane size={20} />, title: 'Airlines & embeds', text: 'Every flight of an airline in one place, and a live map you can embed on your virtual airline’s website.' },
  { icon: <IconGauge size={20} />, title: 'Flight profile', text: 'Altitude and speed charts for the whole flight, right in the aircraft panel.' },
  { icon: <IconUser size={20} />, title: 'Stream overlay', text: 'A lower third for OBS showing your live flight, then your landing rate on touchdown. In My flight.' },
  { icon: <IconGlobe size={20} />, title: 'Cinematic tour', text: 'The camera glides between flights in 3D on its own. Add H for clean footage.', key: 'O' },
  { icon: <IconReplay size={20} />, title: 'Time machine', text: 'Replay the last 18 hours of IVAO traffic at up to 300×.', key: 'Y' },
  { icon: <IconSearch size={20} />, title: 'Command palette', text: 'Find any flight, airline, controller, airport or action in a keystroke.', key: 'Ctrl K' },
];

/** Shown once per major version: what Pulse can do now. */
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
      <div className="wn glass" role="dialog" aria-label="What's new in IVAO Pulse 3.2">
        <button className="icon-btn wn-x" onClick={close} aria-label="Close">
          <IconX />
        </button>
        <div className="wn-hero">
          <span className="wn-logo">
            <IconLogo />
          </span>
          <div>
            <h2>Welcome to IVAO Pulse 3.2</h2>
            <p className="dim">Now faster, with a live network overview and the busiest airports right on the map.</p>
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
