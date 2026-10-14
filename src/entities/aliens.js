// Alien types and their behavior.
//   crawler  walks along floors and hops (gravity maps only)
//   spore    slow drifting spiky blob (zero-g stand-in for the crawler)
//   wisp     fast flying drone that weaves toward players
//   spitter  keeps its distance and lobs acid bolts when it has line of sight
//   brute    tough; winds up and charges in a straight line

import { makeCrawler, makeSpore, makeWisp, makeSpitter, makeBrute } from '../assets.js';
import { sfx } from '../audio.js';
import { damp, rand } from '../util.js';
import { PLATFORM } from '../world.js';

export const ALIEN_TYPES = {
  crawler: { hp: 1, hw: 0.34, hh: 0.24, speed: 2.6, score: 100, make: makeCrawler, color: 0x52c247 },
  spore: { hp: 1, hw: 0.3, hh: 0.3, speed: 2.3, score: 100, make: makeSpore, color: 0x8dff4a },
  wisp: { hp: 1, hw: 0.28, hh: 0.28, speed: 3.9, score: 100, make: makeWisp, color: 0xb455ff },
  spitter: { hp: 2, hw: 0.38, hh: 0.36, speed: 2.5, score: 200, make: makeSpitter, color: 0xd9c23a },
  brute: { hp: 4, hw: 0.45, hh: 0.45, speed: 2.1, score: 400, make: makeBrute, color: 0xff4a3a },
};

export class Alien {
  constructor(game, type, x, y) {
    const T = ALIEN_TYPES[type];
    this.game = game;
    this.type = type;
    this.T = T;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.hw = T.hw; this.hh = T.hh;
    this.hp = T.hp;
    this.speed = T.speed * game.alienSpeedScale;
    this.dead = false;
    this.t = rand(0, 10);
    this.flash = 0;
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.grounded = false;
    this.hopCd = 1;
    this.losT = 0;
    this.los = false;
    this.target = null;
    this.idleT = 0;
    this.shootCd = rand(1.2, 2.4);
    this.windup = 0;
    this.state = 'move';
    this.stateT = 0;
    this.chargeCd = 2;
    this.mesh = T.make();
    game.renderer.entities.add(this.mesh);
  }

  get flying() { return this.type !== 'crawler'; }

