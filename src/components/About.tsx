import { useStore } from '../state/store';
import { IconLogo, IconX } from './Icons';
import { useInstall } from '../lib/install';

export const APP_VERSION = '3.2';

/** Product information, data attribution and the independence notice. */
export function About() {
  const setOverlay = useStore((s) => s.setOverlay);
  const { mode, install } = useInstall();
  return (
    <div className="popover glass center about" role="dialog" aria-label="About IVAO Pulse">
      <div className="popover-head">
        <div className="about-brand">
          <IconLogo size={30} />
          <div>
            <h2>IVAO Pulse {APP_VERSION}</h2>
            <div className="dim small">Live traffic viewer for the IVAO network</div>
          </div>
        </div>
        <button className="icon-btn small" aria-label="Close" onClick={() => setOverlay(null)}>
          <IconX size={16} />
        </button>
      </div>
      <p className="about-text">
        IVAO Pulse shows pilots and air traffic controllers connected to the International Virtual Aviation Organisation in real time, with flight
        details, SimBrief flight plans, airport information and ground charts.
      </p>
      <div className="notice" role="note">
        <strong>Independent community project.</strong> IVAO Pulse is a concept built by members of the IVAO community. It is not an official IVAO release
        and is not endorsed by IVAO unless IVAO states otherwise. “IVAO” is a trademark of its owner. For simulation use only; never use it for real-world navigation.
      </div>
      <div className="pop-label">Data sources</div>
      <table className="about-table">
        <tbody>
          <tr>
            <th>Traffic and ATC</th>
            <td>IVAO Whazzup API (public)</td>
          </tr>
          <tr>
            <th>Flight plans</th>
            <td>SimBrief by Navigraph</td>
          </tr>
          <tr>
            <th>Airports, runways</th>
            <td>OurAirports</td>
          </tr>
          <tr>
            <th>Ground charts</th>
            <td>© OpenStreetMap contributors</td>
          </tr>
          <tr>
            <th>FIR boundaries</th>
            <td>VATSpy Data Project (CC BY-SA 4.0)</td>
          </tr>
          <tr>
            <th>Weather</th>
            <td>NOAA Aviation Weather Center, RainViewer</td>
          </tr>
          <tr>
            <th>Base maps</th>
            <td>© CARTO, Esri, Natural Earth</td>
          </tr>
        </tbody>
      </table>
      {mode === 'ios' && (
        <p className="dim small">
          To install on iPhone or iPad: tap Share in Safari, then <strong>Add to Home Screen</strong>.
        </p>
      )}
      <div className="about-links">
        {mode === 'prompt' && (
          <button className="link-btn" onClick={install}>
            Install app
          </button>
        )}
        <a className="link-btn" href="https://github.com/etihadairways1028-beep/IVAO-Webeye-2.0" target="_blank" rel="noopener noreferrer">
          Source code
        </a>
        <a className="link-btn" href="https://www.ivao.aero" target="_blank" rel="noopener noreferrer">
          ivao.aero
        </a>
        <button className="link-btn" onClick={() => setOverlay('help')}>
          Keyboard shortcuts
        </button>
      </div>
    </div>
  );
}
