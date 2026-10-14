// Tile grid, collision, line of sight and the flow field aliens use to path toward players.

import { mod } from './util.js';

export const EMPTY = 0;
export const SOLID = 1;
export const PLATFORM = 2;

const EPS = 1e-5;

export class World {
  constructor(def) {
    this.def = def;
    const rows = def.rows();
    this.rows = rows;
    this.h = rows.length;
    this.w = rows[0].length;
    this.wrap = !!def.wrap;
    this.gravity = !!def.gravity;
    this.tiles = new Uint8Array(this.w * this.h);
    this.chars = new Array(this.w * this.h);
    this.spawns = [];
    this.rifts = [];
    this.crates = [];
    for (let r = 0; r < this.h; r++) {
      const row = rows[r];
      if (row.length !== this.w) throw new Error(`Map ${def.id}: row ${r} has width ${row.length}, expected ${this.w}`);
      const ty = this.h - 1 - r;
      for (let tx = 0; tx < this.w; tx++) {
        const ch = row[tx];
        const i = ty * this.w + tx;
        this.chars[i] = ch;
        if (ch === '#' || ch === '=' || ch === '*') this.tiles[i] = SOLID;
        else if (ch === '-') this.tiles[i] = this.gravity ? PLATFORM : SOLID;
        const pos = { x: tx + 0.5, y: ty + 0.5 };
        if (ch === 'P') this.spawns.push(pos);
        else if (ch === 'E') this.rifts.push(pos);
        else if (ch === 'C') this.crates.push(pos);
      }
    }
    this.computeReachable();
    this.flow = new Int16Array(this.w * this.h);
    this.queue = new Int32Array(this.w * this.h);
  }

  index(tx, ty) {
    if (this.wrap) return mod(ty, this.h) * this.w + mod(tx, this.w);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return -1;
    return ty * this.w + tx;
  }
  tile(tx, ty) {
    const i = this.index(tx, ty);
    return i < 0 ? SOLID : this.tiles[i];
  }
  solid(tx, ty) { return this.tile(tx, ty) === SOLID; }
  solidAt(x, y) { return this.solid(Math.floor(x), Math.floor(y)); }
  charAt(tx, ty) {
    const i = this.index(tx, ty);
    return i < 0 ? '#' : this.chars[i];
  }

  wrapBody(b) {
    if (!this.wrap) return;
    b.x = mod(b.x, this.w);
    b.y = mod(b.y, this.h);
  }

  // Shortest vector from a to b, honoring wrap-around.
  delta(ax, ay, bx, by) {
    let dx = bx - ax, dy = by - ay;
    if (this.wrap) {
      if (dx > this.w / 2) dx -= this.w; else if (dx < -this.w / 2) dx += this.w;
      if (dy > this.h / 2) dy -= this.h; else if (dy < -this.h / 2) dy += this.h;
    }
    return [dx, dy];
  }
  dist(a, b) {
    const [dx, dy] = this.delta(a.x, a.y, b.x, b.y);
    return Math.hypot(dx, dy);
  }

  overlaps(a, b) {
    const [dx, dy] = this.delta(a.x, a.y, b.x, b.y);
    return Math.abs(dx) < a.hw + b.hw && Math.abs(dy) < a.hh + b.hh;
  }

  // Box overlaps any solid tile?
  boxSolid(x, y, hw, hh) {
    const x0 = Math.floor(x - hw + EPS), x1 = Math.floor(x + hw - EPS);
    const y0 = Math.floor(y - hh + EPS), y1 = Math.floor(y + hh - EPS);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (this.solid(tx, ty)) return true;
    return false;
  }

