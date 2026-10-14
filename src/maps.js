// Map definitions.
//
// Legend:  #  wall          =  girder (wall, alternate look)   -  one-way platform (gravity maps)
//          *  crystal/glow wall                                 .  open space
//          P  player spawn  E  alien rift (spawn point)         C  supply crate spot
//
// Hand-drawn maps with `mirror: true` list only the left half; the right half is the
// left half reversed, which keeps arenas fair and rows the same width.

import { mulberry32 } from './util.js';

function mirrorRows(half) {
  return half.map((r) => r + [...r].reverse().join(''));
}

// ---------------------------------------------------------------------------
// Hand-drawn stations

const DERELICT_HUB = [
  '######....######',
  '#..............#',
  '#..............#',
  '#.P............#',
  '######----......',
  '#...............',
  '#...............',
  '#.......=====---',
  '................',
  '...........C....',
  '......##........',
  '#.....##........',
  '#..P..##........',
  '#####-----......',
  '#...............',
  '#......E........',
  '#...............',
  '######....######',
];

const CARGO_BAY = [
  '################################',
  '#..........#....................',
  '#..........#....................',
  '#.P........#.......E............',
  '#..........#....................',
  '####----####....=====-----======',
  '#...............#...............',
  '#...............#...............',
  '#.......C.......#.......P.......',
  '#.....#####-----#####----#######',
  '#.....#.........................',
  '#.....#.........................',
  '#.....#...E.....................',
  '#.....#.....#####------###......',
  '#...........#...........#.......',
  '#...........#...........#...C...',
  '#.P.........#...........#.......',
  '######------#....E......#####---',
  '#...........#...................',
  '#...........#####-----#.........',
  '#...................#.#.........',
  '#...................#.#.........',
  '#.......C...........#.#.........',
  '#####-----#####.....#.###----###',
  '#.............#.................',
  '#.............#.................',
  '#..E..........#.........E.......',
  '#.....###-----#####.............',
  '#.....#.................#####---',
  '#.....#.................#.......',
  '#.P...#.......C.........#.......',
  '#######.................#.......',
  '#...............####----#...P...',
  '#...............#...............',
  '#...............#...............',
  '################################',
];

const GRAVITY_FAILURE = [
  '############################',
  '#..........#................',
  '#..........#................',
  '#.P........#.......E........',
  '#..........#................',
  '#..........######....#######',
  '#...C.....................==',
  '#...........................',
  '#####.......................',
  '#...#....######...###......#',
  '#...#....#..........#......#',
  '#.E......#..........#......#',
  '#........#....C.....#.......',
  '#...###..#..........###.....',
  '#...#.......................',
  '#...#.......................',
  '#...#.......P...............',
  '#...#####...........###.....',
  '#.......#..........#........',
  '#.......#..........#........',
  '#.......#####..E...#....#...',
  '#...........#......#....#...',
  '####........#......#....#...',
  '#...........#...........#...',
  '#.P.........#.....C.....#...',
  '#.....#######.......=======.',
  '#.....#.....................',
  '#.....#.......E.............',
  '#.....#.....................',
  '#...........#####...........',
  '#...........................',
  '############################',
];

// ---------------------------------------------------------------------------
// Generators

function emptyGrid(w, h, ch = '.') {
  return Array.from({ length: h }, () => Array(w).fill(ch));
}

function farthestPoints(candidates, count, rng, existing = []) {
  const chosen = [];
  const pool = candidates.slice();
  if (!pool.length) return chosen;
  if (!existing.length) chosen.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  while (chosen.length < count && pool.length) {
    let best = -1, bestD = -1;
    for (let i = 0; i < pool.length; i++) {
      let d = Infinity;
      for (const c of [...existing, ...chosen]) d = Math.min(d, (c[0] - pool[i][0]) ** 2 + (c[1] - pool[i][1]) ** 2);
      if (d > bestD) { bestD = d; best = i; }
    }
    chosen.push(pool.splice(best, 1)[0]);
  }
  return chosen;
}