  update(dt) {
    const game = this.game;
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt);
    this.findTarget(dt);
    if (this.type === 'crawler') this.updateCrawler(dt);
    else this.updateFlyer(dt);
    this.sync(dt);
    // Aliens that never find anyone get re-rifted closer to the action.
    if (this.target && game.world.dist(this, this.target) < 13) this.idleT = 0;
    else this.idleT += dt;
    if (this.idleT > 12) {
      this.idleT = 0;
      game.relocateAlien(this);
    }
  }

  findTarget(dt) {
    const game = this.game;
    let best = null, bestD = Infinity;
    for (const s of game.ships()) {
      if (!s.alive) continue;
      const d = game.world.dist(this, s);
      if (d < bestD) { bestD = d; best = s; }
    }
    this.target = best;
    this.targetDist = bestD;
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.2;
      this.los = !!best && bestD < 16 && game.world.lineOfSight(this.x, this.y, best.x, best.y);
    }
  }

  updateCrawler(dt) {
    const world = this.game.world;
    const tgt = this.target;
    let speed = this.speed;
    let dropThrough = false;
    this.hopCd -= dt;
    // The flow field ignores gravity, but its horizontal hint plus hops and drops gets crawlers between decks.
    const flow = world.flowDir(this.x, this.y);
    if (this.grounded) {
      let chasing = false;
      if (tgt) {
        const [dx, dy] = world.delta(this.x, this.y, tgt.x, tgt.y);
        if (Math.abs(dy) < 1.6 && Math.abs(dx) < 9 && this.los) {
          this.dir = Math.sign(dx) || this.dir;
          speed *= 1.6;
          chasing = true;
        }
        if (dy > 1.4 && Math.abs(dx) < 3.5 && this.hopCd <= 0) {
          this.vy = 12.5; this.hopCd = 1.6;
          this.dir = Math.sign(dx) || this.dir;
        }
      }
      if (!chasing && flow) {
        if (Math.abs(flow[0]) > 0.3) this.dir = Math.sign(flow[0]);
        if (flow[1] > 0.6 && this.hopCd <= 0) { this.vy = 12.5; this.hopCd = 1.4; }
        if (flow[1] < -0.6) dropThrough = true;
      }
      // Turn around at ledges unless the path leads down.
      const ax = Math.floor(this.x + this.dir * (this.hw + 0.15));
      const by = Math.floor(this.y - this.hh - 0.2);
      const floorAhead = world.solid(ax, by) || world.tile(ax, by) === PLATFORM;
      const wantDown = (flow && flow[1] < -0.3) || (tgt && tgt.y < this.y - 1);
      if (!floorAhead && !wantDown && Math.random() < 0.94) this.dir = -this.dir;
    }
    this.vx = damp(this.vx, this.dir * speed, 10, dt);
    this.vy = Math.max(-12, this.vy - 18 * dt);
    const res = world.move(this, this.vx * dt, this.vy * dt, true, dropThrough);
    if (res.left || res.right) {
      // Hop over low obstacles before turning around.
      if (this.grounded && this.hopCd <= 0 && !world.solid(Math.floor(this.x + this.dir), Math.floor(this.y + 1))) {
        this.vy = 9; this.hopCd = 0.8;
      } else {
        this.dir = -this.dir;
      }
      this.vx = 0;
    }
    this.grounded = res.down;
    if (res.down || (res.up && this.vy > 0)) this.vy = 0;
  }

  updateFlyer(dt) {
    const game = this.game, world = game.world;
    const tgt = this.target;
    let dx = 0, dy = 0;
    let toT = null;
    if (tgt) {
      const [ddx, ddy] = world.delta(this.x, this.y, tgt.x, tgt.y);
      const d = Math.hypot(ddx, ddy) || 1;
      toT = [ddx / d, ddy / d, d];
    }
    if (toT && this.los && toT[2] < 12) { dx = toT[0]; dy = toT[1]; }
    else {
      const f = world.flowDir(this.x, this.y);
      if (f) { dx = f[0]; dy = f[1]; }
      else if (toT) { dx = toT[0]; dy = toT[1]; }
    }
    let speed = this.speed;
    let rate = 3;

    if (this.type === 'wisp') {
      const w = Math.sin(this.t * 4) * 0.8;
      dx += -dy * w; dy += dx * w;
    } else if (this.type === 'spitter') {
      if (toT && this.los) {
        const d = toT[2];
        if (d < 4.5) { dx = -toT[0]; dy = -toT[1]; }
        else if (d < 7.5) {
          const side = Math.sin(this.t * 0.7) > 0 ? 1 : -1;
          dx = -toT[1] * side * 0.7; dy = toT[0] * side * 0.7;
        }
        this.shootCd -= dt;
        if (this.shootCd <= 0 && d < 12 && this.windup <= 0) { this.windup = 0.5; }
      }
      if (this.windup > 0) {
        this.windup -= dt;
        speed *= 0.2;
        if (this.windup <= 0 && tgt) {
          this.shootCd = rand(1.8, 2.8) / game.alienSpeedScale;
          const [ex, ey] = world.delta(this.x, this.y, tgt.x + tgt.vx * 0.3, tgt.y + tgt.vy * 0.2);
          const m = Math.hypot(ex, ey) || 1;
          game.spawnBolt(this.x + (ex / m) * 0.4, this.y + (ey / m) * 0.4, (ex / m) * 7.5, (ey / m) * 7.5);
          sfx.spit();
        }
      }
    } else if (this.type === 'brute') {
      this.stateT -= dt;
      this.chargeCd -= dt;
      if (this.state === 'move' && toT && this.los && toT[2] < 8.5 && this.chargeCd <= 0) {
        this.state = 'windup';
        this.stateT = 0.65;
        this.chargeDir = [toT[0], toT[1]];
        sfx.charge();
      }
      if (this.state === 'windup') {
        speed = 0; rate = 8;
        if (this.stateT <= 0) { this.state = 'charge'; this.stateT = 0.75; }
      } else if (this.state === 'charge') {
        dx = this.chargeDir[0]; dy = this.chargeDir[1];
        speed = 11.5; rate = 20;
        if (Math.random() < 0.8) game.particles.emit(this.x, this.y, 0, 0, 0, 0.35, 0.9, 0.1, 0xff4a3a, { alpha: 0.4 });
        if (this.stateT <= 0) { this.state = 'move'; this.chargeCd = rand(2.2, 3.2); }
      } else if (this.state === 'stun') {
        speed = 0; rate = 4;
        if (this.stateT <= 0) this.state = 'move';
      }
    } else {
      const w = Math.sin(this.t * 2) * 0.3;
      dx += -dy * w; dy += dx * w;
    }

    const m = Math.hypot(dx, dy) || 1;
    this.vx = damp(this.vx, (dx / m) * speed, rate, dt);
    this.vy = damp(this.vy, (dy / m) * speed, rate, dt);
    const res = world.move(this, this.vx * dt, this.vy * dt, false);
    const hitWall = res.left || res.right || res.up || res.down;
    if (res.left || res.right) this.vx *= -0.4;
    if (res.up || res.down) this.vy *= -0.4;
    if (hitWall && this.state === 'charge') {
      this.state = 'stun';
      this.stateT = 0.7;
      this.chargeCd = rand(2.2, 3.2);
      game.shake(0.4, this.x, this.y);
      game.particles.burst(this.x, this.y, 0xccbbaa, 16, 5, 0.4, 0.35);
    }
  }

  damage(n, by, dirX = 0, dirY = 0) {
    if (this.dead) return false;
    this.hp -= n;
    this.flash = 0.15;
    const kb = this.type === 'brute' ? 3 : 6;
    this.vx += dirX * kb; this.vy += dirY * kb;
    if (this.state === 'charge') { this.state = 'stun'; this.stateT = 0.4; }
    sfx.hit();
    this.game.particles.burst(this.x, this.y, this.T.color, 10, 4, 0.35, 0.3);
    if (this.hp <= 0) { this.die(by); return true; }
    return false;
  }

  die(by) {
    if (this.dead) return;
    const game = this.game;
    this.remove();
    game.particles.explosion(this.x, this.y, this.T.color, this.type === 'brute');
    game.particles.burst(this.x, this.y, 0x9cff2e, 14, 4, 0.8, 0.3, { gravity: game.world.gravity ? 8 : 0 });
    sfx.explode(this.type === 'brute');
    game.shake(this.type === 'brute' ? 0.6 : 0.25, this.x, this.y);
    game.onAlienKilled(this, by);
  }

  remove() {
    this.dead = true;
    this.game.renderer.entities.remove(this.mesh);
  }

  sync() {
    const m = this.mesh, u = m.userData;
    m.position.set(this.x, this.y, 0);
    const pulse = 1 + this.flash * 2;
    m.scale.setScalar(pulse);
    if (this.type === 'crawler') {
      m.rotation.y = this.dir > 0 ? 0 : Math.PI;
      u.legs.forEach((l, i) => { l.rotation.z = Math.sin(this.t * 16 + i * 1.7) * 0.45; });
      u.body.scale.y = 0.72 + Math.sin(this.t * 8) * 0.04;
    } else if (this.type === 'wisp') {
      u.ring.rotation.x = this.t * 3;
      u.ring.rotation.y = this.t * 2;
      u.core.rotation.z = this.t * 2;
    } else if (this.type === 'spore') {
      m.rotation.z = this.t * 0.8;
    } else if (this.type === 'spitter') {
      m.rotation.y = this.target && this.target.x < this.x ? Math.PI : 0;
      u.tentacles.forEach((t, i) => { t.rotation.z = Math.sin(this.t * 4 + i) * 0.35; });
      const w = this.windup > 0 ? 1 - this.windup / 0.5 : 0;
      u.glow.material.opacity = w * 0.9;
      u.sac.scale.set(1 + w * 0.15, 0.9 + w * 0.15, 0.9);
    } else if (this.type === 'brute') {
      const facing = this.state === 'charge' && this.chargeDir ? this.chargeDir[0] : (this.target ? this.target.x - this.x : 1);
      m.rotation.y = facing < 0 ? Math.PI : 0;
      const wind = this.state === 'windup';
      u.glow.material.opacity = wind ? 0.5 + Math.sin(this.t * 40) * 0.3 : this.state === 'charge' ? 0.6 : 0;
      if (wind) m.position.x += Math.sin(this.t * 60) * 0.05;
      u.body.rotation.z = this.state === 'stun' ? Math.sin(this.t * 20) * 0.2 : 0;
    }
  }
}
