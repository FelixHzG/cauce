// Hand-built SVG illustrations for the story: "Gota" (the narrator raindrop), peso coins and gouache clouds.
// Pure strings, no external assets.

const DROP = 'M50 4 C60 22 84 46 86 70 C88 92 70 106 50 106 C30 106 12 92 14 70 C16 46 40 22 50 4 Z';

function eyes(kind) {
  switch (kind) {
    case 'happy': return `<path d="M33 66 q5 -6 10 0" class="g-ink" fill="none" stroke-width="3.2" stroke-linecap="round"/><path d="M57 66 q5 -6 10 0" class="g-ink" fill="none" stroke-width="3.2" stroke-linecap="round"/>`;
    case 'worry': return `<ellipse cx="38" cy="67" rx="4.2" ry="5.4" class="g-inkf"/><ellipse cx="62" cy="67" rx="4.2" ry="5.4" class="g-inkf"/><circle cx="39.4" cy="65" r="1.5" fill="#fff"/><circle cx="63.4" cy="65" r="1.5" fill="#fff"/><path d="M31 56 l11 3" class="g-ink" stroke-width="2.6" stroke-linecap="round"/><path d="M69 56 l-11 3" class="g-ink" stroke-width="2.6" stroke-linecap="round"/>`;
    case 'look': return `<ellipse cx="40" cy="66" rx="4.4" ry="5.6" class="g-inkf"/><ellipse cx="62" cy="66" rx="4.4" ry="5.6" class="g-inkf"/><circle cx="42" cy="64" r="1.6" fill="#fff"/><circle cx="64" cy="64" r="1.6" fill="#fff"/>`;
    default: return `<ellipse cx="38" cy="66" rx="4.4" ry="5.8" class="g-inkf"/><ellipse cx="62" cy="66" rx="4.4" ry="5.8" class="g-inkf"/><circle cx="39.6" cy="63.8" r="1.7" fill="#fff"/><circle cx="63.6" cy="63.8" r="1.7" fill="#fff"/>`;
  }
}
function mouth(kind) {
  switch (kind) {
    case 'o': return `<ellipse cx="50" cy="80" rx="4" ry="4.6" class="g-inkf"/><ellipse cx="50" cy="81.5" rx="2.4" ry="2" fill="#e8737a"/>`;
    case 'flat': return `<path d="M44 81 q6 -2 12 0" class="g-ink" fill="none" stroke-width="2.8" stroke-linecap="round"/>`;
    case 'grin': return `<path d="M41 77 q9 10 18 0 z" class="g-inkf"/><path d="M44 80.5 q6 4 12 0" fill="#e8737a"/>`;
    default: return `<path d="M43 78 q7 7 14 0" class="g-ink" fill="none" stroke-width="2.8" stroke-linecap="round"/>`;
  }
}

