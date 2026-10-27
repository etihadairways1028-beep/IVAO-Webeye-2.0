import { StatusSection } from './StatusSection';
import { useStore } from '../state/store';
import { Seg } from './ui';
import { IconX } from './Icons';
import { WHAZZUP_URL } from '../data/ivao';

export const SHORTCUTS: [string, string][] = [
  ['/', 'Search'],
  ['Esc', 'Close / deselect'],
  ['F', 'Follow selected aircraft'],
  ['C', 'Centre on selection'],
  ['W', 'World view'],
  ['G', '3D globe / flat chart'],
  ['H', 'Filming mode: hide the interface'],
  ['R', 'Toggle radar mode'],
  ['L', 'Cycle label density'],
  ['M', 'Map layers'],
  ['T · A · S · P · D', 'Traffic · Airports · ATC (S) · My flight (P) · ATC desk (D)'],
  ['Shift + F', 'Fullscreen'],
  ['?', 'Shortcuts'],
];

export function SettingsPanel() {
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const setOverlay = useStore((s) => s.setOverlay);
  return (
    <div className="popover glass wide" role="dialog" aria-label="Settings">
      <div className="popover-head">
        <h2>Settings</h2>
        <button className="icon-btn small" aria-label="Close" onClick={() => setOverlay(null)}>
          <IconX size={16} />
        </button>
      </div>

      <div className="pop-label">Status</div>
      <StatusSection />

      <div className="pop-label">Data source</div>
      <Seg label="Data source" value={prefs.source} onChange={(source) => setPrefs({ source })} options={[{ value: 'live', label: 'Live IVAO' }, { value: 'demo', label: 'Demo data' }]} />
      <p className="fineprint">
        {prefs.source === 'live' ? (
          <>
            Live traffic from IVAO’s public Whazzup feed (<span className="mono">{WHAZZUP_URL}</span>), refreshed by IVAO every 15 s.
          </>
        ) : (
          <>Synthetic aircraft between real airports, for exploring the interface offline. Demo records are tagged DEMO and never mixed with live traffic.</>
        )}
      </p>

      {prefs.source === 'live' && (
        <>
          <div className="pop-label">Refresh interval</div>
          <Seg label="Refresh interval" value={prefs.pollSec} onChange={(pollSec) => setPrefs({ pollSec })} options={[{ value: 15, label: '15 s' }, { value: 30, label: '30 s' }, { value: 60, label: '60 s' }]} />
          <p className="fineprint">Polling pauses while this tab is hidden (unless you’re tracking your own VID) and backs off after errors.</p>
        </>
      )}

      <div className="pop-label">Appearance</div>
      <Seg label="Theme" value={prefs.theme} onChange={(theme) => setPrefs({ theme })} options={[{ value: 'system', label: 'Match device' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
      <Seg label="Panel style" value={prefs.glass ? 'glass' : 'solid'} onChange={(v) => setPrefs({ glass: v === 'glass' })} options={[{ value: 'glass', label: 'Liquid glass' }, { value: 'solid', label: 'Solid' }]} />
      <p className="fineprint">Liquid glass lets the map show through the panels. Choose Solid on slower computers.</p>

      <div className="pop-label">Transition altitude</div>
      <Seg
        label="Transition altitude"
        value={prefs.transitionAlt}
        onChange={(transitionAlt) => setPrefs({ transitionAlt })}
        options={[
          { value: 5000, label: '5,000' },
          { value: 10000, label: '10,000' },
          { value: 18000, label: '18,000' },
        ]}
      />
      <p className="fineprint">Altitudes at or above this are shown as flight levels.</p>

      <div className="pop-label">Keyboard shortcuts</div>
      <ul className="shortcuts">
        {SHORTCUTS.map(([k, d]) => (
          <li key={k}>
            <kbd>{k}</kbd>
            <span>{d}</span>
          </li>
        ))}
      </ul>

      <div className="pop-label">Data & attribution</div>
      <ul className="sources">
        <li>Traffic & ATC: IVAO Whazzup v2 (public, unauthenticated)</li>
        <li>Airports & runways: OurAirports (public domain)</li>
        <li>Coastlines: Natural Earth (public domain)</li>
        <li>Basemaps: © CARTO, © OpenStreetMap contributors · Imagery © Esri</li>
        <li>Weather: RainViewer radar · NOAA AWC METAR/TAF</li>
        <li>Flight plans: SimBrief OFP fetcher</li>
      </ul>
      <p className="fineprint">For flight-simulation use only. Not certified for real-world navigation or air traffic control.</p>
      <button
        className="link-btn"
        onClick={() => {
          try {
            localStorage.removeItem('webeye2.prefs.v2');
          } catch {
            /* ignore */
          }
          window.location.reload();
        }}
      >
        Reset all preferences
      </button>
    </div>
  );
}
