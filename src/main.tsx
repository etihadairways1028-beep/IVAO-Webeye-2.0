import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';
import { initInstall } from './lib/install';

initInstall();
// Apply the panel style before the map is created, so it sizes to the full window at once.
try {
  const p = JSON.parse(localStorage.getItem('webeye2.prefs.v2') ?? '{}') as { glass?: boolean; theme?: string };
  document.documentElement.dataset.glass = p.glass === false ? '0' : '1';
  const light = p.theme === 'light' || (p.theme !== 'dark' && window.matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
} catch {
  document.documentElement.dataset.glass = '1';
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
