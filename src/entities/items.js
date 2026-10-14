// Missiles (flying, stuck in walls, or dropped), supply crates, alien bolts and spawn rifts.

import { MISSILE } from '../config.js';
import { makeMissile, makeCrate, makeBolt, makeRift } from '../assets.js';
import { sfx } from '../audio.js';
import { rand } from '../util.js';

export class Missile {
  constructor(game, owner, x, y, vx, vy, color, state = 'fly') {
    this.game = game;
    this.owner = owner;
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.hw = 0.12; this.hh = 0.12;
    this.color = color;
    this.state = state;
    this.age = 0;
    this.angle = Math.atan2(vy, vx);
    this.spin = rand(-12, 12);
    this.dead = false;
    this.mesh = makeMissile(color);
    game.renderer.entities.add(this.mesh);
    this.sync();
  }

  get pickable() { return this.state !== 'fly' && this.age > 0.3; }

  update(dt) {
    this.age += dt;
    if (this.state === 'fly') this.updateFly(dt);
    else if (this.state === 'drop') this.updateDrop(dt);
    this.sync();
  }

  updateFly(dt) {
    const game = this.game, world = game.world;
    if (world.gravity) this.vy -= MISSILE.gravity * dt;
    const speed = Math.hypot(this.vx, this.vy);
    const steps = Math.max(1, Math.ceil((speed * dt) / 0.12));
    const sx = (this.vx * dt) / steps, sy = (this.vy * dt) / steps;
    this.angle = Math.atan2(this.vy, this.vx);
    const cx = Math.cos(this.angle), cy = Math.sin(this.angle);
    for (let i = 0; i < steps; i++) {
      const nx = this.x + sx, ny = this.y + sy;
      // Test the nose so missiles bury their tip in the wall.
      if (world.solidAt(nx + cx * 0.22, ny + cy * 0.22)) {
        this.x = nx; this.y = ny;
        this.stick();
        return;
      }
      this.x = nx; this.y = ny;
      world.wrapBody(this);
      if (game.missileHits(this)) return;
    }
    if (Math.random() < 0.8) {
      game.particles.emit(this.x - cx * 0.3, this.y - cy * 0.3, 0, -cx * 2 + rand(-0.5, 0.5), -cy * 2 + rand(-0.5, 0.5), 0.3, 0.28, 0.05, this.color, { drag: 4 });
    }
  }

  stick() {
    this.state = 'stuck';
    this.vx = this.vy = 0;
    this.age = 0;
    sfx.stick();
    const cx = Math.cos(this.angle), cy = Math.sin(this.angle);
    this.game.particles.burst(this.x + cx * 0.25, this.y + cy * 0.25, 0xffe0a0, 8, 4, 0.25, 0.18, { drag: 5 });
  }

  // Turn a flying missile into a loose pickup (e.g. after hitting an alien).
  drop(vx = rand(-2, 2), vy = rand(2, 4)) {
    this.state = 'drop';
    this.vx = vx; this.vy = vy;
    this.age = 0;
  }

  updateDrop(dt) {
    const world = this.game.world;
    if (world.gravity) {
      this.vy -= MISSILE.dropGravity * dt;
    } else {
      const k = Math.exp(-1.6 * dt);
      this.vx *= k; this.vy *= k;
    }
    const res = world.move(this, this.vx * dt, this.vy * dt, world.gravity);
    if (res.left || res.right) this.vx *= -0.3;
    if (res.up) this.vy *= -0.3;
    this.angle += this.spin * dt;
    if (world.gravity) {
      if (res.down) {
        this.vy = 0;
        this.vx *= 0.5;
        if (Math.abs(this.vx) < 0.3) this.rest();
      }
    } else {
      if (res.down) this.vy *= -0.3;
      if (Math.hypot(this.vx, this.vy) < 0.25) this.rest();
    }
  }

  rest() {
    this.state = 'stuck';
    this.vx = this.vy = 0;
    if (this.game.world.gravity) this.angle = Math.cos(this.angle) >= 0 ? 0.1 : Math.PI - 0.1;
  }

