import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The IVAO, SimBrief, NOAA AWC and RainViewer endpoints are proxied in dev and
// preview so the browser never depends on third-party CORS headers.
// In production, serve the same paths from your own reverse proxy (see README).
const proxy = {
  '/proxy/ivao': { target: 'https://api.ivao.aero', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/proxy\/ivao/, '') },
  '/proxy/simbrief': { target: 'https://www.simbrief.com', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/proxy\/simbrief/, '') },
  '/proxy/awc': { target: 'https://aviationweather.gov', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/proxy\/awc/, '') },
  '/proxy/rainviewer': { target: 'https://api.rainviewer.com', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/proxy\/rainviewer/, '') },
  '/proxy/overpass': { target: 'https://overpass-api.de', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/proxy\/overpass/, '') },
};

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  server: { proxy, port: 5173, host: true },
  preview: { proxy, port: 4173, host: true },
  build: {
    chunkSizeWarningLimit: 1500,
    // MapLibre and React change rarely: separate chunks stay cached across app updates.
    rollupOptions: { output: { manualChunks: { maplibre: ['maplibre-gl'], react: ['react', 'react-dom', 'zustand'] } } },
  },
});
