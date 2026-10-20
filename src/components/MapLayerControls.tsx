import { useStore, type MapStyleId } from '../state/store';
import { STYLE_META } from '../map/styles';
import { ALT_RAMP, ATC_COLORS } from '../map/controller';
import { Seg, Toggle } from './ui';
import { IconCloud, IconRunway, IconTower, IconTrail, IconX } from './Icons';
import { ago } from '../lib/format';

const SWATCH: Record<MapStyleId, string> = {
  dark: 'linear-gradient(135deg,#0b1220 0 55%,#162036 55% 100%)',
  standard: 'linear-gradient(135deg,#eef1f5 0 55%,#cfdcea 55% 100%)',
  satellite: 'linear-gradient(135deg,#1d2b1f 0 40%,#30422e 40% 70%,#0f2235 70% 100%)',
  radar: 'radial-gradient(circle at 50% 50%,#0d2a1f 0 20%,#04110c 21% 45%,#0d2a1f 46% 47%,#04110c 48%)',
};

export function MapLayerControls() {
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const setOverlay = useStore((s) => s.setOverlay);
  const wxTime = useStore((s) => s.wxTime);
  const wxError = useStore((s) => s.wxError);
  const layers = prefs.layers;
  const setLayer = (k: keyof typeof layers, v: boolean) => setPrefs({ layers: { ...layers, [k]: v } });

  return (
    <div className="popover glass" role="dialog" aria-label="Map layers">
      <div className="popover-head">
        <h2>Map</h2>
        <button className="icon-btn small" aria-label="Close" onClick={() => setOverlay(null)}>
          <IconX size={16} />
        </button>
      </div>
      <div className="styles">
        {(Object.keys(STYLE_META) as MapStyleId[]).map((id) => (
          <button key={id} className={`style-card ${prefs.mapStyle === id ? 'on' : ''}`} aria-pressed={prefs.mapStyle === id} onClick={() => setPrefs({ mapStyle: id })}>
            <span className="style-swatch" style={{ background: SWATCH[id] }} />
            <span className="style-name">{STYLE_META[id].label}</span>
            <span className="style-hint">{STYLE_META[id].hint}</span>
          </button>
        ))}
      </div>

      <div className="pop-label">Overlays</div>
      <Toggle icon={<IconRunway size={16} />} label="Airports" checked={layers.airports} onChange={(v) => setLayer('airports', v)} />
      <Toggle
        icon={<IconTower size={16} />}
        label="ATC stations"
        hint={
          <span className="atc-legend">
            {(['DEL', 'GND', 'TWR', 'APP', 'CTR'] as const).map((p) => (
              <span key={p}>
                <i style={{ background: ATC_COLORS[p] }} />
                {p}
              </span>
            ))}
          </span>
        }
        checked={layers.atc}
        onChange={(v) => setLayer('atc', v)}
      />
      <Toggle
        icon={<IconCloud size={16} />}
        label="Weather radar"
        hint={layers.weather ? (wxError ? <span className="warn">Unavailable: {wxError}</span> : wxTime ? `RainViewer · frame ${ago(wxTime * 1000)} · zoom ≤ 7` : 'Loading…') : 'Precipitation · RainViewer'}
        checked={layers.weather}
        onChange={(v) => setLayer('weather', v)}
      />
      <Toggle icon={<IconTrail size={16} />} label="Trails" hint="Selected aircraft, plus history dots in radar mode" checked={layers.trails} onChange={(v) => setLayer('trails', v)} />

      <div className="pop-label">Aircraft labels</div>
      <Seg label="Label density" value={prefs.labels} onChange={(labels) => setPrefs({ labels })} options={[{ value: 'off', label: 'Off' }, { value: 'callsign', label: 'Callsign' }, { value: 'full', label: 'Data block' }]} />

      <div className="pop-label">Aircraft colour</div>
      <Seg label="Aircraft colour" value={prefs.colorBy} onChange={(colorBy) => setPrefs({ colorBy })} options={[{ value: 'uniform', label: 'Uniform' }, { value: 'altitude', label: 'By altitude' }]} />
      {prefs.colorBy === 'altitude' && (
        <div className="ramp" aria-label="Altitude colour legend">
          <div className="ramp-bar" style={{ background: `linear-gradient(90deg, ${ALT_RAMP.map(([a, c]) => `${c} ${(a / 40000) * 100}%`).join(',')})` }} />
          <div className="ramp-ticks mono">
            <span>GND</span>
            <span>FL100</span>
            <span>FL200</span>
            <span>FL300</span>
            <span>FL400</span>
          </div>
        </div>
      )}
    </div>
  );
}
