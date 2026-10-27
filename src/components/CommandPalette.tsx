import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore, type Panel } from '../state/store';
import { searchAirports } from '../data/airports';
import { selectAirport, selectController, selectFlight, toggleFullscreen } from '../lib/actions';
import { enterReplay, exitReplay } from '../data/replay';
import { openBoard } from './Board';
import { openProfile } from './Logbook';
import { showWhatsNew } from './WhatsNew';
import { IconBoard, IconClock, IconGlobe, IconHeadset, IconMoon, IconPlane, IconReplay, IconRuler, IconRunway, IconSearch, IconStar, IconTower, IconUser } from './Icons';

interface Item {
  id: string;
  title: ReactNode;
  sub?: string;
  icon: ReactNode;
  group: string;
  run: () => void;
}

const PANELS: { id: Panel; name: string; icon: ReactNode; key: string }[] = [
  { id: 'traffic', name: 'Traffic list', icon: <IconPlane size={16} />, key: 'T' },
  { id: 'airports', name: 'Airports', icon: <IconRunway size={16} />, key: 'A' },
  { id: 'atc', name: 'ATC online', icon: <IconTower size={16} />, key: 'S' },
  { id: 'myflight', name: 'My flight', icon: <IconUser size={16} />, key: 'P' },
  { id: 'atcdesk', name: 'ATC desk', icon: <IconHeadset size={16} />, key: 'D' },
  { id: 'friends', name: 'Friends', icon: <IconStar size={16} />, key: 'U' },
  { id: 'logbook', name: 'Logbook', icon: <IconClock size={16} />, key: 'B' },
  { id: 'stats', name: 'Stats & leaderboards', icon: <IconClock size={16} />, key: 'N' },
];

