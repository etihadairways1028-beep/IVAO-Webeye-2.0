// Where the browser fetches each data source.
//
// • `npm run dev` / `npm run preview`: same-origin /proxy/* paths, forwarded by Vite
//   (no CORS concerns).
// • Static hosting (GitHub Pages build sets VITE_DIRECT=1): call the providers directly.
//   If a provider blocks cross-origin requests, deploy `proxy/cloudflare-worker.js` and set
//   VITE_PROXY_BASE to its URL — every request is then routed through it.
const env = import.meta.env;
const direct = env.VITE_DIRECT === '1';
const proxyBase = (env.VITE_PROXY_BASE ?? '').replace(/\/+$/, '');

function pick(proxyPath: string, directUrl: string, override?: string): string {
  if (override) return override;
  if (proxyBase) return `${proxyBase}${proxyPath.replace(/^\/proxy/, '')}`;
  return direct ? directUrl : proxyPath;
}

export const IVAO_BASE = pick('/proxy/ivao', 'https://api.ivao.aero', env.VITE_IVAO_BASE);
export const WHAZZUP_URL = env.VITE_WHAZZUP_URL || `${IVAO_BASE}/v2/tracker/whazzup`;
export const SIMBRIEF_URL = pick('/proxy/simbrief/api/xml.fetcher.php', 'https://www.simbrief.com/api/xml.fetcher.php', env.VITE_SIMBRIEF_URL);
export const AWC_URL = pick('/proxy/awc/api/data', 'https://aviationweather.gov/api/data', env.VITE_AWC_URL);
export const RAINVIEWER_URL = pick('/proxy/rainviewer/public/weather-maps.json', 'https://api.rainviewer.com/public/weather-maps.json', env.VITE_RAINVIEWER_URL);
/** Optional WebEye track recorder (see recorder/README.md): full tracks from pushback for every flight. */
export const RECORDER_URL = (env.VITE_RECORDER_URL || 'https://webeye-recorder.etihadairways1028.workers.dev').replace(/\/+$/, '');
export const OVERPASS_URL = pick('/proxy/overpass/api/interpreter', 'https://overpass-api.de/api/interpreter', env.VITE_OVERPASS_URL);

/** Human-readable hint appended to network errors in static deployments. */
export const CORS_HINT = direct && !proxyBase ? ' — if this persists the provider may block cross-origin requests; see README “Proxy”.' : '';
