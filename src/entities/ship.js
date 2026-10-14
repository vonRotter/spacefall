import * as THREE from 'three';
import { SHIP, GRAV, ZERO } from '../config.js';
import { makeShip } from '../assets.js';
import { angleDiff, clamp, damp, rand } from '../util.js';
import { sfx } from '../audio.js';

const IDLE = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, aimActive: false, analog: false, thrust: false, fire: false, dash: false };
const OCT = Math.PI / 4;

export class Ship {
  constructor(game, player) {
    this.game = game;
    this.player = player;
    this.color = player.color.hex;
    this.hw = SHIP.halfW;
    this.hh = SHIP.halfH;
    this.mesh = makeShip(this.color);
    this.light = new THREE.PointLight(this.color, 5, 6, 1.4);
    this.light.position.z = 1.2;
    this.mesh.add(this.light);
    this.alive = false;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.roll = 0;
  }

  spawn(pos) {
    this.x = pos.x; this.y = pos.y;
    this.vx = 0; this.vy = 0;
    this.prevY = this.y;
    this.alive = true;
    this.ammo = SHIP.startAmmo;
    this.fuel = 1;
    this.facing = pos.x < this.game.world.w / 2 ? 1 : -1;
    this.aim = this.facing > 0 ? 0 : Math.PI;
    this.roll = this.facing > 0 ? 0 : Math.PI;
    this.dashT = 0;
    this.dashCd = 0;
    this.dashGrace = 0;
    this.fireCd = 0.25;
    this.invuln = this.game.mode === 'pve' ? SHIP.respawnInvuln : 0.4;
    this.shield = false;
    this.spread = 0;
    this.grounded = false;
    this.thrusting = 0;
    this.game.renderer.entities.add(this.mesh);
    this.game.particles.burst(this.x, this.y, this.color, 30, 5, 0.6, 0.35);
    this.sync(0);
  }

  get device() { return this.player.device; }
  get invulnerable() { return this.invuln > 0 || this.dashT > 0 || this.dashGrace > 0; }
  get dashing() { return this.dashT > 0 || this.dashGrace > 0; }