  sync() {
    const m = this.mesh;
    m.position.set(this.x, this.y, 0.1);
    m.rotation.z = this.angle;
    const glow = m.userData.glow;
    if (this.state === 'fly') {
      glow.material.opacity = 0.7;
      glow.scale.setScalar(0.8);
    } else {
      const p = 0.5 + 0.5 * Math.sin(this.game.time * 6 + this.x);
      glow.material.opacity = 0.35 + p * 0.4;
      glow.scale.setScalar(0.9 + p * 0.4);
    }
  }

  remove() {
    this.dead = true;
    this.game.renderer.entities.remove(this.mesh);
  }
}

export class Crate {
  constructor(game, x, y) {
    this.game = game;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.hw = 0.3; this.hh = 0.25;
    this.age = 0;
    this.dead = false;
    this.mesh = makeCrate();
    game.renderer.entities.add(this.mesh);
    game.particles.burst(x, y, 0xffd36a, 20, 4, 0.5, 0.3);
  }
  update(dt) {
    const world = this.game.world;
    this.age += dt;
    if (world.gravity) {
      this.vy = Math.max(-8, this.vy - 15 * dt);
      const res = world.move(this, 0, this.vy * dt, true);
      if (res.down) this.vy = 0;
    }
    const bob = world.gravity ? 0 : Math.sin(this.age * 2) * 0.1;
    this.mesh.position.set(this.x, this.y + bob, 0);
    this.mesh.rotation.y = Math.sin(this.age * 1.5) * 0.5;
    this.mesh.scale.setScalar(Math.min(1, this.age * 4));
  }
  remove() {
    this.dead = true;
    this.game.renderer.entities.remove(this.mesh);
  }
}

export class Bolt {
  constructor(game, x, y, vx, vy) {
    this.game = game;
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.hw = 0.14; this.hh = 0.14;
    this.life = 4;
    this.dead = false;
    this.mesh = makeBolt();
    game.renderer.entities.add(this.mesh);
  }
  update(dt) {
    const game = this.game;
    this.life -= dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    game.world.wrapBody(this);
    if (this.life <= 0 || game.world.solidAt(this.x, this.y)) {
      game.particles.burst(this.x, this.y, 0x9cff2e, 12, 3, 0.4, 0.25);
      this.remove();
      return;
    }
    if (Math.random() < 0.6) game.particles.emit(this.x, this.y, 0, 0, 0, 0.3, 0.3, 0, 0x9cff2e, { alpha: 0.6 });
    this.mesh.position.set(this.x, this.y, 0.1);
  }
  remove() {
    this.dead = true;
    this.game.renderer.entities.remove(this.mesh);
  }
}

export class Rift {
  constructor(game, x, y, type, duration = 1.1) {
    this.game = game;
    this.x = x; this.y = y;
    this.type = type;
    this.t = 0;
    this.duration = duration;
    this.dead = false;
    this.mesh = makeRift();
    this.mesh.position.set(x, y, 0.2);
    game.renderer.entities.add(this.mesh);
    sfx.rift();
  }
  update(dt) {
    this.t += dt;
    const k = Math.min(1, this.t / this.duration);
    const u = this.mesh.userData;
    u.ring.rotation.z += dt * 6;
    u.ring.scale.setScalar(0.3 + k * 0.9);
    u.inner.material.opacity = 0.3 + k * 0.6;
    if (Math.random() < 0.7) {
      const a = Math.random() * Math.PI * 2;
      this.game.particles.emit(this.x + Math.cos(a) * 1.2, this.y + Math.sin(a) * 1.2, 0, -Math.cos(a) * 3, -Math.sin(a) * 3, 0.35, 0.25, 0.05, 0xc04dff, { drag: 0 });
    }
    if (this.t >= this.duration) {
      this.game.spawnAlien(this.type, this.x, this.y);
      this.game.particles.burst(this.x, this.y, 0xc04dff, 26, 6, 0.5, 0.35);
      this.remove();
    }
  }
  remove() {
    this.dead = true;
    this.game.renderer.entities.remove(this.mesh);
  }
}
