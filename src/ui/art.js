// Decorative SVG built only from app-controlled values.
import { svg, roman } from './dom.js';
import { ALPHABET } from '../core/codec.js';
import { fromHex } from '../core/bytes.js';

export function astrolabe(cls = 'astrolabe') {
  const C = 100, P = (r, deg) => { const a = (deg - 90) * Math.PI / 180; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
  const f = (n) => n.toFixed(2);
  // limb: degree ticks
  let ticks = '';
  for (let d = 0; d < 360; d += 5) {
    const [x1, y1] = P(96, d), [x2, y2] = P(d % 30 === 0 ? 86 : d % 15 === 0 ? 89 : 91, d);
    ticks += `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="#6B4C10" stroke-width="${d % 30 === 0 ? 1.1 : .5}"/>`;
  }
  // rete: zodiac band with the twelve signs (turns slowly)
  let band = '';
  ALPHABET.slice(7, 19).forEach((a, i) => {
    const [x, y] = P(73, i * 30 + 15), [lx1, ly1] = P(64, i * 30), [lx2, ly2] = P(82, i * 30);
    band += `<line x1="${f(lx1)}" y1="${f(ly1)}" x2="${f(lx2)}" y2="${f(ly2)}" stroke="#A9822A" stroke-width=".7"/>`;
    band += `<text x="${f(x)}" y="${f(y + 4.5)}" text-anchor="middle" font-size="13" font-family="Signa, Signa2, serif" fill="#8E2318" transform="rotate(${i * 30 + 15} ${f(x)} ${f(y)})">${a.g}\uFE0E</text>`;
  });
  // stars of the rete, with pointers
  const starAt = [[52, 20], [44, 75], [56, 130], [40, 200], [50, 250], [34, 305], [26, 160]];
  let stars = '';
  for (const [r, d] of starAt) {
    const [x, y] = P(r, d), [px, py] = P(r + 7, d);
    stars += `<path d="M${f(x)} ${f(y)} Q${f((x + px) / 2 + 2)} ${f((y + py) / 2 - 2)} ${f(px)} ${f(py)}" stroke="#A9822A" stroke-width=".8" fill="none"/>`;
    stars += `<path class="stella" d="M${f(px)} ${f(py - 3.4)} L${f(px + .9)} ${f(py - .9)} L${f(px + 3.4)} ${f(py)} L${f(px + .9)} ${f(py + .9)} L${f(px)} ${f(py + 3.4)} L${f(px - .9)} ${f(py + .9)} L${f(px - 3.4)} ${f(py)} L${f(px - .9)} ${f(py - .9)} Z" fill="#C9A646"/>`;
  }
  // tympan: almucantars and horizon
  let tymp = '';
  for (let k = 0; k < 6; k++) tymp += `<ellipse cx="100" cy="${f(108 - k * 4)}" rx="${f(54 - k * 8)}" ry="${f(40 - k * 6.5)}" fill="none" stroke="#6B4C10" stroke-width=".35" opacity=".7"/>`;
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -18 200 218" class="${cls}" aria-hidden="true">
<defs>
<radialGradient id="aur" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#F3DE9C"/><stop offset=".55" stop-color="#C9A646"/><stop offset="1" stop-color="#8A6418"/></radialGradient>
<radialGradient id="mater" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#F6ECCF" stop-opacity=".9"/><stop offset="1" stop-color="#D9C38E" stop-opacity=".9"/></radialGradient>
</defs>
<circle cx="100" cy="-6" r="9" fill="none" stroke="url(#aur)" stroke-width="3"/>
<path d="M88 6 Q100 -4 112 6 L108 12 Q100 6 92 12 Z" fill="url(#aur)" stroke="#6B4C10" stroke-width=".6"/>
<circle cx="100" cy="100" r="98" fill="url(#aur)" stroke="#5A3E0C" stroke-width="1"/>
<circle cx="100" cy="100" r="92" fill="url(#mater)" stroke="#6B4C10" stroke-width=".8"/>
${ticks}
<circle cx="100" cy="100" r="84" fill="none" stroke="#6B4C10" stroke-width=".6"/>
${tymp}
<line x1="44" y1="112" x2="156" y2="112" stroke="#6B4C10" stroke-width=".5"/>
<g class="rete">
<circle cx="100" cy="100" r="82" fill="none" stroke="#A9822A" stroke-width="1.6"/>
<circle cx="100" cy="100" r="64" fill="none" stroke="#A9822A" stroke-width="1.2"/>
${band}
${stars}
<circle cx="100" cy="100" r="30" fill="none" stroke="#A9822A" stroke-width="1"/>
<path d="M100 36 L100 164 M36 100 L164 100" stroke="#A9822A" stroke-width=".6" opacity=".7"/>
</g>
<g transform="rotate(32 100 100)">
<path d="M100 10 L104 100 L100 190 L96 100 Z" fill="url(#aur)" stroke="#5A3E0C" stroke-width=".6"/>
</g>
<circle cx="100" cy="100" r="13" fill="url(#aur)" stroke="#5A3E0C" stroke-width=".8"/>
<g stroke="#8E2318" stroke-width="1.2">${Array.from({ length: 12 }, (_, i) => { const [x1, y1] = P(13, i * 30), [x2, y2] = P(19, i * 30); return `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`; }).join('')}</g>
<circle cx="100" cy="100" r="6" fill="#8E2318"/>
<circle cx="100" cy="100" r="2" fill="#F3DE9C"/>
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