function clearDisc(g, cx, cy, r, wrap) {
  const h = g.length, w = g[0].length;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      let xx = x, yy = y;
      if (wrap) { xx = (x + w) % w; yy = (y + h) % h; }
      else if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) continue;
      g[yy][xx] = '.';
    }
  }
}

// Fill unreachable pockets and carve tunnels so every marker is reachable from the first spawn.
function ensureConnected(g, wrap) {
  const h = g.length, w = g[0].length;
  const open = (x, y) => g[y][x] !== '#' && g[y][x] !== '*';
  const flood = (sx, sy) => {
    const seen = new Uint8Array(w * h);
    const q = [[sx, sy]];
    seen[sy * w + sx] = 1;
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let nx = x + dx, ny = y + dy;
        if (wrap) { nx = (nx + w) % w; ny = (ny + h) % h; }
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (seen[ny * w + nx] || !open(nx, ny)) continue;
        seen[ny * w + nx] = 1;
        q.push([nx, ny]);
      }
    }
    return seen;
  };
  const markers = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ('PEC'.includes(g[y][x])) markers.push([x, y]);
  if (!markers.length) return;
  const [ox, oy] = markers[0];
  let seen = flood(ox, oy);
  for (const [mx, my] of markers) {
    if (seen[my * w + mx]) continue;
    // Carve a 2-wide tunnel toward the origin marker.
    let x = mx, y = my;
    while (x !== ox || y !== oy) {
      if (Math.abs(ox - x) > Math.abs(oy - y)) x += Math.sign(ox - x); else y += Math.sign(oy - y);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx > 0 && yy > 0 && xx < w - 1 && yy < h - 1 && !open(xx, yy)) g[yy][xx] = '.';
      }
    }
    seen = flood(ox, oy);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (open(x, y) && !seen[y * w + x]) g[y][x] = '#';
}

function placeMarkers(g, rng, wrap, { spawns, rifts, crates, needFloor }) {
  const h = g.length, w = g[0].length;
  const cands = [];
  for (let y = 2; y < h - 3; y++) {
    for (let x = 2; x < w - 2; x++) {
      if (g[y][x] !== '.') continue;
      if (needFloor) {
        if (g[y + 1][x] !== '#' && g[y + 1][x] !== '*') continue;
        if (g[y - 1][x] !== '.' || g[y][x - 1] !== '.' || g[y][x + 1] !== '.') continue;
      }
      cands.push([x, y]);
    }
  }
  const sp = farthestPoints(cands, spawns, rng);
  for (const [x, y] of sp) {
    if (!needFloor) clearDisc(g, x, y, 2.3, wrap);
    g[y][x] = 'P';
  }
  const rest = cands.filter(([x, y]) => g[y][x] === '.');
  const rf = farthestPoints(rest, rifts, rng, sp);
  for (const [x, y] of rf) {
    if (!needFloor) clearDisc(g, x, y, 1.6, wrap);
    g[y][x] = 'E';
  }
  const rest2 = cands.filter(([x, y]) => g[y][x] === '.');
  const cr = farthestPoints(rest2, crates, rng, [...sp, ...rf]);
  for (const [x, y] of cr) g[y][x] = 'C';
}

function genAsteroids({ w, h, seed, count, rmin, rmax, wrap, spawns = 6 }) {
  const rng = mulberry32(seed);
  const g = emptyGrid(w, h);
  for (let i = 0; i < count; i++) {
    const cx = rng() * w, cy = rng() * h;
    const r = rmin + rng() * (rmax - rmin);
    const k1 = 2 + Math.floor(rng() * 3), p1 = rng() * 6.28;
    const k2 = 4 + Math.floor(rng() * 4), p2 = rng() * 6.28;
    for (let y = Math.floor(cy - r * 1.5); y <= cy + r * 1.5; y++) {
      for (let x = Math.floor(cx - r * 1.5); x <= cx + r * 1.5; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const a = Math.atan2(dy, dx);
        const rr = r * (1 + 0.28 * Math.sin(k1 * a + p1) + 0.12 * Math.sin(k2 * a + p2));
        if (dx * dx + dy * dy > rr * rr) continue;
        let xx = x, yy = y;
        if (wrap) { xx = ((x % w) + w) % w; yy = ((y % h) + h) % h; }
        else if (x < 0 || y < 0 || x >= w || y >= h) continue;
        g[yy][xx] = rng() < 0.05 ? '*' : '#';
      }
    }
  }
  if (!wrap) {
    for (let x = 0; x < w; x++) { g[0][x] = '#'; g[h - 1][x] = '#'; }
    for (let y = 0; y < h; y++) { g[y][0] = '#'; g[y][w - 1] = '#'; }
  }
  placeMarkers(g, rng, wrap, { spawns, rifts: 5, crates: 4, needFloor: false });
  ensureConnected(g, wrap);
  return g.map((r) => r.join(''));
}

