import { useStore } from '../state/store';
import { airlineName } from '../data/airlines';
import { IconLogo } from './Icons';

/** Read ?embed=1&airline=XXX&airport=YYYY&theme=light before the app starts. */
export function readEmbedParams() {
  const q = new URLSearchParams(location.search);
  if (q.get('embed') !== '1') return;
  const airline = (q.get('airline') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || null;
  const airport = (q.get('airport') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || null;
  document.documentElement.dataset.embed = '1';
  const t = q.get('theme');
  const theme = t === 'light' || t === 'dark' ? t : null;
  if (theme) document.documentElement.dataset.theme = theme;
  useStore.setState({ embed: { airport, theme }, airlineFilter: airline });
}

/** Small corner badge on embedded maps, linking to the full site. */
export function EmbedBadge() {
  const embed = useStore((s) => s.embed);
  const airline = useStore((s) => s.airlineFilter);
  const n = useStore((s) => s.flights.length);
  const shown = useStore((s) => (s.airlineFilter ? s.flights.filter((f) => f.callsign.startsWith(s.airlineFilter!)).length : s.embed?.airport ? s.flights.filter((f) => f.dep === s.embed!.airport || f.arr === s.embed!.airport).length : n));
  if (!embed) return null;
  const what = airline ? airlineName(airline) ?? airline : embed.airport ?? 'IVAO';
  const full = `${location.origin}${location.pathname}${airline ? '' : embed.airport ? `#a=${embed.airport}` : ''}`;
  return (
    <a className="embed-badge glass" href={full} target="_blank" rel="noopener noreferrer" title="Open the full live map">
      <IconLogo />
      <span>
        <strong>{what}</strong> · {shown} live
      </span>
      <span className="dim">IVAO Pulse ↗</span>
    </a>
  );
}
