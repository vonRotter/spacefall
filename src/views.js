// Viewport layout and cameras. Every viewport on screen always has the same size:
// 1 view = full screen, 2 = halves, 3-4 = quarters (with 3 players the spare quarter
// shows a tactical overview of the whole map).

import * as THREE from 'three';
import { VIEW } from './config.js';
import { clamp, damp, lerp, rand } from './util.js';

export function computeLayout(n, W, H) {
  if (n <= 1) return [{ x: 0, y: 0, w: W, h: H }];
  if (n === 2) {
    if (W / H >= 1.2) {
      const w = Math.floor(W / 2);
      return [{ x: 0, y: 0, w, h: H }, { x: W - w, y: 0, w, h: H }];
    }
    const h = Math.floor(H / 2);
    return [{ x: 0, y: 0, w: W, h }, { x: 0, y: H - h, w: W, h }];
  }
  const w = Math.floor(W / 2), h = Math.floor(H / 2);
  return [
    { x: 0, y: 0, w, h },
    { x: W - w, y: 0, w, h },
    { x: 0, y: H - h, w, h },
    { x: W - w, y: H - h, w, h },
  ];
}

const halfFovTan = () => Math.tan((VIEW.fov * Math.PI) / 360);

export class View {
  constructor(kind, player = null) {
    this.kind = kind; // 'shared' | 'follow' | 'overview' | 'attract'
    this.player = player;
    this.camera = new THREE.PerspectiveCamera(VIEW.fov, 1, 0.5, 1000);
    this.rect = { x: 0, y: 0, w: 1, h: 1 };
    this.x = 0;
    this.y = 0;
    this.visH = VIEW.heightFull;
    this.shake = 0;
    this.spectate = null;
    this.snap = true;
  }

  setRect(rect, screenH) {
    this.rect = rect;
    this.camera.aspect = rect.w / rect.h;
    this.camera.updateProjectionMatrix();
    const share = rect.h / screenH;
    this.followH = lerp(VIEW.heightHalf, VIEW.heightFull, clamp((share - 0.5) / 0.5, 0, 1));
    // Narrow side-by-side views get a slightly taller window so the visible area stays generous.
    if (this.camera.aspect < 1) this.followH *= 1.12;
  }

  get visW() { return this.visH * this.camera.aspect; }

  fitWorld(world, margin = 0.6) {
    const aspect = this.camera.aspect;
    this.visH = Math.max(world.h + margin * 2, (world.w + margin * 2) / aspect);
    this.x = world.w / 2;
    this.y = world.h / 2;
  }

  update(dt, game) {
    const world = game.world;
    if (this.kind === 'shared' || this.kind === 'overview') {
      this.fitWorld(world, this.kind === 'shared' ? 0.15 : 1);
    } else if (this.kind === 'follow') {
      this.visH = this.followH;
      const target = this.followTarget(game);
      if (target) {
        const tx = target.x + clamp(target.vx || 0, -8, 8) * 0.22;
        const ty = target.y + clamp(target.vy || 0, -8, 8) * 0.14;
        if (this.snap) { this.x = tx; this.y = ty; this.snap = false; }
        this.x = damp(this.x, tx, VIEW.followLerp, dt);
        this.y = damp(this.y, ty, VIEW.followLerp, dt);
      }
      this.clampTo(world);
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.apply();
  }

  followTarget(game) {
    const ship = this.player && this.player.ship;
    if (ship && ship.alive) { this.spectate = null; return ship; }
    // Dead: hold on the death spot while respawning, otherwise spectate a survivor.
    if (game.mode === 'pve' && this.player.lives > 0) return this.player.deathPos || ship;
    if (!this.spectate || !this.spectate.alive) {
      this.spectate = game.ships().find((s) => s.alive) || null;
    }
    return this.spectate || (this.player && this.player.deathPos) || null;
  }

  clampTo(world) {
    const hw = this.visW / 2, hh = this.visH / 2;
    const m = 0.4;
    this.x = world.w + 2 * m <= hw * 2 ? world.w / 2 : clamp(this.x, hw - m, world.w - hw + m);
    this.y = world.h + 2 * m <= hh * 2 ? world.h / 2 : clamp(this.y, hh - m, world.h - hh + m);
  }

  apply() {
    const dist = this.visH / 2 / halfFovTan();
    const s = this.shake * this.shake * 0.5;
    this.camera.position.set(this.x + rand(-s, s), this.y + rand(-s, s), dist);
    this.camera.lookAt(this.camera.position.x, this.camera.position.y, 0);
  }

  addShake(amount, x, y) {
    if (x !== undefined && this.kind === 'follow') {
      const dx = Math.abs(x - this.x), dy = Math.abs(y - this.y);
      if (dx > this.visW * 0.7 || dy > this.visH * 0.7) return;
    }
    this.shake = Math.min(1.2, this.shake + amount);
  }

  // World -> screen pixel coordinates (CSS px, whole canvas), or null if behind camera.
  project(x, y, z, out) {
    const v = out || new THREE.Vector3();
    v.set(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    return {
      x: this.rect.x + (v.x * 0.5 + 0.5) * this.rect.w,
      y: this.rect.y + (-v.y * 0.5 + 0.5) * this.rect.h,
      inside: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1,
      nx: v.x,
      ny: v.y,
    };
  }
}