function genHive({ w, h, seed, fill = 0.45, steps = 5 }) {
  const rng = mulberry32(seed);
  let g = emptyGrid(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    g[y][x] = edge || rng() < fill ? '#' : '.';
  }
  for (let s = 0; s < steps; s++) {
    const n = emptyGrid(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { n[y][x] = '#'; continue; }
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (g[y + dy][x + dx] === '#') c++;
      n[y][x] = c >= 5 ? '#' : '.';
    }
    g = n;
  }
  // Organic glow pods on some surface tiles.
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    if (g[y][x] === '#' && g[y - 1][x] === '.' && rng() < 0.08) g[y][x] = '*';
  }
  // A few one-way membranes across wide vertical gaps make climbing easier.
  for (let x = 2; x < w - 2; x += 3 + Math.floor(rng() * 4)) {
    for (let y = 4; y < h - 4; y++) {
      let run = 0;
      while (y + run < h - 1 && g[y + run][x] === '.') run++;
      if (run >= 7) {
        const py = y + Math.floor(run / 2);
        for (let dx = -1; dx <= 2; dx++) if (g[py][x + dx] === '.') g[py][x + dx] = '-';
      }
      y += run;
    }
  }
  placeMarkers(g, rng, false, { spawns: 6, rifts: 5, crates: 4, needFloor: true });
  ensureConnected(g, false);
  return g.map((r) => r.join(''));
}

// ---------------------------------------------------------------------------

export const MAPS = [
  {
    id: 'hub',
    name: 'Derelict Hub',
    theme: 'station',
    gravity: true,
    wrap: true,
    desc: 'A gutted docking hub. Single screen, edges wrap around.',
    rows: () => mirrorRows(DERELICT_HUB),
  },
  {
    id: 'drift',
    name: 'Ice Drift',
    theme: 'asteroid',
    gravity: false,
    wrap: true,
    desc: 'Tight asteroid cluster in zero-g. Single screen, edges wrap.',
    rows: () => genAsteroids({ w: 32, h: 18, seed: 7, count: 11, rmin: 1.2, rmax: 2.6, wrap: true }),
  },
  {
    id: 'cargo',
    name: 'Cargo Bay 7',
    theme: 'station',
    gravity: true,
    wrap: false,
    desc: 'Six decks of abandoned freight. Large map, split screen.',
    rows: () => mirrorRows(CARGO_BAY),
  },
  {
    id: 'kessler',
    name: 'Kessler Belt',
    theme: 'asteroid',
    gravity: false,
    wrap: false,
    desc: 'A sprawling debris belt in zero-g. Large map, split screen.',
    rows: () => genAsteroids({ w: 70, h: 42, seed: 1337, count: 46, rmin: 1.4, rmax: 4.2, wrap: false }),
  },
  {
    id: 'hive',
    name: 'Hive Hulk',
    theme: 'hive',
    gravity: true,
    wrap: false,
    desc: 'A station overgrown by the swarm. Large map, split screen.',
    rows: () => genHive({ w: 56, h: 34, seed: 42 }),
  },
  {
    id: 'failure',
    name: 'Gravity Failure',
    theme: 'station',
    gravity: false,
    wrap: false,
    desc: 'The gravity generators are dead. Zero-g corridors, split screen.',
    rows: () => mirrorRows(GRAVITY_FAILURE),
  },
];

export function getMap(id) {
  return MAPS.find((m) => m.id === id) || MAPS[0];
}
