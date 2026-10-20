import { memo, useDeferredValue, useMemo, useState } from 'react';
import { DEFAULT_FILTERS, filtersActive, phaseOf, useStore } from '../state/store';
import { selectFlight } from '../lib/actions';
import { fmtAltShort } from '../lib/format';
import { REGIONS, type Region } from '../lib/geo';
import { Empty, Panel, Seg } from './ui';
import { IconAlert, IconFilter, IconPlane, IconRefresh } from './Icons';
import { retryNow } from '../data/feed';
import type { Flight, WakeCat } from '../types';

type Tab = 'all' | 'departing' | 'enroute' | 'arriving' | 'ground';
type Sort = 'callsign' | 'altitude' | 'speed';
const PAGE = 150;

const Row = memo(function Row({ f, selected }: { f: Flight; selected: boolean }) {
  const ph = phaseOf(f);
  return (
    <li>
      <button className={`trow ${selected ? 'sel' : ''}`} onClick={() => selectFlight(f, { frame: 'route' })} aria-current={selected}>
        <span className={`phase phase-${ph}`} title={ph} />
        <span className="trow-main">
          <span className="mono strong">{f.callsign}</span>
          <span className="trow-sub">
            {f.dep ?? '····'} → {f.arr ?? '····'}
          </span>
        </span>
        <span className="trow-type mono">{f.aircraft ?? '—'}</span>
        <span className="trow-alt mono">{f.onGround ? 'GND' : fmtAltShort(f.altitude)}</span>
        <span className="trow-gs mono">{f.groundSpeed != null ? Math.round(f.groundSpeed) : '—'}</span>
      </button>
    </li>
  );
});

