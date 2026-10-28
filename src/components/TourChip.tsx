import { useStore } from '../state/store';
import { stopTour } from '../lib/tour';
import { IconPlane, IconX } from './Icons';

export function TourChip() {
  const tour = useStore((s) => s.tour);
  const f = useStore((s) => (s.selection?.kind === 'flight' ? s.flightMap.get(s.selection.key) : undefined));
  if (!tour) return null;
  return (
    <div className="tour-chip glass" role="status">
      <span className="live-dot" aria-hidden="true" />
      <span className="small">Cinematic tour</span>
      {f && (
        <span className="mono strong">
          <IconPlane size={13} style={{ transform: `rotate(${f.heading ?? 0}deg)` }} /> {f.callsign} {f.dep && f.arr ? `· ${f.dep} → ${f.arr}` : ''}
        </span>
      )}
      <button className="icon-btn small" onClick={stopTour} aria-label="Stop the tour" title="Stop (O)">
        <IconX size={14} />
      </button>
    </div>
  );
}