/** Gota, the narrator. pose: hola | cae | baja | quieta | lupa | piensa | moneda | guiño */
export function gota(pose = 'hola', id = 'g') {
  const P = {
    hola: { e: 'open', m: 'smile', rot: -6, extra: `<path d="M84 64 q12 -10 10 -24" class="g-ink" fill="none" stroke-width="3.2" stroke-linecap="round"/><circle cx="94" cy="38" r="5" class="g-body2"/>` },
    cae: { e: 'happy', m: 'o', rot: 0, extra: `<path d="M30 -2 v14 M50 -12 v12 M70 -2 v14" class="g-speed" stroke-width="3" stroke-linecap="round"/>` },
    baja: { e: 'open', m: 'grin', rot: 28, extra: `<path d="M-8 40 h22 M-14 56 h24 M-6 72 h18" class="g-speed" stroke-width="3" stroke-linecap="round"/>` },
    quieta: { e: 'worry', m: 'flat', rot: 0, sy: 0.8, extra: `<path d="M-6 100 q14 -8 28 0 t28 0 t28 0 t28 0" class="g-wave" fill="none" stroke-width="3.4" stroke-linecap="round"/>` },
    lupa: { e: 'look', m: 'smile', rot: -4, extra: `<circle cx="88" cy="74" r="13" fill="rgba(255,255,255,.55)" class="g-ink" stroke-width="3.6"/><path d="M97 84 l10 11" class="g-ink" stroke-width="5" stroke-linecap="round"/>` },
    piensa: { e: 'look', m: 'flat', rot: 4, extra: `<text x="86" y="30" class="g-q">?</text><text x="100" y="12" class="g-q g-q2">?</text>` },
    moneda: { e: 'happy', m: 'grin', rot: -4, extra: `<g transform="translate(78 56) rotate(12)"><circle r="17" fill="#f0c25a" stroke="#a87424" stroke-width="3"/><circle r="11.5" fill="none" stroke="#c99637" stroke-width="1.6"/><text y="6.5" text-anchor="middle" class="g-coin">$</text></g>` },
    guiño: { e: 'open', m: 'smile', rot: 6, extra: `<path d="M24 94 q-10 6 -18 2" class="g-ink" fill="none" stroke-width="3" stroke-linecap="round"/>` },
  }[pose] || {};
  const sy = P.sy || 1;
  return `<svg class="gota gota-${pose}" viewBox="-20 -16 140 130" aria-hidden="true">
  <defs>
    <radialGradient id="${id}-b" cx="38%" cy="35%" r="75%"><stop offset="0" stop-color="#9fd0f2"/><stop offset=".55" stop-color="#4f93d6"/><stop offset="1" stop-color="#2d5fae"/></radialGradient>
  </defs>
  <g transform="rotate(${P.rot || 0} 50 70) translate(0 ${(1 - sy) * 106}) scale(1 ${sy})">
    <path d="${DROP}" fill="url(#${id}-b)" class="g-outline" stroke-width="3.4" stroke-linejoin="round"/>
    <path d="M36 30 C30 42 24 52 24 62" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="5" stroke-linecap="round"/>
    <circle cx="26" cy="74" r="2.6" fill="rgba(255,255,255,.7)"/>
    ${eyes(P.e)}
    <ellipse cx="29" cy="78" rx="6" ry="3.6" fill="#f08c94" opacity=".55"/><ellipse cx="71" cy="78" rx="6" ry="3.6" fill="#f08c94" opacity=".55"/>
    ${mouth(P.m)}
  </g>
  ${P.extra || ''}
</svg>`;
}

/** A peso coin marker with a rank number. */
export function coin(n) {
  return `<svg class="coin" viewBox="-30 -30 60 60" aria-hidden="true">
  <ellipse cx="0" cy="26" rx="16" ry="4" fill="rgba(40,30,60,.28)" class="coin-shadow"/>
  <circle r="22" fill="#f0c25a" stroke="#8f6020" stroke-width="3.2"/>
  <circle r="16" fill="none" stroke="#c99637" stroke-width="1.8" stroke-dasharray="2.4 2.6"/>
  <path d="M-12 -12 a17 17 0 0 1 14 -6" stroke="#fff6d8" stroke-width="3.6" fill="none" stroke-linecap="round"/>
  <text y="8.5" text-anchor="middle" class="coin-n">${n}</text>
</svg>`;
}

/** A gouache cloud (three lobes, flat underside). */
export function cloud(seed = 0) {
  const w = [0.9, 1.05, 1.15][seed % 3];
  return `<svg class="cloud" viewBox="0 0 ${Math.round(240 * w)} 110" style="width:${Math.round(240 * w)}px" aria-hidden="true">
  <g transform="scale(${w} 1)"><path d="M22 92 C6 92 4 66 24 62 C22 38 52 28 70 44 C78 16 126 10 138 40 C152 24 188 30 188 56 C214 52 232 72 220 92 Z"
    fill="var(--cloud)" stroke="var(--cloud-ink)" stroke-width="3" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  <path d="M40 80 C60 86 110 86 150 82" stroke="var(--cloud-shade)" stroke-width="7" fill="none" stroke-linecap="round" opacity=".7"/></g>
</svg>`;
}

/** Tiny inline icons for legends. */
export const icon = {
  hatch: `<svg viewBox="0 0 22 14" class="sw"><defs><pattern id="hp" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#cfdcf0"/><line x1="0" y1="0" x2="0" y2="5" stroke="#244a9a" stroke-width="2"/></pattern></defs><rect x="1" y="1" width="20" height="12" rx="3" fill="url(#hp)" stroke="#1d3d85" stroke-width="1.6"/></svg>`,
};
