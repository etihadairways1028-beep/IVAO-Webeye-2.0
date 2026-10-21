// Cloudflare Pages Function: serves /proxy/* on the same origin as the site,
// so the browser never depends on third-party CORS headers.
const ROUTES = {
  ivao: 'https://api.ivao.aero',
  simbrief: 'https://www.simbrief.com',
  awc: 'https://aviationweather.gov',
  rainviewer: 'https://api.rainviewer.com',
  overpass: 'https://overpass-api.de',
};
const CACHE = { ivao: 10, rainviewer: 120, awc: 300, overpass: 86400, simbrief: 0 };

// Optional: set IVAO_API_KEY as an encrypted environment variable in Cloudflare
// (Pages → Settings → Variables and secrets). It is added server-side to IVAO requests only,
// never sent to the browser, and unlocks endpoints such as full session tracks if IVAO
// requires a key for them. The public Whazzup feed works without it.
export async function onRequest({ request, params, env }) {
  const parts = Array.isArray(params.path) ? params.path : [params.path];
  const [svc, ...rest] = parts;
  const base = ROUTES[svc];
  if (!base) return new Response('Unknown service', { status: 404 });
  const url = new URL(request.url);
  const target = `${base}/${rest.join('/')}${url.search}`;
  const init = { method: request.method, headers: { Accept: request.headers.get('Accept') || '*/*', 'User-Agent': 'WebEye/2.1 (+community)' } };
  if (svc === 'ivao' && env && env.IVAO_API_KEY) {
    init.headers.apiKey = env.IVAO_API_KEY;
    init.headers['X-API-Key'] = env.IVAO_API_KEY;
  }
  if (request.method === 'POST') {
    init.body = await request.text();
    init.headers['Content-Type'] = request.headers.get('Content-Type') || 'application/x-www-form-urlencoded';
  } else if (CACHE[svc]) {
    init.cf = { cacheTtl: CACHE[svc], cacheEverything: true };
  }
  const res = await fetch(target, init);
  const headers = new Headers(res.headers);
  headers.delete('set-cookie');
  headers.set('Cache-Control', CACHE[svc] ? `public, max-age=${CACHE[svc]}` : 'no-store');
  return new Response(res.body, { status: res.status, headers });
}
