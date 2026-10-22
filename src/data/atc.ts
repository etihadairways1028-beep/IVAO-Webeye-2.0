// ATC clearances through the WebEye recorder (see recorder/src/index.js).
// A controller proves which station they are by putting a one-time code in their ATIS;
// after that they can send a squawk and a taxi route to pilots at their airport.
import { RECORDER_URL } from './endpoints';

export interface TaxiInstr {
  kind: 'runway' | 'stand';
  dest: string;
  via: string[];
  hold?: string;
  airport?: string;
}
export interface Clearance {
  at: number;
  ack: number | null;
  squawk?: string;
  taxi?: TaxiInstr;
  note?: string;
  from: string;
  position: string;
}
export interface SentClearance extends Clearance {
  pilot: string;
}
export interface AtcSession {
  token: string;
  callsign: string;
  position: string;
  frequency?: number | null;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  if (!RECORDER_URL) throw new Error('ATC clearances need the WebEye recorder, which is not set up for this site.');
  let res: Response;
  try {
    res = await fetch(`${RECORDER_URL}${path}`, body === undefined ? { headers: { Accept: 'application/json' } } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('Could not reach the WebEye server. Check your connection and try again.');
  }
  const j = (await res.json().catch(() => null)) as (T & { error?: string; waiting?: boolean }) | null;
  if (!res.ok) {
    const e = new Error(j?.error ?? `Server error ${res.status}`) as Error & { waiting?: boolean; status?: number };
    e.waiting = !!j?.waiting;
    e.status = res.status;
    throw e;
  }
  return j as T;
}

export const atcStart = (callsign: string, vid: number) => call<{ code: string; callsign: string; position: string }>('/atc/start', { callsign, vid });
export const atcVerify = (callsign: string) => call<AtcSession>('/atc/verify', { callsign });
export const atcMe = (token: string) => call<{ callsign: string; position: string; sent: SentClearance[] }>('/atc/me', { token });
export const atcSend = (token: string, pilot: string, c: { squawk?: string; taxi?: TaxiInstr; note?: string }) => call<{ ok: true; at: number }>('/atc/send', { token, pilot, ...c });
export const fetchClearance = (callsign: string, session: number) => call<Clearance | null>(`/clearance/${encodeURIComponent(callsign)}?session=${session}`);
export const ackClearance = (callsign: string, at: number) => call<{ ok: true }>(`/clearance/${encodeURIComponent(callsign)}/ack`, { at });

/** "holding point N1 runway 30R via K B1" — the text form the taxi planner reads. */
export function taxiText(t: TaxiInstr): string {
  const dest = t.kind === 'stand' ? `stand ${t.dest}` : `${t.hold ? `holding point ${t.hold} ` : ''}runway ${t.dest}`;
  return `${dest}${t.via.length ? ` via ${t.via.join(' ')}` : ''}`;
}

/** A free squawk: not in use by any online pilot, avoiding special codes. */
export function freeSquawk(inUse: Set<string>): string {
  const banned = new Set(['7500', '7600', '7700', '7000', '2000', '1200', '1000', '2200']);
  for (let i = 0; i < 500; i++) {
    const n = 2001 + Math.floor(Math.random() * 4700);
    const s = String(n).padStart(4, '0');
    if (/^[0-7]{4}$/.test(s) && !banned.has(s) && !inUse.has(s)) return s;
  }
  return '4521';
}

const KEY = 'webeye2.atc';
export function loadAtcSession(): AtcSession | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as AtcSession | null;
  } catch {
    return null;
  }
}
export function saveAtcSession(s: AtcSession | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: session lasts for this tab only */
  }
}