export function FilterControls() {
  const filters = useStore((s) => s.prefs.filters);
  const setFilters = useStore((s) => s.setFilters);
  const toggleWake = (w: WakeCat) => setFilters({ wake: filters.wake.includes(w) ? filters.wake.filter((x) => x !== w) : [...filters.wake, w] });
  return (
    <div className="filters">
      <div className="frow">
        <span className="flabel">Category</span>
        <div className="chips">
          {(['L', 'M', 'H', 'J'] as WakeCat[]).map((w) => (
            <button key={w} className={`chip ${filters.wake.includes(w) ? 'on' : ''}`} aria-pressed={filters.wake.includes(w)} onClick={() => toggleWake(w)}>
              {{ L: 'Light', M: 'Medium', H: 'Heavy', J: 'Super' }[w as 'L']}
            </button>
          ))}
        </div>
      </div>
      <div className="frow">
        <span className="flabel">Rules</span>
        <Seg label="Flight rules" value={filters.rules} onChange={(rules) => setFilters({ rules })} options={[{ value: 'all', label: 'All' }, { value: 'I', label: 'IFR' }, { value: 'V', label: 'VFR' }]} />
      </div>
      <div className="frow">
        <label className="flabel" htmlFor="f-min">
          Altitude
        </label>
        <div className="alt-range">
          <input id="f-min" type="number" min={0} max={600} step={10} value={filters.minFl} onChange={(e) => setFilters({ minFl: Math.max(0, Math.min(600, Number(e.target.value) || 0)) })} aria-label="Minimum flight level" />
          <span className="dim">to</span>
          <input type="number" min={0} max={600} step={10} value={filters.maxFl} onChange={(e) => setFilters({ maxFl: Math.max(0, Math.min(600, Number(e.target.value) || 0)) })} aria-label="Maximum flight level" />
          <span className="dim mono">FL</span>
        </div>
      </div>
      <div className="frow">
        <label className="flabel" htmlFor="f-region">
          Region
        </label>
        <select id="f-region" className="select" value={filters.region} onChange={(e) => setFilters({ region: e.target.value as Region })}>
          {REGIONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="frow">
        <label className="check">
          <input type="checkbox" checked={filters.hideGround} onChange={(e) => setFilters({ hideGround: e.target.checked })} /> Hide aircraft on ground
        </label>
        {filtersActive(filters) && (
          <button className="link-btn" onClick={() => setFilters(DEFAULT_FILTERS)}>
            Reset filters
          </button>
        )}
      </div>
    </div>
  );
}

export function FeedProblem() {
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const n = useStore((s) => s.flights.length);
  if (status === 'connecting' && n === 0)
    return (
      <div className="loading-list" aria-busy="true">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="skeleton" style={{ animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
    );
  if (status === 'error' && n === 0)
    return (
      <Empty icon={<IconAlert size={22} />} title="Can’t reach the IVAO feed">
        <p>{error}</p>
        <div className="row-btns">
          <button className="btn" onClick={retryNow}>
            <IconRefresh size={15} /> Retry
          </button>
          <button className="btn ghost" onClick={() => useStore.getState().setPrefs({ source: 'demo' })}>
            Explore with demo data
          </button>
        </div>
      </Empty>
    );
  return null;
}

export function TrafficDirectory({ visible }: { visible: Flight[] }) {
  const [tab, setTab] = useState<Tab>('all');
  const [sort, setSort] = useState<Sort>('callsign');
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [q, setQ] = useState('');
  const dq = useDeferredValue(q.trim().toUpperCase());
  const filters = useStore((s) => s.prefs.filters);
  const sel = useStore((s) => (s.selection?.kind === 'flight' ? s.selection.key : null));
  const setPanel = useStore((s) => s.setPanel);

  const byPhase = useMemo(() => {
    const m: Record<Tab, Flight[]> = { all: visible, departing: [], enroute: [], arriving: [], ground: [] };
    for (const f of visible) m[phaseOf(f)].push(f);
    return m;
  }, [visible]);

  const list = useMemo(() => {
    let l = byPhase[tab];
    if (dq) l = l.filter((f) => f.callsign.includes(dq) || f.dep === dq || f.arr === dq || f.aircraft === dq);
    const s = [...l];
    if (sort === 'callsign') s.sort((a, b) => a.callsign.localeCompare(b.callsign));
    else if (sort === 'altitude') s.sort((a, b) => (b.altitude ?? 0) - (a.altitude ?? 0));
    else s.sort((a, b) => (b.groundSpeed ?? 0) - (a.groundSpeed ?? 0));
    return s;
  }, [byPhase, tab, sort, dq]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'departing', label: 'Departing' },
    { id: 'enroute', label: 'En route' },
    { id: 'arriving', label: 'Arriving' },
    { id: 'ground', label: 'Ground' },
  ];

  return (
    <Panel side="left" label="Traffic directory" icon={<IconPlane size={18} />} title="Traffic" sub={`${visible.length.toLocaleString('en-US')} aircraft${filtersActive(filters) ? ' · filtered' : ''}`} onClose={() => setPanel(null)}>
      <div className="tabs" role="tablist" aria-label="Flight phase">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => { setTab(t.id); setLimit(PAGE); }}>
            {t.label}
            <span className="tab-n mono">{byPhase[t.id].length}</span>
          </button>
        ))}
      </div>
      <div className="list-tools">
        <input className="input" placeholder="Filter list…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter traffic list" />
        <button className={`icon-btn small ${showFilters || filtersActive(filters) ? 'on' : ''}`} aria-expanded={showFilters} aria-label="Filters" onClick={() => setShowFilters((s) => !s)}>
          <IconFilter size={16} />
        </button>
      </div>
      {showFilters && <FilterControls />}
      <div className="thead">
        <span />
        <button className={sort === 'callsign' ? 'on' : ''} onClick={() => setSort('callsign')}>Flight</button>
        <span>Type</span>
        <button className={sort === 'altitude' ? 'on' : ''} onClick={() => setSort('altitude')}>FL</button>
        <button className={sort === 'speed' ? 'on' : ''} onClick={() => setSort('speed')}>GS</button>
      </div>
      <FeedProblem />
      {list.length === 0 && visible.length > 0 && <Empty title="No aircraft in this view">Try another tab or loosen the filters.</Empty>}
      <ul className="tlist">
        {list.slice(0, limit).map((f) => (
          <Row key={f.key} f={f} selected={f.key === sel} />
        ))}
      </ul>
      {list.length > limit && (
        <button className="btn ghost full" onClick={() => setLimit((l) => l + PAGE)}>
          Show {Math.min(PAGE, list.length - limit)} more of {list.length - limit}
        </button>
      )}
    </Panel>
  );
}