  // Axis-separated movement of an AABB body {x,y,hw,hh}. Returns which sides were blocked.
  move(b, dx, dy, platforms = false, dropThrough = false) {
    const res = { left: false, right: false, up: false, down: false };
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.3));
    const sx = dx / steps, sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      if (sx) this.stepX(b, sx, res);
      if (sy) this.stepY(b, sy, res, platforms && !dropThrough);
    }
    this.wrapBody(b);
    return res;
  }

  stepX(b, dx, res) {
    b.x += dx;
    const y0 = Math.floor(b.y - b.hh + EPS), y1 = Math.floor(b.y + b.hh - EPS);
    if (dx > 0) {
      const tx = Math.floor(b.x + b.hw - EPS);
      for (let ty = y0; ty <= y1; ty++) {
        if (this.solid(tx, ty)) { b.x = tx - b.hw; res.right = true; return; }
      }
    } else {
      const tx = Math.floor(b.x - b.hw + EPS);
      for (let ty = y0; ty <= y1; ty++) {
        if (this.solid(tx, ty)) { b.x = tx + 1 + b.hw; res.left = true; return; }
      }
    }
  }

  stepY(b, dy, res, platforms) {
    const oldBottom = b.y - b.hh;
    b.y += dy;
    const x0 = Math.floor(b.x - b.hw + EPS), x1 = Math.floor(b.x + b.hw - EPS);
    if (dy > 0) {
      const ty = Math.floor(b.y + b.hh - EPS);
      for (let tx = x0; tx <= x1; tx++) {
        if (this.solid(tx, ty)) { b.y = ty - b.hh; res.up = true; return; }
      }
    } else {
      const ty = Math.floor(b.y - b.hh + EPS);
      for (let tx = x0; tx <= x1; tx++) {
        const t = this.tile(tx, ty);
        if (t === SOLID || (platforms && t === PLATFORM && oldBottom >= ty + 1 - 0.02)) {
          b.y = ty + 1 + b.hh; res.down = true; return;
        }
      }
    }
  }

  // Is there a platform directly beneath the body (used for drop-through)?
  onPlatform(b) {
    const ty = Math.floor(b.y - b.hh - 0.05);
    const x0 = Math.floor(b.x - b.hw + EPS), x1 = Math.floor(b.x + b.hw - EPS);
    for (let tx = x0; tx <= x1; tx++) if (this.tile(tx, ty) === PLATFORM) return true;
    return false;
  }

  lineOfSight(ax, ay, bx, by) {
    const [dx, dy] = this.delta(ax, ay, bx, by);
    const len = Math.hypot(dx, dy);
    const n = Math.ceil(len / 0.25);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.solidAt(ax + dx * t, ay + dy * t)) return false;
    }
    return true;
  }

  computeReachable() {
    const { w, h } = this;
    this.reachable = new Uint8Array(w * h);
    const q = [];
    for (const s of [...this.spawns, ...this.rifts]) {
      const i = this.index(Math.floor(s.x), Math.floor(s.y));
      if (i >= 0 && !this.reachable[i]) { this.reachable[i] = 1; q.push(i); }
    }
    while (q.length) {
      const i = q.pop();
      const x = i % w, y = (i / w) | 0;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = this.index(x + ox, y + oy);
        if (j < 0 || this.reachable[j] || this.tiles[j] === SOLID) continue;
        this.reachable[j] = 1;
        q.push(j);
      }
    }
    // Cells with a little elbow room, for spawning crates and aliens at random.
    this.openCells = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!this.reachable[y * w + x] || this.tiles[y * w + x] !== EMPTY) continue;
      if (this.solid(x + 1, y) && this.solid(x - 1, y)) continue;
      if (this.solid(x, y + 1) && this.solid(x, y - 1)) continue;
      this.openCells.push({ x: x + 0.5, y: y + 0.5 });
    }
  }

  // Random reachable open position at least minDist away from every point in `avoid`.
  randomOpen(avoid = [], minDist = 6, tries = 60) {
    let best = null, bestD = -1;
    for (let i = 0; i < tries; i++) {
      const c = this.openCells[Math.floor(Math.random() * this.openCells.length)];
      let d = Infinity;
      for (const a of avoid) d = Math.min(d, this.dist(c, a));
      if (d >= minDist) return { x: c.x, y: c.y };
      if (d > bestD) { bestD = d; best = c; }
    }
    return best ? { x: best.x, y: best.y } : { x: this.w / 2, y: this.h / 2 };
  }

  // Multi-source BFS from target positions across non-solid tiles.
  computeFlow(targets) {
    const { w, h, flow, queue } = this;
    flow.fill(-1);
    let head = 0, tail = 0;
    for (const t of targets) {
      const i = this.index(Math.floor(t.x), Math.floor(t.y));
      if (i < 0 || flow[i] === 0) continue;
      flow[i] = 0;
      queue[tail++] = i;
    }
    while (head < tail) {
      const i = queue[head++];
      const x = i % w, y = (i / w) | 0;
      const d = flow[i] + 1;
      for (let k = 0; k < 4; k++) {
        const j = this.index(x + (k === 0 ? 1 : k === 1 ? -1 : 0), y + (k === 2 ? 1 : k === 3 ? -1 : 0));
        if (j < 0 || flow[j] !== -1 || this.tiles[j] === SOLID) continue;
        flow[j] = d;
        queue[tail++] = j;
      }
    }
    this.flowReady = targets.length > 0;
  }

  // Direction (unit vector) toward the nearest target along the flow field, or null.
  flowDir(x, y) {
    if (!this.flowReady) return null;
    const tx = Math.floor(x), ty = Math.floor(y);
    const i = this.index(tx, ty);
    if (i < 0) return null;
    const here = this.flow[i];
    if (here <= 0) return null;
    let best = here, bx = 0, by = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        if (ox && oy && (this.solid(tx + ox, ty) || this.solid(tx, ty + oy))) continue;
        const j = this.index(tx + ox, ty + oy);
        if (j < 0) continue;
        const v = this.flow[j];
        if (v >= 0 && v < best) { best = v; bx = ox; by = oy; }
      }
    }
    if (best === here) return null;
    const [dx, dy] = this.delta(x, y, tx + bx + 0.5, ty + by + 0.5);
    const m = Math.hypot(dx, dy) || 1;
    return [dx / m, dy / m];
  }
}
