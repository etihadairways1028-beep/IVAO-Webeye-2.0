import { useSyncExternalStore } from 'react';
import { useStore } from '../state/store';
import { chartState, loadChart, onChartsChange } from '../data/charts';

/** Status of the ground chart for the airport you're zoomed into. */
export function ChartChip() {
  const icao = useStore((s) => s.chartFocus);
  const st = useSyncExternalStore(onChartsChange, () => (icao ? chartState(icao) : null));
  if (!icao || !st) return null;
  return (
    <div className={`chart-chip glass ${st.status}`} role="status" aria-live="polite">
      <span className="mono strong">{icao}</span>{' '}
      {st.status === 'loading' && <span>Loading ground chart…</span>}
      {st.status === 'ready' &&
        (st.counts.taxiways || st.counts.stands ? (
          <span>
            {st.counts.taxiways} taxiways · {st.counts.stands + st.counts.gates} stands
          </span>
        ) : (
          <span className="dim">No taxiways mapped in OpenStreetMap yet</span>
        ))}
      {st.status === 'error' && (
        <>
          <span className="warn">{st.error}</span>
          <button className="link-btn" onClick={() => loadChart(icao)}>
            Retry
          </button>
        </>
      )}
    </div>
  );
}