  update(dt) {
    if (!this.alive) return;
    const game = this.game;
    const dev = this.device;
    const locked = game.controlsLocked || !dev || !dev.connected;
    const s = locked ? IDLE : dev.state;
    const pressed = (a) => !locked && dev.hit(a);

    this.invuln = Math.max(0, this.invuln - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.dashGrace = Math.max(0, this.dashGrace - dt);
    this.prevY = this.y;

    this.updateAim(s);

    if (pressed('dash') && this.dashCd <= 0) this.startDash(s);

    if (this.dashT > 0) {
      this.dashT -= dt;
      if (Math.random() < 0.9) game.particles.emit(this.x, this.y, 0, 0, 0, 0.25, 0.55, 0.1, this.color, { alpha: 0.5 });
      if (this.dashT <= 0) this.endDash();
    } else if (game.world.gravity) {
      this.moveGravity(dt, s);
    } else {
      this.moveZeroG(dt, s);
    }

    const dropThrough = game.world.gravity && s.moveY < -0.6;
    const res = game.world.move(this, this.vx * dt, this.vy * dt, game.world.gravity, dropThrough);
    if (game.world.gravity) {
      this.grounded = res.down && this.vy <= 0;
      if (res.down && this.vy < 0) this.vy = 0;
      if (res.up && this.vy > 0) this.vy = 0;
      if (res.left || res.right) this.vx = 0;
    } else {
      if (res.left || res.right) this.vx = -this.vx * ZERO.restitution;
      if (res.up || res.down) this.vy = -this.vy * ZERO.restitution;
    }

    if (pressed('fire') && this.fireCd <= 0) this.fire();
    this.sync(dt);
  }

  updateAim(s) {
    let raw = null;
    let snapped = false;
    if (s.aimActive) {
      raw = Math.atan2(s.aimY, s.aimX);
    } else if (Math.hypot(s.moveX, s.moveY) > 0.3) {
      raw = Math.atan2(s.moveY, s.moveX);
      snapped = !s.analog;
    }
    if (s.moveX > 0.25) this.facing = 1;
    else if (s.moveX < -0.25) this.facing = -1;
    if (raw === null) {
      if (this.game.world.gravity) raw = this.facing > 0 ? 0 : Math.PI;
      else raw = this.aim;
    }
    if (snapped) raw = Math.round(raw / OCT) * OCT;
    this.aim = this.assist(raw, snapped ? 13 : SHIP.aimAssistDeg);
  }

  // Nudge the aim onto a nearby target that is almost lined up.
  assist(angle, deg) {
    const game = this.game;
    const limit = (deg * Math.PI) / 180;
    let best = angle, bestErr = limit;
    for (const t of game.aimTargets(this)) {
      const [dx, dy] = game.world.delta(this.x, this.y, t.x, t.y);
      const d = Math.hypot(dx, dy);
      if (d > SHIP.aimAssistRange || d < 0.5) continue;
      const a = Math.atan2(dy, dx);
      const err = Math.abs(angleDiff(angle, a));
      if (err < bestErr && game.world.lineOfSight(this.x, this.y, t.x, t.y)) { best = a; bestErr = err; }
    }
    return best;
  }

  startDash(s) {
    let dx = s.moveX, dy = s.moveY;
    const m = Math.hypot(dx, dy);
    if (m < 0.3) { dx = Math.cos(this.aim); dy = Math.sin(this.aim); } else { dx /= m; dy /= m; }
    this.vx = dx * SHIP.dashSpeed;
    this.vy = dy * SHIP.dashSpeed;
    this.dashT = SHIP.dashTime;
    this.dashCd = SHIP.dashCooldown;
    this.dashGrace = SHIP.dashInvuln;
    this.fuel = Math.min(1, this.fuel + 0.15);
    sfx.dash();
    this.game.particles.burst(this.x, this.y, 0xffffff, 10, 4, 0.3, 0.3);
  }

  endDash() {
    this.dashT = 0;
    if (this.game.world.gravity) {
      this.vx = clamp(this.vx, -GRAV.maxRun * 1.3, GRAV.maxRun * 1.3);
      this.vy = clamp(this.vy * 0.45, -GRAV.maxFall, GRAV.maxRise);
    } else {
      const sp = Math.hypot(this.vx, this.vy), cap = ZERO.maxSpeed * 1.1;
      if (sp > cap) { this.vx *= cap / sp; this.vy *= cap / sp; }
    }
  }

  moveGravity(dt, s) {
    const g = GRAV;
    const accel = this.grounded ? g.accelGround : g.accelAir;
    if (Math.abs(s.moveX) > 0.1) {
      this.vx += s.moveX * accel * dt;
    } else if (this.grounded) {
      const f = g.frictionGround * dt;
      this.vx = Math.abs(this.vx) <= f ? 0 : this.vx - Math.sign(this.vx) * f;
    } else {
      this.vx *= Math.exp(-g.dragAir * dt);
    }
    if (Math.abs(this.vx) > g.maxRun) this.vx = damp(this.vx, Math.sign(this.vx) * g.maxRun, 10, dt);

    this.vy -= g.gravity * dt;
    const thrust = s.thrust && this.fuel > 0;
    if (thrust) {
      this.vy += g.thrust * dt;
      this.fuel = Math.max(0, this.fuel - g.fuelUse * dt);
      this.thrusting = 1;
      this.emitExhaust(0, -1, 0xffb050);
    } else {
      this.thrusting = Math.max(0, this.thrusting - dt * 6);
      this.fuel = Math.min(g.fuelMax, this.fuel + (this.grounded ? g.fuelRegenGround : g.fuelRegenAir) * dt);
    }
    if (this.vy > g.maxRise) this.vy = damp(this.vy, g.maxRise, 12, dt);
    if (this.vy < -g.maxFall) this.vy = -g.maxFall;
    if (Math.abs(s.moveX) > 0.1 && this.grounded && Math.random() < 0.3) {
      this.game.particles.emit(this.x - this.facing * 0.3, this.y - this.hh, 0, -this.facing * 1.5, 0.5, 0.3, 0.2, 0.05, 0x8899aa, { alpha: 0.4 });
    }
  }

  moveZeroG(dt, s) {
    const z = ZERO;
    const m = Math.hypot(s.moveX, s.moveY);
    // Keyboard layouts share the thrust key with "up", so only gamepads get the zero-g boost.
    const boost = s.thrust && this.fuel > 0 && m > 0.2 && this.device && this.device.kind === 'gamepad';
    const a = z.accel * (boost ? 1.9 : 1);
    this.vx += s.moveX * a * dt;
    this.vy += s.moveY * a * dt;
    const drag = m > 0.1 ? z.drag : z.drag * 2;
    const k = Math.exp(-drag * dt);
    this.vx *= k; this.vy *= k;
    const cap = z.maxSpeed * (boost ? 1.35 : 1);
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > cap) {
      const t = damp(sp, cap, 8, dt) / sp;
      this.vx *= t; this.vy *= t;
    }
    if (boost) {
      this.fuel = Math.max(0, this.fuel - GRAV.fuelUse * dt);
      this.thrusting = 1;
    } else {
      this.thrusting = Math.max(0, this.thrusting - dt * 6);
      this.fuel = Math.min(1, this.fuel + GRAV.fuelRegenAir * 2 * dt);
    }
    if (m > 0.2) this.emitExhaust(s.moveX / m, s.moveY / m, boost ? 0xffd080 : 0x80c8ff, boost);
  }

