# IVAO WebEye 2.0

A next-generation, map-first traffic viewer for the IVAO network — live pilots and ATC,
airport explorer, radar mode, SimBrief import and "track my VID".

React 18 · TypeScript · Vite · MapLibre GL JS · Zustand

## Run it

```bash
npm install
npm run dev        # http://localhost:5173  (live IVAO data through the built-in proxy)
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ with the same proxy on http://localhost:4173
```

No API keys are required.

## Data sources

| What | Source | Notes |
|---|---|---|
| Pilots, ATC, network counts | IVAO Whazzup v2 `GET https://api.ivao.aero/v2/tracker/whazzup` | Public, unauthenticated. IVAO refreshes it every 15 s; the app never polls faster, pauses when the tab is hidden and backs off on errors. |
| Flight plans (OFP) | SimBrief `api/xml.fetcher.php?username=…&json=1` | Username or numeric pilot ID. |
| METAR / TAF | NOAA Aviation Weather Center Data API | Real-world weather; IVAO sessions may differ. |
| Weather radar | RainViewer Weather Maps API | Free tier tiles are limited to zoom ≤ 7. |
| Airports & runways | OurAirports (public domain), bundled in `public/data` | Rebuild with `npm run build:data <dir>` after downloading `airports.csv` + `runways.csv`. |
| FIR boundaries | [VATSpy Data Project](https://github.com/vatsimnetwork/vatspy-data-project), CC BY-SA 4.0, simplified in `public/data/firs*.json` | Those two files remain under CC BY-SA 4.0. |
| Coastlines / borders | Natural Earth 1:50m (public domain), bundled | Powers Radar mode and the offline fallback basemap. |
| Basemaps | CARTO Dark Matter / Voyager, Esri World Imagery | Attribution shown on-map. CARTO basemaps are free for non-commercial use; check CARTO/Esri terms before commercial deployment. |

## Free domain: Cloudflare Pages (recommended)

Cloudflare Pages gives a free `<name>.pages.dev` address and runs `functions/proxy/[[path]].js`,
so IVAO, SimBrief, weather and OpenStreetMap requests go through your own domain (no CORS issues).

1. Sign in at https://dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git**.
2. Pick this repository. Project name = your subdomain (e.g. `webeye-live` → `webeye-live.pages.dev`).
3. Framework preset **None**, build command `npm run build`, output directory `dist`. Save and deploy.

No environment variables are needed: the app uses the built-in `/proxy/*` routes there.

## Deploy to GitHub Pages

1. Push to `main`. 2. In the repo: **Settings → Pages → Source: GitHub Actions**.
The workflow builds with `BASE_PATH=/<repo>/` and `VITE_DIRECT=1` (browser calls the providers directly)
and publishes to `https://<user>.github.io/<repo>/`.

If a provider blocks cross-origin requests from the Pages site, deploy `proxy/cloudflare-worker.js`
(Cloudflare Workers free tier), add a repository variable `VITE_PROXY_BASE` = the worker URL
(Settings → Secrets and variables → Actions → Variables) and re-run the workflow.

## New in 2.1

- **FIR boundaries**: airspace lines on the map; when a centre (CTR/FSS) is online its sector fills amber and the station badge sits inside it. Toggle under Map → FIR boundaries.
- **Shareable links**: the address bar follows what you select (`#f=BAW123`, `#c=EGTT_CTR`, `#a=EGLL`). The Share button copies it, or opens the phone share sheet.
- **3D globe**: the 3D button (or G) switches between the flat chart and a globe with atmosphere; everything else works the same on both.
- **Install as an app**: manifest + service worker. Chrome/Edge/Android show an Install button; on iPhone use Share → Add to Home Screen. Only the app shell and bundled data are cached; live data is never served from cache.

- **SimBrief navlog**: every waypoint with airway, altitude, distance, ETE, ETA and fuel; passed waypoints dim,
  the next one is highlighted, ETAs switch to live estimates once your callsign is online; full OFP summary
  (times, fuel, weights, step climbs, OFP PDF link).
- **Route from the gate**: the selected aircraft's full IVAO session track
  (`/v2/tracker/sessions/{id}/tracks`) is drawn in pink, the SimBrief plan in purple and the remaining route dotted.
- **Airport ground charts**: taxiways with names, runways, aprons, terminals, stands and gates from
  OpenStreetMap (Overpass API), shown from zoom 11.5 when an airport is selected or your aircraft is near one.
- **Telemetry strip** with destination ETE/ETA/distance.
- **Performance**: map updates pause while panning/zooming or when the tab is hidden, symbol fades off,
  hover hit-testing throttled to one per frame, device-pixel-ratio capped at 2.

### Proxy / CORS

The browser calls same-origin paths (`/proxy/ivao`, `/proxy/simbrief`, `/proxy/awc`, `/proxy/rainviewer`).
`vite dev` and `vite preview` forward them (see `vite.config.ts`). For a static deployment, either add
the same four reverse-proxy rules to your web server (nginx/Cloudflare/Netlify redirects) or point the
`VITE_*` variables in `.env` at endpoints that send CORS headers (see `.env.example`).

## Honesty rules built into the UI

- Counts in the top bar come straight from Whazzup `connections`; nothing is hard-coded.
- **Demo mode** (Settings → Data source) generates synthetic flights between real airports. Every demo record is
  tagged DEMO, the status pill turns amber, a banner stays visible, and switching source clears all records — live and
  demo traffic are never mixed. When the live feed is unreachable the app says so and offers demo mode; it never switches silently.
- Values the feed does not provide are labelled: vertical speed is *derived* from consecutive reports, estimated arrival
  is *calculated* at current groundspeed, ATC rings are *indicative*, the trail is what *this browser observed* since opening.
- Plotted routes: a SimBrief navlog when loaded; otherwise a dashed great-circle reference (the filed route string is shown as text).
- Aircraft positions are dead-reckoned between 15 s updates for smooth motion; panels always show the reported values.

## Keyboard

`/` search · `Esc` close · `F` follow · `C` centre · `W` world · `R` radar · `L` labels · `M` layers ·
`T` traffic · `A` airports · `S` ATC · `P` my flight · `Shift+F` fullscreen · `?` help

## Structure

```
src/
  data/      ivao.ts (fetch + normalise), feed.ts (polling, back-off, trails), demo.ts, simbrief.ts, weather.ts, airports.ts
  map/       controller.ts (MapLibre layers, interpolation, events), FlightMap.tsx, icons.ts (SDF aircraft), styles.ts
  components/TopNavigation, FlightSearch, TrafficDirectory, AirportExplorer, ATCStations, AircraftDetailsPanel,
             MyFlight, MapLayerControls, SettingsPanel, MapControls, ui.tsx, Icons.tsx
  state/     store.ts (Zustand; persisted preferences)
```

Aircraft are rendered as one GeoJSON symbol layer (SDF icons rotated by heading), so hundreds of aircraft update
without React re-renders. For flight simulation only — not for real-world navigation or ATC.
