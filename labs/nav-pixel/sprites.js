// nav-pixel · procedural pixel art (no image files). Every colour comes from the ENDESGA 32 palette.
export const PAL = {
  ink: '#181425', night: '#262b44', slate: '#3a4466', steel: '#5a6988', fog: '#8b9bb4', mist: '#c0cbdc', white: '#ffffff',
  wine: '#3e2731', brown: '#733e39', clay: '#b86f50', tan: '#c28569', peach: '#e8b796', sand: '#ead4aa', apricot: '#e4a672',
  rust: '#be4a2f', orange: '#d77643', flame: '#f77622', gold: '#feae34', yellow: '#fee761',
  blood: '#a22633', red: '#e43b44', hot: '#ff0044', plum: '#68386c', mauve: '#b55088', pink: '#f6757a',
  leaf: '#63c74d', grass: '#3e8948', pine: '#265c42', deep: '#193c3e',
  navy: '#124e89', blue: '#0099db', cyan: '#2ce8f5'
};
export const PALETTE32 = ['#be4a2f','#d77643','#ead4aa','#e4a672','#b86f50','#733e39','#3e2731','#a22633','#e43b44','#f77622','#feae34','#fee761','#63c74d','#3e8948','#265c42','#193c3e','#124e89','#0099db','#2ce8f5','#ffffff','#c0cbdc','#8b9bb4','#5a6988','#3a4466','#262b44','#181425','#ff0044','#68386c','#b55088','#f6757a','#e8b796','#c28569'];

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// rows: array of strings, key: char -> palette hex ('.' or ' ' = transparent)
export function pix(rows, key) {
  const h = rows.length, w = Math.max(...rows.map(r => r.length));
  const data = new Uint8ClampedArray(w * h * 4);
  rows.forEach((r, y) => { for (let x = 0; x < w; x++) { const c = r[x]; if (!c || c === '.' || c === ' ') continue; const col = key[c]; if (!col) continue; const [R, G, B] = hex(col); const i = (y * w + x) * 4; data[i] = R; data[i + 1] = G; data[i + 2] = B; data[i + 3] = 255; } });
  return { width: w, height: h, data };
}
export const mirror = half => half.map(r => r + [...r].reverse().join(''));
export function toCanvas(img, scale = 1) {
  const c = document.createElement('canvas'); c.width = img.width * scale; c.height = img.height * scale;
  const tmp = document.createElement('canvas'); tmp.width = img.width; tmp.height = img.height;
  tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(tmp, 0, 0, c.width, c.height);
  return c;
}
export const toURL = (img, scale = 1) => toCanvas(img, scale).toDataURL();

// ---------- map pattern tiles (16x16) ----------
function tile(fn) { const rows = []; for (let y = 0; y < 16; y++) { let r = ''; for (let x = 0; x < 16; x++) r += fn(x, y); rows.push(r); } return rows; }
// wave mark "︶" pixels relative to anchor
const WAVE = [[0, 0], [1, 1], [2, 1], [3, 0], [4, 0], [5, 1], [6, 1]];
function waveTile(frame, base, crest, foam, dark) {
  const g = Array.from({ length: 16 }, () => Array(16).fill('b'));
  const marks = [[1, 3], [9, 11]], shift = frame % 4 * 2;
  for (const [ax, ay] of marks) for (const [dx, dy] of WAVE) g[(ay + dy) % 16][(ax + dx + shift) % 16] = 'c';
  // shimmer specks
  const specks = [[12, 2], [4, 9], [14, 14], [6, 15]];
  specks.forEach(([x, y], i) => { if ((i + frame) % 2 === 0) g[y][(x + frame) % 16] = 'f'; });
  if (dark) [[7, 6], [8, 6], [2, 13], [3, 13]].forEach(([x, y]) => { g[y][(x + 16 - frame) % 16] = 'd'; });
  return pix(g.map(r => r.join('')), { b: base, c: crest, f: foam, d: dark || base });
}
export const waterFrames = () => [0, 1, 2, 3].map(f => waveTile(f, PAL.navy, PAL.blue, PAL.cyan, PAL.deep));
// Observed flooding: brighter, busier tile (crest rows every 4 px) so it reads as standing water over streets.
function floodTile(frame) {
  const g = Array.from({ length: 16 }, () => Array(16).fill('b'));
  for (let row = 0; row < 4; row++) {
    const y = row * 4 + 1, off = (row % 2 ? 4 : 0) + frame * (row % 2 ? -1 : 1);
    for (let x = 0; x < 16; x++) {
      const k = ((x + off) % 8 + 8) % 8;
      if (k === 0 || k === 1) g[y][x] = 'c';
      if (k === 2 || k === 3) g[y + 1][x] = 'c';
      if (k === 1 && (row + frame) % 2 === 0) g[y][x] = 'w';
    }
  }
  return pix(g.map(r => r.join('')), { b: PAL.blue, c: PAL.cyan, w: PAL.white });
}
export const floodFrames = () => [0, 1, 2, 3].map(floodTile);
export const modeledFrames = () => [0, 1, 2, 3].map(f => waveTile(f, PAL.plum, PAL.mauve, PAL.pink, PAL.night));

