export const dash = '—';

export function fmtAlt(ft: number | null | undefined, transition = 18000): string {
  if (ft == null || Number.isNaN(ft)) return dash;
  if (ft >= transition) return `FL${String(Math.round(ft / 100)).padStart(3, '0')}`;
  return `${Math.round(ft / 10) * 10 >= 1000 ? Math.round(ft).toLocaleString('en-US') : Math.round(ft)} ft`;
}

export function fmtAltShort(ft: number | null | undefined): string {
  if (ft == null) return '';
  return String(Math.max(0, Math.round(ft / 100))).padStart(3, '0');
}

export const fmtKt = (v: number | null | undefined) => (v == null ? dash : `${Math.round(v)} kt`);
export const fmtHdg = (v: number | null | undefined) => (v == null ? dash : `${String(Math.round(v) % 360).padStart(3, '0')}°`);
export const fmtNm = (v: number | null | undefined) => (v == null ? dash : `${Math.round(v).toLocaleString('en-US')} nm`);

export function fmtVs(v: number | null | undefined): string {
  if (v == null) return dash;
  const r = Math.round(v / 50) * 50;
  if (Math.abs(r) < 100) return 'level';
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toLocaleString('en-US')} fpm`;
}

export function fmtCoord(v: number, pos: string, neg: string): string {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const m = (a - d) * 60;
  return `${v >= 0 ? pos : neg}${String(d).padStart(pos === 'N' ? 2 : 3, '0')}°${m.toFixed(2).padStart(5, '0')}′`;
}
export const fmtLat = (v: number) => fmtCoord(v, 'N', 'S');
export const fmtLon = (v: number) => fmtCoord(v, 'E', 'W');

export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || sec < 0 || Number.isNaN(sec)) return dash;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function fmtZulu(d: Date | string | number | null | undefined, seconds = false): string {
  if (d == null) return dash;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return dash;
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return seconds ? `${hh}:${mm}:${ss}Z` : `${hh}${mm}Z`;
}

export function ago(iso: string | number | Date | null | undefined, now = Date.now()): string {
  if (iso == null) return dash;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return dash;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
}

export const fmtFreq = (f: number | null | undefined) => (f == null ? dash : f.toFixed(3));

export const WAKE_LABEL: Record<string, string> = { L: 'Light', M: 'Medium', H: 'Heavy', J: 'Super', '?': 'Unknown' };

export const RULES_LABEL: Record<string, string> = { I: 'IFR', V: 'VFR', Y: 'IFR → VFR', Z: 'VFR → IFR' };
