import { useEffect, useMemo, useState } from 'react';
import { FlightMap, getMapController } from './map/FlightMap';
import { passesFilters, useStore, type Panel as PanelId } from './state/store';
import { TopNavigation } from './components/TopNavigation';
import { TrafficDirectory } from './components/TrafficDirectory';
import { AirportExplorer } from './components/AirportExplorer';
import { ATCStations, AtcDetailsPanel } from './components/ATCStations';
import { MyFlight } from './components/MyFlight';
import { AircraftDetailsPanel } from './components/AircraftDetailsPanel';
import { MapLayerControls } from './components/MapLayerControls';
import { SettingsPanel, SHORTCUTS } from './components/SettingsPanel';
import { MapControls } from './components/MapControls';
import { TelemetryBar } from './components/TelemetryBar';
import { About } from './components/About';
import { ChartChip } from './components/ChartChip';
import { IconLogo } from './components/Icons';
import { IconAlert, IconHeadset, IconPlane, IconRunway, IconTower, IconUser, IconX } from './components/Icons';
import { AtcDesk } from './components/AtcDesk';
import { Logbook } from './components/Logbook';
import { StatsPanel } from './components/StatsPanel';
import { Profile } from './components/Profile';
import { FriendsPanel } from './components/Friends';
import { AirlinePanel } from './components/AirlinePanel';
import { EmbedBadge } from './components/Embed';
import { TourChip } from './components/TourChip';
import { startTour, stopTour, useTour } from './lib/tour';
import { useFriendAlerts } from './lib/friends';
import { IconStar } from './components/Icons';
import { ReplayBar } from './components/ReplayBar';
import { applyAccent } from './lib/accent';
import { BoardOverlay } from './components/Board';
import { MeasureCard } from './components/MeasureCard';
import { CommandPalette } from './components/CommandPalette';
import { WhatsNew } from './components/WhatsNew';
import { enterReplay, exitReplay, setReplay } from './data/replay';
import { IconClock, IconGauge } from './components/Icons';
import { usePilotClearance } from './lib/clearance';
import { useConflictAlerts } from './lib/conflicts';
import { loadAirports } from './data/airports';
import { startFeed, retryNow } from './data/feed';
import { toggleFullscreen } from './lib/actions';
import { useShareLinks } from './lib/share';

function NavRail() {
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);
  const atcN = useStore((s) => s.controllers.length);
  const myVid = useStore((s) => s.prefs.myVid);
  const plan = useStore((s) => s.plan);
  const incoming = useStore((s) => s.incoming);
  const atcOn = useStore((s) => !!s.atcSession);
  const alerts = useStore((s) => s.conflicts.length);
  const friendsOn = useStore((s) => {
    if (!s.prefs.friends.length) return 0;
    const v = new Set(s.prefs.friends.map((f) => f.vid));
    let n = 0;
    for (const f of s.flights) if (!f.demo && v.has(f.vid)) n++;
    for (const c of s.controllers) if (!c.demo && v.has(c.vid)) n++;
    return n;
  });
  const items: { id: PanelId; label: string; icon: React.ReactNode; badge?: string | number; key: string }[] = [
    { id: 'traffic', label: 'Traffic', icon: <IconPlane size={20} />, key: 'T' },
    { id: 'airports', label: 'Airports', icon: <IconRunway size={20} />, key: 'A' },
    { id: 'atc', label: 'ATC', icon: <IconTower size={20} />, badge: atcN || undefined, key: 'S' },
    { id: 'myflight', label: 'My flight', icon: <IconUser size={20} />, badge: incoming && !incoming.ack ? '1' : myVid || plan ? '•' : undefined, key: 'P' },
    { id: 'atcdesk', label: 'ATC desk', icon: <IconHeadset size={20} />, badge: alerts ? `!${alerts}` : atcOn ? '✓' : undefined, key: 'D' },
    { id: 'friends', label: 'Friends', icon: <IconStar size={20} />, badge: friendsOn || undefined, key: 'U' },
    { id: 'logbook', label: 'Logbook', icon: <IconClock size={20} />, key: 'B' },
    { id: 'stats', label: 'Stats', icon: <IconGauge size={20} />, key: 'N' },
  ];
  return (
    <nav className="rail glass" aria-label="Views">
      {items.map((it) => (
        <button key={it.id} className={`rail-btn ${panel === it.id ? 'on' : ''}`} aria-pressed={panel === it.id} title={`${it.label} (${it.key})`} onClick={() => setPanel(panel === it.id ? null : it.id)}>
          {it.icon}
          <span>{it.label}</span>
          {it.badge != null && <i className={`rail-badge mono ${String(it.badge).startsWith('!') ? 'alert' : ''}`} title={String(it.badge).startsWith('!') ? 'Traffic alerts' : undefined}>{String(it.badge).replace(/^!/, '')}</i>}
        </button>
      ))}
    </nav>
  );
}

function Toast() {
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => useStore.setState({ toast: null }), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);
  return toast ? (
    <div className="toast glass" role="status" key={toast.id}>
      {toast.text}
    </div>
  ) : null;
}