/** Ctrl/⌘+K: jump to any flight, controller, airport or action. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const flights = useStore((s) => s.flights);
  const controllers = useStore((s) => s.controllers);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setQ('');
        setI(0);
      }
    };
    const o = () => (setOpen(true), setQ(''), setI(0));
    window.addEventListener('keydown', h);
    window.addEventListener('webeye:palette', o);
    return () => (window.removeEventListener('keydown', h), window.removeEventListener('webeye:palette', o));
  }, []);
  useEffect(() => {
    if (open) window.setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  const items = useMemo<Item[]>(() => {
    if (!open) return [];
    const st = useStore.getState();
    const s = q.trim().toUpperCase();
    const out: Item[] = [];
    const actions: Item[] = [
      { id: 'replay', group: 'Actions', icon: <IconReplay size={16} />, title: st.replay ? 'Back to live traffic' : 'Time machine: replay the last 18 hours', sub: 'Y', run: () => (st.replay ? exitReplay() : enterReplay()) },
      { id: 'measure', group: 'Actions', icon: <IconRuler size={16} />, title: 'Measure distance and bearing', sub: 'X', run: () => useStore.setState({ measure: [] }) },
      { id: 'globe', group: 'Actions', icon: <IconGlobe size={16} />, title: st.prefs.globe ? 'Flat chart view' : '3D globe view', sub: 'G', run: () => st.setPrefs({ globe: !st.prefs.globe }) },
      { id: 'theme', group: 'Actions', icon: <IconMoon size={16} />, title: 'Switch light / dark mode', run: () => st.setPrefs({ theme: document.documentElement.dataset.theme === 'light' ? 'dark' : 'light' }) },
      { id: 'radar', group: 'Actions', icon: <IconTower size={16} />, title: st.prefs.mapStyle === 'radar' ? 'Leave radar mode' : 'Radar scope mode', sub: 'R', run: () => st.setPrefs({ mapStyle: st.prefs.mapStyle === 'radar' ? st.prefs.lastNonRadarStyle : 'radar' }) },
      { id: 'film', group: 'Actions', icon: <IconGlobe size={16} />, title: 'Filming mode (hide the interface)', sub: 'H', run: () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' })) },
      { id: 'fs', group: 'Actions', icon: <IconGlobe size={16} />, title: 'Fullscreen', sub: 'Shift+F', run: toggleFullscreen },
      { id: 'whatsnew', group: 'Actions', icon: <IconGlobe size={16} />, title: 'What’s new in WebEye 3.0', run: showWhatsNew },
      { id: 'world', group: 'Actions', icon: <IconGlobe size={16} />, title: 'World view', sub: 'W', run: () => st.camera_({ type: 'world' }) },
      ...PANELS.map((p) => ({ id: `panel-${p.id}`, group: 'Open', icon: p.icon, title: p.name, sub: p.key, run: () => st.setPanel(p.id) })),
    ];
    if (s.length < 2) return actions;
    for (const f of flights) {
      if (out.length >= 8) break;
      if (f.callsign.includes(s) || String(f.vid) === s || (f.aircraft ?? '').startsWith(s)) {
        out.push({ id: `f${f.key}`, group: 'Flights', icon: <IconPlane size={16} style={{ transform: `rotate(${f.heading ?? 0}deg)` }} />, title: <span className="mono">{f.callsign}</span>, sub: `${f.dep ?? '····'} → ${f.arr ?? '····'}${f.aircraft ? ` · ${f.aircraft}` : ''}`, run: () => selectFlight(f, { frame: 'route' }) });
      }
    }
    for (const c of controllers) {
      if (out.filter((x) => x.group === 'ATC').length >= 6) break;
      if (c.callsign.toUpperCase().includes(s) || String(c.vid) === s) {
        out.push({ id: `c${c.key}`, group: 'ATC', icon: <IconTower size={16} />, title: <span className="mono">{c.callsign}</span>, sub: c.frequency ? c.frequency.toFixed(3) : c.position, run: () => selectController(c) });
      }
    }
    for (const a of searchAirports(s, 6)) {
      out.push({ id: `a${a.icao}`, group: 'Airports', icon: <IconRunway size={16} />, title: <span><span className="mono">{a.icao}</span> {a.name}</span>, sub: a.city, run: () => selectAirport(a.icao) });
      if (out.filter((x) => x.group === 'Boards').length < 2) out.push({ id: `b${a.icao}`, group: 'Boards', icon: <IconBoard size={16} />, title: `${a.icao} departures & arrivals board`, sub: a.name, run: () => openBoard(a.icao) });
    }
    if (/^\d{3,8}$/.test(s)) out.push({ id: `u${s}`, group: 'Pilots', icon: <IconUser size={16} />, title: `Profile of VID ${s}`, sub: 'Logbook, hours and badges', run: () => openProfile(Number(s)) });
    const ql = q.trim().toLowerCase();
    out.push(...actions.filter((a) => String(a.title).toLowerCase().includes(ql)));
    const order = ['Flights', 'ATC', 'Airports', 'Boards', 'Pilots', 'Actions', 'Open'];
    return out.map((x, n) => ({ x, n })).sort((a, b) => order.indexOf(a.x.group) - order.indexOf(b.x.group) || a.n - b.n).map((o) => o.x);
  }, [open, q, flights, controllers]);

  if (!open) return null;
  const run = (it: Item | undefined) => {
    if (!it) return;
    setOpen(false);
    it.run();
  };
  let lastGroup = '';
  return (
    <div className="palette-wrap" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="palette glass" role="dialog" aria-label="Command palette">
        <div className="palette-in">
          <IconSearch size={18} />
          <input
            ref={input}
            value={q}
            placeholder="Search flights, ATC, airports, VIDs… or type a command"
            onChange={(e) => (setQ(e.target.value), setI(0))}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setI((n) => Math.min(items.length - 1, n + 1)));
              else if (e.key === 'ArrowUp') (e.preventDefault(), setI((n) => Math.max(0, n - 1)));
              else if (e.key === 'Enter') run(items[i]);
              else if (e.key === 'Escape') setOpen(false);
            }}
            aria-label="Search or command"
            aria-activedescendant={items[i] ? `pal-${items[i].id}` : undefined}
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="palette-list" role="listbox">
          {items.map((it, n) => {
            const head = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <li key={it.id} role="option" aria-selected={n === i} id={`pal-${it.id}`}>
                {head && <div className="palette-group">{head}</div>}
                <button className={n === i ? 'on' : ''} onMouseEnter={() => setI(n)} onClick={() => run(it)}>
                  <span className="pal-ico">{it.icon}</span>
                  <span className="pal-title">{it.title}</span>
                  {it.sub && <span className="pal-sub dim small mono">{it.sub}</span>}
                </button>
              </li>
            );
          })}
          {!items.length && <li className="dim small palette-empty">Nothing matches “{q}”.</li>}
        </ul>
      </div>
    </div>
  );
}