export function treeTile() {
  const rows = [
    '..gggg..........',
    '.gGGggg.........',
    'gGGgggpg........',
    'gGgggggp........',
    'ggggggpp........',
    '.gggpppp........',
    '..pppp..........',
    '...bb...........',
    '.........gggg...',
    '........gGGggg..',
    '.......gGGgggpg.',
    '.......gGgggggp.',
    '.......ggggggpp.',
    '........gggpppp.',
    '.........pppp...',
    '..........bb....'];
  return pix(rows.map(r => r.replace(/\./g, 'x')), { x: PAL.grass, g: PAL.leaf, G: PAL.yellow, p: PAL.pine, b: PAL.brown });
}
export function grassTile() {
  return pix(tile((x, y) => ((x === 3 && y === 4) || (x === 4 && y === 3) || (x === 5 && y === 4) || (x === 11 && y === 12) || (x === 12 && y === 11) || (x === 13 && y === 12)) ? 'd' : 'g'), { g: PAL.leaf, d: PAL.grass });
}
export function fieldTile() {
  return pix(tile((x, y) => (y % 4 === 0) ? 'd' : ((x + y) % 7 === 0 ? 'h' : 'g')), { g: PAL.apricot, d: PAL.tan, h: PAL.sand });
}
export function plazaTile() {
  return pix(tile((x, y) => (x % 8 === 0 || y % 8 === 0) ? 'd' : 'g'), { g: PAL.sand, d: PAL.peach });
}

// ---------- UI sprites ----------
// Ajolote copiloto "AXO" with a yellow rain hat (20x20, mirrored halves).
export function axoPortrait(blink = false, talk = false) {
  const half = [
    '..........',
    '.....kkkkk',
    '....kyyYYy',
    '...kyyYyyy',
    '...kyyyyyy',
    '.kkkkkkkkk',
    'mk.kpppppp',
    'mmkppppppp',
    '.mkpkkpppp',
    'mmkpkwkppp',
    '.mkpkkkppp',
    'mmkppppppp',
    '..kpprrppp',
    '..kpppppkk',
    '..kppppppp',
    '...kkppppp',
    '....kllllk',
    '...kllllll',
    '...kllkkkk',
    '...kkk....'];
  const rows = mirror(half);
  if (blink) { rows[8] = rows[8].replace(/kk(?=pppp)/, 'pp'); rows[9] = rows[9].replace('kwk', 'kkk'); rows[10] = rows[10].replace('kkk', 'ppp'); }
  if (talk) { rows[14] = rows[14].slice(0, 8) + 'kRRk' + rows[14].slice(12); }
  return pix(rows, { k: PAL.ink, y: PAL.gold, Y: PAL.yellow, m: PAL.mauve, p: PAL.pink, w: PAL.white, r: PAL.red, l: PAL.sand, R: PAL.blood });
}

