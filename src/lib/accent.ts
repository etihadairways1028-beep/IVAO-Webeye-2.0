// Accent colour presets (Settings → Appearance). Each has a dark-mode and a light-mode shade.
export const ACCENTS = {
  blue: { name: 'Blue', dark: '#3b82f6', ink: '#93c5fd', on: '#04122e', light: '#2563eb', lightInk: '#1d4ed8' },
  green: { name: 'Green', dark: '#22c55e', ink: '#86efac', on: '#052e16', light: '#16a34a', lightInk: '#15803d' },
  teal: { name: 'Teal', dark: '#14b8a6', ink: '#7ee8dc', on: '#04201d', light: '#0d9488', lightInk: '#0b7a70' },
  purple: { name: 'Purple', dark: '#a855f7', ink: '#d8b4fe', on: '#1e0533', light: '#9333ea', lightInk: '#7e22ce' },
  orange: { name: 'Orange', dark: '#f97316', ink: '#fdba74', on: '#2a1002', light: '#ea580c', lightInk: '#c2410c' },
  pink: { name: 'Pink', dark: '#ec4899', ink: '#f9a8d4', on: '#33061a', light: '#db2777', lightInk: '#be185d' },
} as const;
export type AccentId = keyof typeof ACCENTS;

/** Applies the accent to the page (CSS variables, browser tab icon, address-bar colour). */
export function applyAccent(id: AccentId, light: boolean) {
  const a = ACCENTS[id] ?? ACCENTS.blue;
  const root = document.documentElement;
  const main = light ? a.light : a.dark;
  root.dataset.accent = id;
  root.style.setProperty('--accent', main);
  root.style.setProperty('--accent-ink', light ? a.lightInk : a.ink);
  root.style.setProperty('--accent-bg', `color-mix(in srgb, ${main} ${light ? 12 : 15}%, transparent)`);
  root.style.setProperty('--on-accent', light ? '#ffffff' : a.on);
  // Browser tab icon in the same colour.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="${main}"/><path d="M16 5l2.2 8.3 8.8 4.2v2.2l-8.8-2.4-.6 6.3 2.9 2.2v1.7L16 26.4l-4.5 1.3v-1.7l2.9-2.2-.6-6.3L5 19.7v-2.2l8.8-4.2z" fill="#fff"/></svg>`;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/svg+xml';
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** The accent's main colour for map drawing. */
export const accentHex = (id: AccentId | undefined, light: boolean) => {
  const a = ACCENTS[id ?? 'blue'] ?? ACCENTS.blue;
  return light ? a.light : a.dark;
};