  emitExhaust(ax, ay, color, strong = true) {
    const p = this.game.particles;
    const n = strong ? 2 : 1;
    for (let i = 0; i < n; i++) {
      p.emit(
        this.x - ax * 0.3 + rand(-0.08, 0.08), this.y - ay * 0.3 + rand(-0.08, 0.08), rand(-0.1, 0.1),
        -ax * rand(4, 7) + this.vx * 0.3, -ay * rand(4, 7) + this.vy * 0.3,
        rand(0.15, 0.3), strong ? 0.42 : 0.3, 0.05, color, { drag: 3 },
      );
    }
  }

  fire() {
    const game = this.game;
    this.fireCd = SHIP.fireCooldown;
    if (this.ammo <= 0) {
      game.addText(this.x, this.y + 0.7, 'EMPTY', '#ff6a6a', 0.6);
      sfx.ui();
      return;
    }
    this.ammo--;
    const angles = [this.aim];
    if (this.spread > 0) {
      this.spread--;
      angles.push(this.aim + 0.2, this.aim - 0.2);
    }
    for (const a of angles) game.spawnMissile(this, a);
    sfx.shoot();
    const cx = Math.cos(this.aim), cy = Math.sin(this.aim);
    if (!game.world.gravity) { this.vx -= cx * 2; this.vy -= cy * 2; }
    game.particles.burst(this.x + cx * 0.5, this.y + cy * 0.5, 0xfff0c0, 6, 3, 0.15, 0.3);
  }

  // Returns 'immune', 'shield' or 'dead'.
  hit(killer, cause, dirX = 0, dirY = 0) {
    if (!this.alive) return 'immune';
    if (this.invulnerable) return 'immune';
    if (this.shield) {
      this.shield = false;
      this.invuln = 1.0;
      this.vx += dirX * 8; this.vy += dirY * 8;
      sfx.shieldBreak();
      this.game.particles.burst(this.x, this.y, 0x7fd8ff, 30, 6, 0.5, 0.3);
      this.device && this.device.rumble(0.4, 120);
      return 'shield';
    }
    this.kill(killer, cause);
    return 'dead';
  }

  kill(killer, cause) {
    if (!this.alive) return;
    const game = this.game;
    this.alive = false;
    game.renderer.entities.remove(this.mesh);
    game.particles.explosion(this.x, this.y, this.color);
    sfx.explode();
    game.shake(0.7, this.x, this.y);
    this.device && this.device.rumble(1, 300);
    for (let i = 0; i < this.ammo; i++) {
      const a = rand(0.3, Math.PI - 0.3);
      game.dropMissile(this.x, this.y, Math.cos(a) * rand(2, 5), Math.sin(a) * rand(3, 7), this.color);
    }
    this.ammo = 0;
    game.onShipKilled(this, killer, cause);
  }

  sync(dt) {
    const m = this.mesh;
    m.position.set(this.x, this.y, 0);
    m.rotation.z = this.aim;
    const targetRoll = Math.cos(this.aim) < -0.05 ? Math.PI : Math.cos(this.aim) > 0.05 ? 0 : this.roll;
    this.roll = dt ? damp(this.roll, targetRoll, 14, dt) : targetRoll;
    const bank = this.game.world.gravity ? clamp(this.vy * 0.04, -0.3, 0.3) : 0;
    m.userData.roll.rotation.x = this.roll + bank;
    const u = m.userData;
    u.engine.material.opacity = 0.35 + this.thrusting * 0.65;
    u.engine.scale.setScalar(0.4 + this.thrusting * 0.5 + Math.random() * 0.08);
    u.shield.visible = this.shield;
    if (this.shield) { u.shield.rotation.y += 0.05; u.shield.rotation.x += 0.03; }
    m.visible = this.invuln <= 0 || Math.floor(this.game.time * 14) % 2 === 0;
    this.light.intensity = this.dashing ? 12 : 5;
  }
}
