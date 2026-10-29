// IVAO events (official), read through the site's IVAO proxy. IVAO doesn't document a public
// events feed, so this is best-effort: any failure simply means "no event data".
import { IVAO_BASE } from './endpoints';

export interface IvaoEvent {
  title: string;
  start: string | null;
  end: string | null;
  airports: string[];
  url: string | null;
  image: string | null;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function parse(raw: unknown): IvaoEvent[] {
  const arr = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown[] }).items) ? (raw as { items: unknown[] }).items : Array.isArray((raw as { data?: unknown[] })?.data) ? (raw as { data: unknown[] }).data : [];
  return arr
    .map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      const title = str(o.title) ?? str(o.name);
      if (!title) return null;
      const aps = (Array.isArray(o.airports) ? o.airports : Array.isArray(o.airport) ? o.airport : typeof o.airports === 'string' ? (o.airports as string).split(/[,\s]+/) : [])
        .map((a) => (typeof a === 'string' ? a : str((a as Record<string, unknown>)?.icao) ?? str((a as Record<string, unknown>)?.code)))
        .filter((a): a is string => !!a && /^[A-Z0-9]{3,4}$/i.test(a))
        .map((a) => a.toUpperCase());
      return {
        title,
        start: str(o.startDate) ?? str(o.start_date) ?? str(o.start) ?? str(o.startTime),
        end: str(o.endDate) ?? str(o.end_date) ?? str(o.end) ?? str(o.endTime),
        airports: [...new Set(aps)].slice(0, 8),
        url: str(o.infoUrl) ?? str(o.url) ?? str(o.link),
        image: str(o.imageUrl) ?? str(o.image) ?? str(o.banner),
      } as IvaoEvent;
    })
    .filter((e): e is IvaoEvent => !!e);
}

let cache: { at: number; events: IvaoEvent[] } | null = null;
export async function fetchEvents(signal?: AbortSignal): Promise<IvaoEvent[]> {
  if (cache && Date.now() - cache.at < 10 * 60e3) return cache.events;
  for (const path of ['/v1/events/latest', '/v2/events']) {
    try {
      const r = await fetch(`${IVAO_BASE}${path}`, { signal, headers: { Accept: 'application/json' } });
      if (!r.ok) continue;
      const events = parse(await r.json());
      if (events.length) {
        cache = { at: Date.now(), events };
        return events;
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
    }
  }
  cache = { at: Date.now(), events: [] };
  return [];
}
