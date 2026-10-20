// Optional CORS proxy for static hosting (Cloudflare Workers free tier).
// Deploy, then set the repo variable VITE_PROXY_BASE to the worker URL and re-run the Pages workflow.
const ROUTES = {
  '/ivao': 'https://api.ivao.aero',
  '/simbrief': 'https://www.simbrief.com',
  '/awc': 'https://aviationweather.gov',
  '/rainviewer': 'https://api.rainviewer.com',
  '/overpass': 'https://overpass-api.de',
};
export default {
  async fetch(req) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Accept' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(req.url);
    const prefix = Object.keys(ROUTES).find((p) => url.pathname.startsWith(p + '/'));
    if (!prefix) return new Response('Not found', { status: 404, headers: cors });
    const target = ROUTES[prefix] + url.pathname.slice(prefix.length) + url.search;
    const res = await fetch(target, { method: req.method, body: req.method === 'POST' ? await req.text() : undefined, headers: { 'Content-Type': req.headers.get('Content-Type') || 'application/json', 'User-Agent': 'WebEye2-proxy' }, cf: { cacheTtl: prefix === '/ivao' ? 10 : 60 } });
    const h = new Headers(res.headers);
    Object.entries(cors).forEach(([k, v]) => h.set(k, v));
    return new Response(res.body, { status: res.status, headers: h });
  },
};
