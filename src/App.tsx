import { useEffect, useMemo } from 'react';
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
import { IconAlert, IconPlane, IconRunway, IconTower, IconUser, IconX } from './components/Icons';
import { loadAirports } from './data/airports';
import { startFeed, retryNow } from './data/feed';
import { toggleFullscreen } from './lib/actions';

function NavRail() {
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);
  const atcN = useStore((s) => s.controllers.length);
  const myVid = useStore((s) => s.prefs.myVid);
  const plan = useStore((s) => s.plan);
  const items: { id: PanelId; label: string; icon: React.ReactNode; badge?: string | number; key: string }[] = [
    { id: 'traffic', label: 'Traffic', icon: <IconPlane size={20} />, key: 'T' },
    { id: 'airports', label: 'Airports', icon: <IconRunway size={20} />, key: 'A' },
    { id: 'atc', label: 'ATC', icon: <IconTower size={20} />, badge: atcN || undefined, key: 'S' },
    { id: 'myflight', label: 'My flight', icon: <IconUser size={20} />, badge: myVid || plan ? '•' : undefined, key: 'P' },
  ];
  return (
    <nav className="rail glass" aria-label="Views">
      {items.map((it) => (
        <button key={it.id} className={`rail-btn ${panel === it.id ? 'on' : ''}`} aria-pressed={panel === it.id} title={`${it.label} (${it.key})`} onClick={() => setPanel(panel === it.id ? null : it.id)}>
          {it.icon}
          <span>{it.label}</span>
          {it.badge != null && <i className="rail-badge mono">{it.badge}</i>}
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

function useShortcuts() {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useStore.getState();
      const sel = s.selection;
      const f = sel?.kind === 'flight' ? s.flightMap.get(sel.key) : undefined;
      const k = e.key;
      const panels: Record<string, PanelId> = { t: 'traffic', a: 'airports', s: 'atc', p: 'myflight' };
      if (k === 'Escape') {
        if (s.overlay) s.setOverlay(null);
        else if (s.selection) s.select(null);
        else if (s.panel) s.setPanel(null);
      } else if (k === 'F' && e.shiftKey) toggleFullscreen();
      else if (k === 'f' && f) s.setFollow(!s.follow);
      else if (k === 'c' && f) s.camera_({ type: 'fly', center: [f.lon, f.lat] });
      else if (k === 'w') s.camera_({ type: 'world' });
      else if (k === 'r') s.setPrefs({ mapStyle: s.prefs.mapStyle === 'radar' ? s.prefs.lastNonRadarStyle : 'radar' });
      else if (k === 'l') s.setPrefs({ labels: s.prefs.labels === 'off' ? 'callsign' : s.prefs.labels === 'callsign' ? 'full' : 'off' });
      else if (k === 'm') s.setOverlay(s.overlay === 'layers' ? null : 'layers');
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
  const visible = useMemo(() => flights.filter((f) => passesFilters(f, filters, filters.region === 'view' ? viewBounds : null)), [flights, filters, filters.region === 'view' ? viewBounds : null]); // eslint-disable-line react-hooks/exhaustive-deps

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
      {selFlight && <AircraftDetailsPanel key={selFlight.key} flight={selFlight} />}
      {!selFlight && selAtc && <AtcDetailsPanel key={selAtc.key} c={selAtc} />}
      {selFlight && <TelemetryBar f={selFlight} />}
      <MapControls />
      {overlay === 'layers' && <MapLayerControls />}
      {overlay === 'settings' && <SettingsPanel />}
      {overlay === 'help' && <Shortcuts />}
      <Toast />
    </div>
  );
}