// Road-sign style hazard icons (16x16)
export function signIcon(kind) {
  const base = [
    '.......kk.......',
    '......kyyk......',
    '.....kyyyyk.....',
    '....kyyyyyyk....',
    '...kyyyyyyyyk...',
    '..kyyyyyyyyyyk..',
    '.kyyyyyyyyyyyyk.',
    'kyyyyyyyyyyyyyyk',
    'kyyyyyyyyyyyyyyk',
    '.kyyyyyyyyyyyyk.',
    '..kyyyyyyyyyyk..',
    '...kyyyyyyyyk...',
    '....kyyyyyyk....',
    '.....kyyyyk.....',
    '......kyyk......',
    '.......kk.......'];
  const g = base.map(r => r.split(''));
  const put = (pts, c) => pts.forEach(([x, y]) => { g[y][x] = c; });
  if (kind === 'encharcamiento') {
    put([[7, 3], [8, 3], [6, 4], [7, 4], [8, 4], [9, 4], [6, 5], [7, 5], [8, 5], [9, 5], [7, 6], [8, 6]], 'b');
    put([[3, 9], [4, 8], [5, 8], [6, 9], [7, 9], [8, 8], [9, 8], [10, 9], [11, 9], [12, 8]], 'b');
    put([[4, 11], [5, 10], [6, 10], [7, 11], [8, 11], [9, 10], [10, 10], [11, 11]], 'b');
  } else if (kind === 'desnivel') {
    put([[3, 6], [4, 7], [5, 8], [6, 8], [7, 8], [8, 8], [9, 8], [10, 8], [11, 7], [12, 6]], 'k');
    put([[5, 9], [6, 9], [7, 9], [8, 9], [9, 9], [10, 9], [6, 10], [7, 10], [8, 10], [9, 10]], 'b');
    put([[7, 3], [8, 3], [7, 4], [8, 4], [6, 5], [7, 5], [8, 5], [9, 5]], 'k');
  } else if (kind === 'critica') {
    for (const r of g) for (let i = 0; i < r.length; i++) if (r[i] === 'y') r[i] = 'r';
    put([[7, 3], [8, 3], [7, 4], [8, 4], [7, 5], [8, 5], [7, 6], [8, 6], [7, 7], [8, 7], [7, 8], [8, 8], [7, 10], [8, 10], [7, 11], [8, 11]], 'w');
  } else if (kind === 'modelado') {
    for (const r of g) for (let i = 0; i < r.length; i++) if (r[i] === 'y') r[i] = 'm';
    put([[6, 4], [7, 4], [8, 4], [9, 4], [10, 5], [10, 6], [9, 7], [8, 8], [8, 9], [8, 11], [8, 12]], 'w');
  }
  return pix(g.map(r => r.join('')), { k: PAL.ink, y: PAL.gold, b: PAL.navy, r: PAL.hot, w: PAL.white, m: PAL.mauve });
}
export function crossIcon() {
  return pix([
    'kk......kk',
    'krk....krk',
    '.krk..krk.',
    '..krkkrk..',
    '...krrk...',
    '...krrk...',
    '..krkkrk..',
    '.krk..krk.',
    'krk....krk',
    'kk......kk'], { k: PAL.ink, r: PAL.hot });
}
export function flagIcon(kind) {
  if (kind === 'B') return pix([
    'kkkkkkkkkkk.',
    'kwkwkwkwkwk.',
    'kkwkwkwkwkk.',
    'kwkwkwkwkwk.',
    'kkkkkkkkkkk.',
    'kb..........',
    'kb..........',
    'kb..........',
    'kb..........',
    'kb..........',
    'kb..........',
    'kkk.........'], { k: PAL.ink, w: PAL.white, b: PAL.fog });
  return pix([
    'kkkkkkkk....',
    'krrrrrrrk...',
    'krrrrrrrrk..',
    'krrrrrrrk...',
    'kkkkkkkk....',
    'kb..........',
    'kb..........',
    'kb..........',
    'kb..........',
    'kb..........',
    'kb..........',
    'kkk.........'], { k: PAL.ink, r: PAL.red, b: PAL.fog });
}
export function planeIcon() {
  return pix(mirror([
    '.......k',
    '......kw',
    '......kw',
    '.....kkw',
    '..kkkwww',
    'kkwwwwww',
    'kwwwwwww',
    '.kkkkkww',
    '......kw',
    '.....kkw',
    '....kwww',
    '....kkkk']), { k: PAL.ink, w: PAL.white });
}
// Maneuver arrows 12x12
const ARW = {
  straight: ['.....kk.....', '....kwwk....', '...kwwwwk...', '..kwwwwwwk..', '.kkkwwwwkkk.', '....kwwk....', '....kwwk....', '....kwwk....', '....kwwk....', '....kwwk....', '....kwwk....', '....kkkk....'],
  left: ['....k.......', '...kk.......', '..kwkkkkkk..', '.kwwwwwwwwk.', 'kwwwwwwwwwk.', '.kwwwwwwwwk.', '..kwkkkkwwk.', '...kk...kwwk', '....k...kwwk', '........kwwk', '........kwwk', '........kkkk'],
  slight: ['....kkkkkk..', '....kwwwwk..', '......kwwk..', '.....kwkwk..', '....kwk.kk..', '...kwk...k..', '..kwk.......', '.kwwk.......', '.kwwk.......', '.kwwk.......', '.kwwk.......', '.kkkk.......'],
  uturn: ['..kkkkkk....', '.kwwwwwwk...', 'kwwkkkkwwk..', 'kwwk..kwwk..', 'kwwk..kwwk..', 'kwwk..kwwk..', 'kwwk.kkwwkk.', 'kwwk.kwwwwk.', 'kwwk..kwwk..', 'kwwk...kk...', 'kwwk........', 'kkkk........'],
  round: ['....kkkk....', '..kkwwwwkk..', '.kwwkkkkwwk.', '.kwk....kwk.', 'kwk......kwk', 'kwk......kk.', 'kwk.........', '.kwk....k...', '.kwwkkkkwk..', '..kkwwwwwwk.', '....kkkkwk..', '........k...']
};
export function arrowIcon(kind) {
  const key = { k: PAL.ink, w: PAL.white };
  const flip = rows => rows.map(r => [...r].reverse().join(''));
  switch (kind) {
    case 'left': return pix(ARW.left, key);
    case 'right': return pix(flip(ARW.left), key);
    case 'slight right': return pix(ARW.slight, key);
    case 'slight left': return pix(flip(ARW.slight), key);
    case 'sharp left': return pix(ARW.left, key);
    case 'sharp right': return pix(flip(ARW.left), key);
    case 'uturn': return pix(ARW.uturn, key);
    case 'round': return pix(ARW.round, key);
    case 'arrive': return flagIcon('B');
    default: return pix(ARW.straight, key);
  }
}
export function heartIcon(full = true) {
  return pix([
    '.kk.kk.',
    'krrkrrk',
    'krwrrrk',
    'krrrrrk',
    '.krrrk.',
    '..krk..',
    '...k...'], { k: PAL.ink, r: full ? PAL.red : PAL.steel, w: full ? PAL.pink : PAL.fog });
}
export function dropIcon() {
  return pix([
    '...kk...',
    '..kbbk..',
    '.kbccbk.',
    '.kbcbbk.',
    'kbcbbbbk',
    'kbbbbbbk',
    '.kbbbbk.',
    '..kkkk..'], { k: PAL.ink, b: PAL.blue, c: PAL.cyan });
}
export function sunIcon() {
  return pix([
    '...k..k...',
    '.k......k.',
    '...yyyy...',
    'k.yYYyyy.k',
    '..yYyyyy..',
    '..yyyyyy..',
    'k.yyyyyy.k',
    '...yyyy...',
    '.k......k.',
    '...k..k...'], { k: PAL.gold, y: PAL.gold, Y: PAL.yellow });
}
export function cloudIcon() {
  return pix([
    '....kkk....',
    '..kkwwwk...',
    '.kwwwwwwkk.',
    'kwwwwwwwwwk',
    'kmmmmmmmmmk',
    '.kkkkkkkkk.',
    '..b..b..b..',
    '.b..b..b...'], { k: PAL.ink, w: PAL.mist, m: PAL.fog, b: PAL.cyan });
}
export function scrollIcon() {
  return pix([
    '.kkkkkkkkk.',
    'kpppppppppk',
    '.kpkkkkkpk.',
    '.kpppppppk.',
    '.kpkkkkppk.',
    '.kpppppppk.',
    '.kpkkkkkpk.',
    'kpppppppppk',
    '.kkkkkkkkk.'], { k: PAL.wine, p: PAL.sand });
}
