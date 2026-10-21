import { useStore } from '../state/store';
import { getMapController } from '../map/FlightMap';
import { IconCrosshair, IconFollow, IconGlobe, IconMinus, IconPlus } from './Icons';

export function MapControls() {
  const selection = useStore((s) => s.selection);
  const follow = useStore((s) => s.follow);
  const flightMap = useStore((s) => s.flightMap);
  const st = useStore.getState();
  const globe = useStore((s) => s.prefs.globe);
  const f = selection?.kind === 'flight' ? flightMap.get(selection.key) : undefined;
  return (
    <div className="mapctl" role="toolbar" aria-label="Map controls">
      <div className="mapctl-group glass">
        <button aria-label="Zoom in" title="Zoom in" onClick={() => getMapController()?.map.zoomIn()}>
          <IconPlus size={17} />
        </button>
        <button aria-label="Zoom out" title="Zoom out" onClick={() => getMapController()?.map.zoomOut()}>
          <IconMinus size={17} />
        </button>
      </div>
      <div className="mapctl-group glass">
        <button aria-label="3D globe" aria-pressed={globe} className={`txt ${globe ? 'on' : ''}`} title={globe ? 'Flat chart view (G)' : '3D globe view (G)'} onClick={() => st.setPrefs({ globe: !globe })}>
          3D
        </button>
      </div>
      <div className="mapctl-group glass">
        <button aria-label="World view" title="World view (W)" onClick={() => st.camera_({ type: 'world' })}>
          <IconGlobe size={17} />
        </button>
        <button aria-label="Centre on selected aircraft" title="Centre on aircraft (C)" disabled={!f} onClick={() => f && st.camera_({ type: 'fly', center: [f.lon, f.lat] })}>
          <IconCrosshair size={17} />
        </button>
        <button aria-label="Follow selected aircraft" aria-pressed={follow} className={follow ? 'on' : ''} title="Follow aircraft (F)" disabled={!f} onClick={() => st.setFollow(!follow)}>
          <IconFollow size={17} />
        </button>
      </div>
    </div>
  );
}
