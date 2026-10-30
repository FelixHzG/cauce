// cauce. nav-mochi — DOM bits: sticker icons, Gotita mascot, maneuver arrows, Spanish instructions.
export const INK = '#5b3a63';

// ------------------------------------------------------------------ stickers (die-cut look via CSS)
const S = {
  ponding: { bg: '#8fd0ff', label: 'Encharcamiento reportado', short: 'Encharcamiento',
    art: `<path d="M32 13c0 0-11 13-11 21a11 11 0 0 0 22 0c0-8-11-21-11-21z" fill="#fff"/><circle cx="28" cy="35" r="1.9" fill="${INK}"/><circle cx="36" cy="35" r="1.9" fill="${INK}"/><path d="M29.5 39.5q2.5 2 5 0" stroke="${INK}" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M14 50q4.5-3.5 9 0t9 0 9 0 9 0" stroke="#fff" stroke-width="3.2" fill="none" stroke-linecap="round"/>` },
  critical: { bg: '#ff86ab', label: 'Zona crítica IMEPLAN', short: 'Zona crítica',
    art: `<path d="M32 12l19 33a4 4 0 0 1-3.5 6h-31a4 4 0 0 1-3.5-6z" fill="#fff" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><rect x="29.4" y="24" width="5.2" height="15" rx="2.6" fill="#ff5c8d"/><circle cx="32" cy="45" r="3" fill="#ff5c8d"/>` },
  underpass: { bg: '#b49cff', label: 'Paso a desnivel inundable', short: 'Paso a desnivel',
    art: `<path d="M10 22h44v7H48c-3 0-5 2-5 5v4H21v-4c0-3-2-5-5-5h-6z" fill="#fff"/><rect x="10" y="17" width="44" height="5" rx="2.5" fill="#fff"/><path d="M12 45q5-4 10 0t10 0 10 0 10 0" stroke="#fff" stroke-width="3.4" fill="none" stroke-linecap="round"/><path d="M14 52q4.5-3.5 9 0t9 0 9 0 9 0" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".8"/>` },
  modeled: { bg: '#c7a8ff', label: 'Agua modelada (exploratorio)', short: 'Modelo',
    art: `<path d="M20 40a8 8 0 0 1 1-16 11 11 0 0 1 21-2 8 8 0 0 1 3 18z" fill="#fff"/><path d="M24 46l-2 5M32 46l-2 5M40 46l-2 5" stroke="#fff" stroke-width="3" stroke-linecap="round"/>` },
  start: { bg: '#ff9fc6', label: 'Origen', short: 'Origen',
    art: `<path d="M32 14l4.6 9.6 10.4 1.4-7.6 7.2 1.9 10.3L32 37.6l-9.3 4.9 1.9-10.3-7.6-7.2 10.4-1.4z" fill="#fff" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>` },
  end: { bg: '#5fd6b4', label: 'Destino', short: 'Destino',
    art: `<path d="M30 14c2-2 4-2 4 0v12l14 8v4l-14-4v9l4 3v3l-6-2-6 2v-3l4-3v-9l-14 4v-4l14-8z" fill="#fff"/>` }
};
export const STK = S;
export function stickerSVG(type, size = 52) {
  const s = S[type] || S.ponding;
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true"><circle cx="32" cy="32" r="29" fill="${s.bg}" stroke="#fff" stroke-width="5"/><circle cx="32" cy="32" r="31.2" fill="none" stroke="${INK}" stroke-opacity=".18" stroke-width="1.2"/><g>${s.art}</g><ellipse cx="22" cy="17" rx="7" ry="3.4" fill="#fff" opacity=".45" transform="rotate(-28 22 17)"/></svg>`;
}
export const badgeSVG = kind => kind === 'ok'
  ? `<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="10.5" fill="#33c9a1" stroke="#fff" stroke-width="2.5"/><path d="M7 12.4l3.2 3.1L17 8.8" stroke="#fff" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  : `<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="10.5" fill="#ffc542" stroke="#fff" stroke-width="2.5"/><rect x="10.6" y="6" width="2.8" height="8" rx="1.4" fill="#fff"/><circle cx="12" cy="17.2" r="1.7" fill="#fff"/></svg>`;

// ------------------------------------------------------------------ Gotita (2D mascot)
export function gotitaSVG() {
  return `<svg viewBox="0 0 120 140" class="gotita" aria-hidden="true">
  <defs><linearGradient id="gtg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9ecff"/><stop offset="1" stop-color="#62b4ff"/></linearGradient></defs>
  <ellipse cx="60" cy="133" rx="32" ry="5.5" fill="#9c74c4" opacity=".22"/>
  <g class="g-body">
    <path d="M60 8C60 8 17 58 17 89a43 43 0 0 0 86 0C103 58 60 8 60 8z" fill="url(#gtg)" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>
    <path d="M37 74q3-15 15-25" stroke="#fff" stroke-width="7" stroke-linecap="round" fill="none" opacity=".85"/>
    <circle cx="34" cy="85" r="3.2" fill="#fff" opacity=".85"/>
    <path d="M60 8l-5 -6M60 8l6 -5" stroke="${INK}" stroke-width="0" />
    <g class="g-pin"><circle cx="78" cy="40" r="7" fill="#ffd25e" stroke="${INK}" stroke-width="3"/><circle cx="78" cy="40" r="2.4" fill="#fff6d0"/></g>
    <ellipse cx="38" cy="103" rx="8" ry="4.6" fill="#ff8fb6" opacity=".75"/><ellipse cx="82" cy="103" rx="8" ry="4.6" fill="#ff8fb6" opacity=".75"/>
    <g class="e-open"><ellipse cx="46" cy="92" rx="6.8" ry="9" fill="#3a2440"/><ellipse cx="74" cy="92" rx="6.8" ry="9" fill="#3a2440"/><circle cx="43.6" cy="88.4" r="2.8" fill="#fff"/><circle cx="71.6" cy="88.4" r="2.8" fill="#fff"/><circle cx="48.4" cy="96" r="1.3" fill="#fff"/><circle cx="76.4" cy="96" r="1.3" fill="#fff"/></g>
    <g class="e-happy" fill="none" stroke="#3a2440" stroke-width="4.2" stroke-linecap="round"><path d="M39 94q7-9 14 0"/><path d="M67 94q7-9 14 0"/></g>
    <g class="e-worry" fill="none" stroke="#3a2440" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M40 86l10 6-10 6"/><path d="M80 86l-10 6 10 6"/></g>
    <path class="m-smile" d="M54 104q6 6 12 0" stroke="#3a2440" stroke-width="3.6" fill="none" stroke-linecap="round"/>
    <path class="m-open" d="M53 103q7 11 14 0z" fill="#ff6f8f" stroke="#3a2440" stroke-width="3" stroke-linejoin="round"/>
    <path class="m-wobble" d="M52 106q4-4 8 0t8 0" stroke="#3a2440" stroke-width="3.4" fill="none" stroke-linecap="round"/>
    <path class="sweat" d="M95 64c0 0-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z" fill="#bfe9ff" stroke="${INK}" stroke-width="2.6"/>
    <g class="spark" fill="#ffd25e" stroke="${INK}" stroke-width="2"><path d="M100 30l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/><path d="M16 46l2 4.5 4.5 2-4.5 2-2 4.5-2-4.5-4.5-2 4.5-2z"/></g>
  </g></svg>`;
}

// ------------------------------------------------------------------ maneuvers
const TYPES = ['exit roundabout', 'exit rotary', 'roundabout turn', 'new name', 'end of road', 'on ramp', 'off ramp', 'use lane', 'depart', 'arrive', 'merge', 'fork', 'continue', 'roundabout', 'rotary', 'notification', 'turn'];
const MODS = ['sharp right', 'sharp left', 'slight right', 'slight left', 'uturn', 'right', 'left', 'straight'];
const DIR = { 'sharp right': 'cerrado a la derecha', 'sharp left': 'cerrado a la izquierda', 'slight right': 'ligeramente a la derecha', 'slight left': 'ligeramente a la izquierda', uturn: 'en U', right: 'a la derecha', left: 'a la izquierda', straight: 'derecho' };
const ORD = n => n ? n + '.ª ' : '';
export function parseStep(step) {
  if (step.type && !/^[a-z]/.test(step.instruction || '')) {   // cauce router: Spanish instruction + OSRM-style type/modifier
    const t = step.type, m = step.modifier || '', d = DIR[m] || '';
    const text = t === 'depart' ? 'Arrancamos' : t === 'arrive' ? 'Llegas a tu destino' : t === 'roundabout' ? `En la glorieta, toma la ${ORD(step.exit)}salida` : t === 'exit roundabout' ? 'Sal de la glorieta'
      : t === 'turn' ? `Gira ${d}`.trim() : t === 'uturn' ? 'Da vuelta en U' : t === 'merge' ? 'Incorpórate' : t === 'on ramp' ? `Toma la rampa ${d}`.trim() : t === 'off ramp' ? `Toma la salida ${d}`.trim()
      : (m && m !== 'straight' ? `Continúa ${d}` : 'Sigue derecho');
    const icon = t === 'arrive' ? 'arrive' : /roundabout/.test(t) ? 'round' : t === 'uturn' ? 'uturn' : (m || 'straight');
    return { text, street: step.name || '', mod: icon, type: t, full: step.instruction };
  }
  let s = (step.instruction || '').trim(), type = '', mod = '';
  for (const t of TYPES) if (s.toLowerCase().startsWith(t + ' ') || s.toLowerCase() === t) { type = t; s = s.slice(t.length).trim(); break; }
  for (const m of MODS) if (s.toLowerCase().startsWith(m + ' ') || s.toLowerCase() === m) { mod = m; s = s.slice(m.length).trim(); break; }
  if (!type) return { text: step.instruction || 'Sigue', street: '', mod: 'straight', type: 'raw' };
  const d = DIR[mod] || '';
  const text = {
    turn: `Gira ${d}`, 'new name': 'Sigue derecho', continue: mod && mod !== 'straight' ? `Continúa ${d}` : 'Sigue derecho', depart: 'Arrancamos', arrive: 'Llegas a tu destino',
    merge: `Incorpórate ${d}`.trim(), 'on ramp': `Toma la rampa ${d}`.trim(), 'off ramp': `Toma la salida ${d}`.trim(), fork: `Mantente ${d}`.trim(),
    'end of road': `Al final, gira ${d}`.trim(), roundabout: 'En la glorieta, toma la salida', rotary: 'En la glorieta, toma la salida', 'roundabout turn': `En la glorieta, ${d}`,
    'exit roundabout': 'Sal de la glorieta', 'exit rotary': 'Sal de la glorieta', notification: 'Sigue', 'use lane': 'Usa el carril indicado'
  }[type] || 'Sigue';
  const icon = type === 'arrive' ? 'arrive' : /roundabout|rotary/.test(type) ? 'round' : (mod || 'straight');
  return { text, street: s, mod: icon, type };
}
export function arrowSVG(kind) {
  const P = {
    straight: 'M24 40V12M14 21l10-10 10 10', right: 'M16 40V26c0-5 3-8 8-8h12M30 11l8 7-8 7', left: 'M32 40V26c0-5-3-8-8-8H12M18 11l-8 7 8 7',
    'slight right': 'M18 40V28c0-6 4-10 9-13l7-4M26 9l9 1-3 9', 'slight left': 'M30 40V28c0-6-4-10-9-13l-7-4M22 9l-9 1 3 9',
    'sharp right': 'M16 10v18c0 6 4 9 9 9h10M38 30l-3 9-9-3', 'sharp left': 'M32 10v18c0 6-4 9-9 9H13M10 30l3 9 9-3',
    uturn: 'M32 40V20a8 8 0 0 0-16 0v14M10 28l6 7 6-7', round: 'M24 44v-9M30.5 27.5l7-7M31 20h7v7', arrive: 'M16 42V10M16 12h18l-4 6 4 6H16'
  };
  const ring = kind === 'round' ? '<circle cx="24" cy="27" r="7.5"/>' : '';
  return `<svg viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="#fff" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round">${ring}<path d="${P[kind] || P.straight}"/></svg>`;
}

export const fmtKm = m => m >= 950 ? (m / 1000).toFixed(m >= 9950 ? 0 : 1).replace('.', ',') + ' km' : (Math.max(10, Math.round(m / 10) * 10)) + ' m';
export const fmtMin = s => Math.max(1, Math.round(s / 60)) + ' min';
export const fmtClock = d => d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
export const esc = s => (s ?? '').toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// One-line description of a hazard for bubbles/popups (keeps IMEPLAN wording; heights of zonas críticas have no unit in the source).
export function hazardLines(h) {
  const lines = [];
  if (h.range) lines.push(`altura registrada ${h.range.replace(/\s/g, '')} cm`);
  else if (h.critInfo?.[0]?.altura) lines.push(`altura reportada «${h.critInfo[0].altura}» (sin unidad en la fuente)`);
  if (h.critInfo?.length) lines.push('zona crítica' + (h.critInfo[0].motivo ? ': ' + h.critInfo[0].motivo.toLowerCase() : ''));
  return lines;
}
export const hazardSrc = h => h.kind === 'modeled' ? 'Modelo exploratorio · no es pronóstico' : `IMEPLAN · MUI 2026 · ${h.id} · registro histórico, no en vivo`;
