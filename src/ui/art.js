// Decorative SVG built only from app-controlled values.
import { svg, roman } from './dom.js';
import { ALPHABET } from '../core/codec.js';
import { fromHex } from '../core/bytes.js';

export function astrolabe(cls = 'astrolabe') {
  const ticks = Array.from({ length: 24 }, (_, i) => {
    const a = (i * Math.PI) / 12, r1 = 30, r2 = i % 2 ? 27 : 25;
    return `<line x1="${32 + r1 * Math.cos(a)}" y1="${32 + r1 * Math.sin(a)}" x2="${32 + r2 * Math.cos(a)}" y2="${32 + r2 * Math.sin(a)}" stroke="#C9A646" stroke-width="0.8"/>`;
  }).join('');
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" class="${cls}" aria-hidden="true">
<circle cx="32" cy="32" r="30.5" fill="none" stroke="#C9A646" stroke-width="1.2"/>
<circle cx="32" cy="32" r="22" fill="none" stroke="#C9A646" stroke-width="0.6"/>
<ellipse cx="32" cy="36" rx="17" ry="12" fill="none" stroke="#C9A646" stroke-width="0.5"/>
${ticks}
<path d="M32 7 L34.6 29.4 L57 32 L34.6 34.6 L32 57 L29.4 34.6 L7 32 L29.4 29.4 Z" fill="#C9A646"/>
<circle cx="32" cy="32" r="3.6" fill="#16213A" stroke="#C9A646" stroke-width="1"/>
</svg>`);
}

// Wax seal: a visual fingerprint of the key identifier. Both partners see the
// same seal for the same key, so they can compare at delivery time.
export function seal(padId, label = '', cls = 'seal') {
  const b = fromHex(padId);
  const signs = Array.from(b).map((x) => ALPHABET[x & 31].g);
  const ring = signs.map((g, i) => {
    const a = (i / signs.length) * 2 * Math.PI - Math.PI / 2;
    return `<text x="${50 + 31 * Math.cos(a)}" y="${50 + 31 * Math.sin(a) + 5}" text-anchor="middle" font-size="12" font-family="Signa, Signa2, serif" fill="#E6C27A">${g}︎</text>`;
  }).join('');
  const hue = b[0] % 3;
  const wax = ['#7A1F1A', '#6B1A2E', '#5E2216'][hue];
  const center = roman((b[1] % 12) + 1);
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="${cls}" role="img" aria-label="Seal of key ${padId}">
<path d="M50 3 C60 6 70 2 78 10 C88 16 96 26 96 38 C99 50 94 60 96 70 C90 82 82 90 70 95 C60 99 50 95 40 97 C28 96 18 88 10 80 C4 70 2 60 4 50 C2 38 6 26 14 18 C22 8 36 2 50 3 Z" fill="${wax}"/>
<circle cx="50" cy="50" r="40" fill="none" stroke="#E6C27A" stroke-width="0.8" opacity=".8"/>
<circle cx="50" cy="50" r="22" fill="none" stroke="#E6C27A" stroke-width="0.8" opacity=".8"/>
${ring}
<path d="M50 32 L52.5 47.5 L68 50 L52.5 52.5 L50 68 L47.5 52.5 L32 50 L47.5 47.5 Z" fill="#E6C27A" opacity=".9"/>
<text x="50" y="${label ? 88 : 90}" text-anchor="middle" font-family="Cinzel, serif" font-weight="700" font-size="7" fill="#E6C27A" letter-spacing="1">${center}</text>
</svg>`);
}

export const ICONS = {
  back: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  lock: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
};

export function icon(name) { return svg(ICONS[name]); }
