// Hand-made SVG art for "Alcaldía por un día" (tool icons, board pieces, mascot, UI bits).
export const INK = '#3b3355';
const SW = (w = 2.4) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
const S = SW();
const shadow = (cx = 32, cy = 52, rx = 24, ry = 6) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${INK}" opacity=".14"/>`;
const slab = (top, side1, side2) => `
  <path d="M5 34 L32 47.5 L59 34 L59 40 L32 53.5 L5 40Z" fill="${side1}" ${S}/>
  <path d="M32 47.5 L59 34 L59 40 L32 53.5Z" fill="${side2}"/>
  <path d="M5 34 L32 20.5 L59 34 L32 47.5Z" fill="${top}" ${S}/>`;

export const ICONS = {
  colector: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${shadow(30, 53, 26, 6)}
    <g transform="rotate(-18 30 32)">
      <path d="M8 21 h34 v22 h-34 a5 11 0 0 1 0 -22z" fill="#cfc8dc" ${S}/>
      <path d="M8 21 h34 v6 h-36 a5 6 0 0 1 2 -6z" fill="#ebe7f3"/>
      <path d="M18 21.5 v21 M29 21.5 v21" stroke="${INK}" stroke-width="1.6" opacity=".45"/>
      <ellipse cx="42" cy="32" rx="7" ry="11.5" fill="#a9a1bf" ${S}/>
      <ellipse cx="42.6" cy="32.6" rx="4.2" ry="8" fill="#2f8fd0"/>
      <ellipse cx="43.4" cy="35" rx="3" ry="4.6" fill="#6cc7ef"/>
    </g>
    <path d="M47 33 q9 3 8 14" fill="none" stroke="#3aa6e0" stroke-width="5" stroke-linecap="round"/>
    <path d="M47 33 q9 3 8 14" fill="none" stroke="#9fe0fb" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="52" cy="53" r="2.2" fill="#6cc7ef"/><circle cx="58" cy="50" r="1.6" fill="#6cc7ef"/></svg>`,
  vaso: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${shadow(32, 51, 28, 7)}
    ${slab('#a7d98a', '#d1a576', '#b88a5d')}
    <path d="M14 34 L32 25 L50 34 L32 43Z" fill="#2f8fd0"/>
    <path d="M14 34 L32 25 L50 34 L46 34 L32 27.6 L18 34Z" fill="#1f6fa8" opacity=".75"/>
    <path d="M18 35 L32 28.3 L46 35 L32 41.5Z" fill="#5fc0ee"/>
    <path d="M24 35.5 l5 -2.4 M33 38 l6 -2.8" stroke="#d8f4ff" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="11" cy="31" r="2.2" fill="#7cc46a" ${SW(1.4)}/><circle cx="53" cy="31.5" r="2.4" fill="#7cc46a" ${SW(1.4)}/></svg>`,
  jardin: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${shadow(32, 51, 28, 7)}
    ${slab('#b9e29a', '#d1a576', '#b88a5d')}
    <ellipse cx="33" cy="35.5" rx="11" ry="5" fill="#5fc0ee" ${SW(1.6)}/>
    <path d="M28 35.5 l4 -1.6" stroke="#d8f4ff" stroke-width="1.6" stroke-linecap="round"/>
    <g ${SW(1.4)}>
      <path d="M15 33 v-8 M20 37 v-9 M46 31 v-9 M50 36 v-8" fill="none"/>
      <circle cx="15" cy="23.5" r="3.4" fill="#ff9fb2"/><circle cx="20" cy="26.5" r="3" fill="#ffd166"/>
      <circle cx="46" cy="20.5" r="3.4" fill="#ffd166"/><circle cx="50" cy="26.5" r="3" fill="#ff9fb2"/>
    </g>
    <path d="M24 29 q3 -6 7 -3 q-3 2 -7 3z M40 28 q3 -5 6 -2 q-3 2 -6 2z" fill="#6fbf5f" ${SW(1.2)}/></svg>`,
  pozos: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${shadow(32, 51, 28, 7)}
    ${slab('#b9e29a', '#d1a576', '#b88a5d')}
    <g>
      <path d="M15 24 v8 a7 3.5 0 0 0 14 0 v-8" fill="#bdb6cc" ${S}/>
      <ellipse cx="22" cy="24" rx="7" ry="3.5" fill="#e6e2ee" ${S}/>
      <ellipse cx="22" cy="24.3" rx="4.3" ry="2" fill="#2f8fd0"/>
      <path d="M35 28 v8 a7 3.5 0 0 0 14 0 v-8" fill="#bdb6cc" ${S}/>
      <ellipse cx="42" cy="28" rx="7" ry="3.5" fill="#e6e2ee" ${S}/>
      <ellipse cx="42" cy="28.3" rx="4.3" ry="2" fill="#2f8fd0"/>
    </g>
    <path d="M22 41 v8 m-3 -3 l3 3 l3 -3 M42 44 v7 m-3 -3 l3 3 l3 -3" fill="none" stroke="#2f8fd0" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  reubicar: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${shadow(36, 53, 24, 6)}
    <path d="M14 52 q16 -26 44 -4 q-20 8 -44 4z" fill="#a7d98a" ${S}/>
    <g>
      <path d="M30 26 L42 20 L54 26 L54 38 L42 44 L30 38Z" fill="#fff1dc" ${S}/>
      <path d="M42 32 L54 26 L54 38 L42 44Z" fill="#f1d5ae"/>
      <path d="M42 32 L54 26 L54 38 L42 44Z" fill="none" ${S}/>
      <path d="M28 27 L37 15 L47 10 L56 26 L42 33Z" fill="#ff8a6b" ${S}/>
      <path d="M37 15 L42 33" fill="none" ${SW(1.6)}/>
      <rect x="45.5" y="33" width="4" height="6.5" rx="1" fill="#8a6a9d" transform="skewY(-26)" style="transform-origin:47px 36px"/>
    </g>
    <path d="M9 44 q2 -14 14 -16" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
    <path d="M9 44 q2 -14 14 -16" fill="none" stroke="#ffd166" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M18 24 l6 4 l-6 4" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

export const GOTA = `<svg viewBox="0 0 84 100" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="42" cy="94" rx="24" ry="5" fill="${INK}" opacity=".14"/>
  <path d="M42 5 C42 5 12 42 12 62 a30 30 0 0 0 60 0 C72 42 42 5 42 5z" fill="#7fd3f7" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/>
  <path d="M42 5 C42 5 12 42 12 62 a30 30 0 0 0 9 21 C14 60 28 34 42 5z" fill="#a8e4fb" opacity=".8"/>
  <ellipse cx="27" cy="50" rx="4.5" ry="9" fill="#fff" opacity=".85" transform="rotate(24 27 50)"/>
  <ellipse cx="31" cy="66" rx="4.2" ry="5.2" fill="${INK}"/><ellipse cx="53" cy="66" rx="4.2" ry="5.2" fill="${INK}"/>
  <circle cx="32.4" cy="64" r="1.6" fill="#fff"/><circle cx="54.4" cy="64" r="1.6" fill="#fff"/>
  <ellipse cx="23" cy="74" rx="5" ry="3" fill="#ff9fb2" opacity=".8"/><ellipse cx="61" cy="74" rx="5" ry="3" fill="#ff9fb2" opacity=".8"/>
  <path d="M37 75 q5 5 10 0" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M22 30 q20 -16 40 0 l2 6 h-44z" fill="#ffd166" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>
  <path d="M38 17 h8 v13 h-8z" fill="#ffe29a" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M16 36 h52" stroke="${INK}" stroke-width="3" stroke-linecap="round"/></svg>`;

export const COIN = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><ellipse cx="16" cy="18" rx="12" ry="12" fill="#e2a93b" stroke="${INK}" stroke-width="2.2"/><ellipse cx="16" cy="15" rx="12" ry="12" fill="#ffd166" stroke="${INK}" stroke-width="2.2"/><ellipse cx="16" cy="15" rx="8" ry="8" fill="none" stroke="#e2a93b" stroke-width="1.6"/><text x="16" y="20" text-anchor="middle" font-family="Fredoka, sans-serif" font-weight="700" font-size="13" fill="#9c6b10">$</text></svg>`;

export const HAND = `<svg viewBox="0 0 48 52" xmlns="http://www.w3.org/2000/svg"><path d="M14 4 c3 0 5 2 5 5 v14 c1-2 7-2 8 1 c1-2 7-2 8 1 c2-1 7 0 7 4 v9 c0 9-6 13-14 13 h-4 c-6 0-9-3-12-8 l-7-12 c-2-3 1-6 4-4 l4 4 v-22 c0-3 2-5 5-5z" fill="#fff" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M27 24 v8 M35 25 v7" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/></svg>`;

export const STAR = (on) => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2.5l2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.1l-5.8 3.2 1.2-6.5L2.6 9.3l6.5-.8z" fill="${on ? '#ffd166' : '#ece6f5'}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

export const COMPASS = `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="20" fill="#fff8ee" stroke="${INK}" stroke-width="2.4"/><path d="M24 8 l5 16 h-10z" fill="#ff8a6b" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><path d="M24 40 l5 -16 h-10z" fill="#d9d2e8" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><text x="24" y="7" text-anchor="middle" font-family="Fredoka, sans-serif" font-weight="700" font-size="0"></text></svg>`;

export function svgImage(svg, w, h) {
  return new Promise(res => {
    const img = new Image(); img.width = w; img.height = h;
    img.onload = () => res(img); img.onerror = () => res(img);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace('<svg ', `<svg width="${w}" height="${h}" `));
  });
}