function FeedBanner() {
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const setPrefs = useStore((s) => s.setPrefs);
  if (status === 'demo')
    return (
      <div className="banner demo glass" role="note">
        <span className="banner-tag">DEMO</span> Synthetic traffic — not live IVAO data.
        <button className="link-btn" onClick={() => setPrefs({ source: 'live' })}>
          Go live
        </button>
      </div>
    );
  if (status === 'stale' || status === 'error')
    return (
      <div className="banner warn glass" role="alert">
        <IconAlert size={15} /> {status === 'stale' ? 'IVAO feed delayed — showing last known positions.' : 'IVAO feed unreachable.'} <span className="dim">{error}</span>
        <button className="link-btn" onClick={retryNow}>
          Retry
        </button>
        {status === 'error' && (
          <button className="link-btn" onClick={() => setPrefs({ source: 'demo' })}>
            Use demo
          </button>
        )}
      </div>
    );
  return null;
}

function Shortcuts() {
  const setOverlay = useStore((s) => s.setOverlay);
  return (
    <div className="popover glass center" role="dialog" aria-label="Keyboard shortcuts">
      <div className="popover-head">
        <h2>Keyboard shortcuts</h2>
        <button className="icon-btn small" aria-label="Close" onClick={() => setOverlay(null)}>
          <IconX size={16} />
        </button>
      </div>
      <ul className="shortcuts">
        {SHORTCUTS.map(([k, d]) => (
          <li key={k}>
            <kbd>{k}</kbd>
            <span>{d}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function useReplayAttr() {
  const on = useStore((s) => !!s.replay);
  useEffect(() => {
    document.documentElement.dataset.replay = on ? '1' : '0';
  }, [on]);
}

function useShortcuts() {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useStore.getState();
      const sel = s.selection;
      const f = sel?.kind === 'flight' ? s.flightMap.get(sel.key) : undefined;
      const k = e.key;
      const panels: Record<string, PanelId> = { t: 'traffic', a: 'airports', s: 'atc', p: 'myflight', d: 'atcdesk', b: 'logbook', n: 'stats', u: 'friends' };
      if (k === 'Escape') {
        if (s.measure) useStore.setState({ measure: null });
        else if (s.overlay) s.setOverlay(null);
        else if (s.selection) s.select(null);
        else if (s.panel) s.setPanel(null);
      } else if (k === 'F' && e.shiftKey) toggleFullscreen();
      else if (k === 'f' && f) s.setFollow(!s.follow);
      else if (k === 'c' && f) s.camera_({ type: 'fly', center: [f.lon, f.lat] });
      else if (k === 'w') s.camera_({ type: 'world' });
      else if (k === 'g') s.setPrefs({ globe: !s.prefs.globe });
      else if (k === 'h') {
        // Filming mode: hide every panel and button, keep only the map.
        const on = document.documentElement.dataset.film !== '1';
        document.documentElement.dataset.film = on ? '1' : '0';
        getMapController()?.map.resize();
        if (on) s.notify('Filming mode: press H to bring the interface back');
      }
      else if (k === 'r') s.setPrefs({ mapStyle: s.prefs.mapStyle === 'radar' ? s.prefs.lastNonRadarStyle : 'radar' });
      else if (k === 'l') s.setPrefs({ labels: s.prefs.labels === 'auto' ? 'full' : s.prefs.labels === 'full' ? 'off' : s.prefs.labels === 'off' ? 'callsign' : 'auto' });
      else if (k === 'm') s.setOverlay(s.overlay === 'layers' ? null : 'layers');
      else if (k === 'o') (s.tour ? stopTour() : startTour());
      else if (k === 'x') useStore.setState({ measure: s.measure ? null : [] });
      else if (k === 'y') (s.replay ? exitReplay() : enterReplay());
      else if (k === ' ' && s.replay) setReplay({ playing: !s.replay.playing });
      else if (k === '?') s.setOverlay(s.overlay === 'help' ? null : 'help');
      else if (panels[k]) s.setPanel(s.panel === panels[k] ? null : panels[k]);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
}

export default function App() {
  const source = useStore((s) => s.prefs.source);
  const flights = useStore((s) => s.flights);
  const filters = useStore((s) => s.prefs.filters);
  const viewBounds = useStore((s) => s.viewBounds);
  const panel = useStore((s) => s.panel);
  const overlay = useStore((s) => s.overlay);
  const selection = useStore((s) => s.selection);
  const flightMap = useStore((s) => s.flightMap);
  const controllers = useStore((s) => s.controllers);
  useShortcuts();
  useReplayAttr();
  useShareLinks();
  usePilotClearance();
  useConflictAlerts();
  useFriendAlerts();
  useTour();

  useEffect(() => {
    loadAirports()
      .then(() => useStore.setState({ airportsReady: true }))
      .catch(() => useStore.getState().notify('Airport database failed to load'));
  }, []);

  // Start polling only once airports are known (ATC placement + demo routes need them).
  const airportsReady = useStore((s) => s.airportsReady);
  useEffect(() => {
    if (airportsReady) startFeed(source);
  }, [source, airportsReady]);

  // Filtering drives both the map and the directory. View-bounds filtering only
  // re-runs on camera moves when that region filter is active.
  const airlineFilter = useStore((s) => s.airlineFilter);
  const embed = useStore((s) => s.embed);
  const visible = useMemo(
    () =>
      flights.filter(
        (f) =>
          passesFilters(f, filters, filters.region === 'view' ? viewBounds : null) &&
          (!airlineFilter || (f.callsign.startsWith(airlineFilter) && /\d/.test(f.callsign.charAt(airlineFilter.length)))) &&
          (!embed?.airport || f.dep === embed.airport || f.arr === embed.airport),
      ),
    [flights, filters, filters.region === 'view' ? viewBounds : null, airlineFilter, embed], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Map shows filtered traffic (selected aircraft always stays visible).
  useEffect(() => {
    const sel = selection?.kind === 'flight' ? selection.key : null;
    const shown = sel && !visible.some((f) => f.key === sel) && flightMap.get(sel) ? [...visible, flightMap.get(sel)!] : visible;
    getMapController()?.setFlights(shown, useStore.getState().fetchedAt);
  }, [visible, selection, flightMap]);

  const selFlight = selection?.kind === 'flight' ? flightMap.get(selection.key) : undefined;
  const selAtc = selection?.kind === 'atc' ? controllers.find((c) => c.key === selection.key) : undefined;

  // Lost selection (pilot disconnected) → clear it.
  useEffect(() => {
    if (selection?.kind === 'flight' && flights.length && !flightMap.has(selection.key)) {
      useStore.getState().notify('Selected aircraft disconnected');
      useStore.getState().select(null);
    }
  }, [flights, flightMap, selection]);

  const leftOpen = panel != null;
  const rightOpen = !!(selFlight || selAtc);
  const glass = useStore((s) => s.prefs.glass);
  // Light / dark: follows the device unless chosen in Settings; the basemap follows along.
  const themePref = useStore((s) => s.prefs.theme);
  const [sysLight, setSysLight] = useState(() => window.matchMedia('(prefers-color-scheme: light)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const on = () => setSysLight(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const embedTheme = useStore((s) => s.embed?.theme ?? null);
  const theme = embedTheme ?? (themePref === 'system' ? (sysLight ? 'light' : 'dark') : themePref);
  const accent = useStore((s) => s.prefs.accent);
  useEffect(() => {
    applyAccent(accent, theme === 'light');
  }, [accent, theme]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const s = useStore.getState();
    if (theme === 'light' && s.prefs.mapStyle === 'dark') s.setPrefs({ mapStyle: 'standard' });
    if (theme === 'dark' && s.prefs.mapStyle === 'standard') s.setPrefs({ mapStyle: 'dark' });
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#ffffff' : '#0e151c');
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.glass = glass ? '1' : '0';
  }, [glass]);
  useEffect(() => {
    document.documentElement.dataset.leftPanel = leftOpen ? '1' : '0';
    document.documentElement.dataset.rightPanel = rightOpen ? '1' : '0';
  }, [leftOpen, rightOpen]);

  return (
    <div className={`shell ${leftOpen ? 'has-left' : ''} ${rightOpen ? 'has-right' : ''}`}>
      <FlightMap />
      <div className="vignette" aria-hidden="true" />
      <TopNavigation visibleCount={visible.length} />
      <NavRail />
      <FeedBanner />
      {panel === 'traffic' && <TrafficDirectory visible={visible} />}
      {panel === 'airports' && <AirportExplorer />}
      {panel === 'atc' && <ATCStations />}
      {panel === 'myflight' && <MyFlight />}
      {panel === 'atcdesk' && <AtcDesk />}
      {panel === 'logbook' && <Logbook />}
      {panel === 'stats' && <StatsPanel />}
      {panel === 'profile' && <Profile />}
      {panel === 'friends' && <FriendsPanel />}
      {panel === 'airline' && <AirlinePanel />}
      <EmbedBadge />
      <TourChip />
      <ReplayBar />
      <BoardOverlay />
      <MeasureCard />
      <CommandPalette />
      <WhatsNew />
      {selFlight && <AircraftDetailsPanel key={selFlight.key} flight={selFlight} />}
      {!selFlight && selAtc && <AtcDetailsPanel key={selAtc.key} c={selAtc} />}
      {selFlight && <TelemetryBar f={selFlight} />}
      <MapControls />
      <ChartChip />
      {overlay === 'layers' && <MapLayerControls />}
      {overlay === 'settings' && <SettingsPanel />}
      {overlay === 'help' && <Shortcuts />}
      {overlay === 'about' && <About />}
      {!airportsReady && (
        <div className="splash" role="status" aria-live="polite">
          <IconLogo size={44} />
          <div className="splash-name">IVAO Pulse</div>
          <div className="splash-bar"><span /></div>
          <div className="dim small">Loading airport database…</div>
        </div>
      )}
      <Toast />
    </div>
  );
}
