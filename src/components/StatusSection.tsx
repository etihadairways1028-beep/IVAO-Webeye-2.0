import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { RECORDER_URL } from '../data/endpoints';
import { ago } from '../lib/format';

type Rec = { lastRecorded?: string; pilots?: string; lastError?: string; lastErrorAt?: string } | null;

/** One-glance health check of everything the live site depends on. */
export function StatusSection() {
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const updated = useStore((s) => s.sourceUpdatedAt);
  const counts = useStore((s) => s.counts);
  const [rec, setRec] = useState<Rec | 'down' | 'off' | undefined>(undefined);

  useEffect(() => {
    if (!RECORDER_URL) return setRec('off');
    let alive = true;
    fetch(`${RECORDER_URL}/status`, { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: Rec) => alive && setRec(j))
      .catch(() => alive && setRec('down'));
    return () => {
      alive = false;
    };
  }, []);

  const recAge = rec && typeof rec === 'object' && rec.lastRecorded ? Date.now() - new Date(rec.lastRecorded).getTime() : null;
  const recOk = recAge != null && recAge < 5 * 60e3;
  const recentErr = rec && typeof rec === 'object' && rec.lastError && rec.lastErrorAt && Date.now() - new Date(rec.lastErrorAt).getTime() < 15 * 60e3;

  return (
    <div className="status-list">
      <div className={`status-item ${status === 'live' ? 'ok' : status === 'demo' ? '' : 'bad'}`}>
        <i />
        <span>IVAO live feed</span>
        <span className="dim small">
          {status === 'live' ? `OK · ${counts.pilots ?? 0} pilots, ${counts.atc ?? 0} ATC · ${updated ? ago(updated) : ''}` : status === 'demo' ? 'Demo data selected' : status === 'connecting' ? 'Connecting…' : error ?? status}
        </span>
      </div>
      <div className={`status-item ${rec === undefined ? '' : recOk ? 'ok' : 'bad'}`}>
        <i />
        <span>Track recorder</span>
        <span className="dim small">
          {rec === undefined
            ? 'Checking…'
            : rec === 'off'
              ? 'Not set up for this site'
              : rec === 'down' || rec === null
                ? 'Unreachable from this browser'
                : recOk
                  ? `OK · recorded ${ago(rec.lastRecorded!)} · ${rec.pilots ?? '?'} pilots`
                  : rec.lastRecorded
                    ? `Stopped · last recorded ${ago(rec.lastRecorded)}${rec.lastError ? ` · ${rec.lastError}` : ''}`
                    : `Not recording yet${rec.lastError ? ` · ${rec.lastError}` : ''}`}
          {recOk && recentErr ? ` · recent error: ${(rec as { lastError: string }).lastError}` : ''}
        </span>
      </div>
      {RECORDER_URL && (
        <a className="link-btn small" href={`${RECORDER_URL}/status`} target="_blank" rel="noopener noreferrer">
          Open recorder status
        </a>
      )}
    </div>
  );
}
