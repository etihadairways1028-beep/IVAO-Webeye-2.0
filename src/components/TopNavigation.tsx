import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { IconExpand, IconImport, IconInfo, IconLayers, IconLogo, IconMoon, IconRadar, IconSearch, IconSettings, IconShrink, IconSun } from './Icons';
import { useInstall } from '../lib/install';
import { FlightSearch } from './FlightSearch';
import { toggleFullscreen } from '../lib/actions';
import { ago, fmtZulu } from '../lib/format';

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

const STATUS_TEXT = { idle: 'Idle', connecting: 'Connecting', live: 'Live', stale: 'Delayed', error: 'Offline', demo: 'Demo data' } as const;

export function StatusPill() {
  const status = useStore((s) => s.status);
  const updated = useStore((s) => s.sourceUpdatedAt);
  const error = useStore((s) => s.error);
  const now = useNow(1000);
  const title =
    status === 'demo'
      ? 'Synthetic demonstration traffic — not live IVAO data'
      : status === 'error' || status === 'stale'
        ? `IVAO feed: ${error ?? 'data older than 2 minutes'}`
        : updated
          ? `IVAO Whazzup snapshot ${fmtZulu(updated, true)} (${ago(updated, now)})`
          : 'Connecting to IVAO Whazzup';
  return (
    <div className={`status status-${status}`} title={title} role="status" aria-live="polite">
      <span className="status-dot" aria-hidden="true" />
      <span className="status-label">{STATUS_TEXT[status]}</span>
      {updated && status !== 'demo' && <span className="status-age mono">{ago(updated, now)}</span>}
    </div>
  );
}

function Stat({ label, value, title }: { label: string; value: number | null; title: string }) {
  return (
    <div className="stat" title={title}>
      <span className="stat-v mono">{value == null ? '—' : value.toLocaleString('en-US')}</span>
      <span className="stat-l">{label}</span>
    </div>
  );
}

export function TopNavigation({ visibleCount }: { visibleCount: number }) {
  const counts = useStore((s) => s.counts);
  const flightsN = useStore((s) => s.flights.length);
  const status = useStore((s) => s.status);
  const overlay = useStore((s) => s.overlay);
  const setOverlay = useStore((s) => s.setOverlay);
  const inst = useInstall();
  const themePref = useStore((s) => s.prefs.theme);
  const isLight = themePref === 'light' || (themePref === 'system' && typeof window !== 'undefined' && document.documentElement.dataset.theme === 'light');
  const mapStyle = useStore((s) => s.prefs.mapStyle);
  const lastStyle = useStore((s) => s.prefs.lastNonRadarStyle);
  const setPrefs = useStore((s) => s.setPrefs);
  const [fs, setFs] = useState(!!document.fullscreenElement);
  const [mobileSearch, setMobileSearch] = useState(false);
  const now = useNow(1000);
  useEffect(() => {
    const h = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);
  const hasData = status === 'live' || status === 'stale' || status === 'demo';
  const demo = status === 'demo';

  return (
    <header className={`topbar glass ${mobileSearch ? 'searching' : ''}`}>
      <div className="brand">
        <IconLogo />
      </div>
      <div className="brand-text">
          <span className="brand-name">
            IVAO WebEye<span className="brand-ver">2.1</span>
          </span>
          <span className="brand-sub">Live network traffic · community edition</span>
      </div>
      <StatusPill />
      <div className="stats" aria-label="Network statistics">
        <Stat label={demo ? 'Demo pilots' : 'Pilots'} value={hasData ? counts.pilots : null} title={demo ? 'Synthetic demo aircraft' : 'Pilots connected to IVAO (Whazzup connections.pilot)'} />
        <Stat label={demo ? 'Demo ATC' : 'ATC'} value={hasData ? counts.atc : null} title={demo ? 'Synthetic demo stations' : 'ATC connected to IVAO (Whazzup connections.atc)'} />
        <Stat label="On map" value={hasData ? visibleCount : null} title={`Aircraft drawn after filters (${flightsN} with a position)`} />
      </div>
      <div className="search-slot">
        <FlightSearch onClose={() => setMobileSearch(false)} autoFocus={mobileSearch} />
      </div>
      <div className="top-actions">
        <button className="icon-btn only-mobile" aria-label="Search" onClick={() => setMobileSearch(true)}>
          <IconSearch />
        </button>
        <button
          className={`icon-btn ${mapStyle === 'radar' ? 'on' : ''}`}
          aria-pressed={mapStyle === 'radar'}
          aria-label="Radar mode"
          title="Radar mode (R)"
          onClick={() => setPrefs({ mapStyle: mapStyle === 'radar' ? lastStyle : 'radar' })}
        >
          <IconRadar />
        </button>
        <button className={`icon-btn ${overlay === 'layers' ? 'on' : ''}`} aria-label="Map layers" title="Map layers (M)" aria-expanded={overlay === 'layers'} onClick={() => setOverlay(overlay === 'layers' ? null : 'layers')}>
          <IconLayers />
        </button>
        {inst.mode === 'prompt' && (
          <button className="icon-btn" aria-label="Install app" title="Install IVAO WebEye as an app" onClick={inst.install}>
            <IconImport />
          </button>
        )}
        <button className="icon-btn" aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'} title={isLight ? 'Dark mode' : 'Light mode'} onClick={() => setPrefs({ theme: isLight ? 'dark' : 'light' })}>
          {isLight ? <IconMoon /> : <IconSun />}
        </button>
        <button className={`icon-btn ${overlay === 'about' ? 'on' : ''}`} aria-label="About IVAO WebEye" title="About" aria-expanded={overlay === 'about'} onClick={() => setOverlay(overlay === 'about' ? null : 'about')}>
          <IconInfo />
        </button>
        <button className={`icon-btn ${overlay === 'settings' ? 'on' : ''}`} aria-label="Settings" title="Settings" aria-expanded={overlay === 'settings'} onClick={() => setOverlay(overlay === 'settings' ? null : 'settings')}>
          <IconSettings />
        </button>
        <button className="icon-btn hide-mobile" aria-label={fs ? 'Exit fullscreen' : 'Fullscreen'} title="Fullscreen (Shift+F)" onClick={toggleFullscreen}>
          {fs ? <IconShrink /> : <IconExpand />}
        </button>
        <div className="zulu mono" title="Coordinated Universal Time">
          {fmtZulu(now, true).replace('Z', '')}
          <span>UTC</span>
        </div>
      </div>
    </header>
  );
}
