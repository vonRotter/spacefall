// One match: owns the entities, runs PvP rounds or PvE waves, resolves collisions.

import { GRAV, MISSILE, PVE, PVP, SHIP } from './config.js';
import { Ship } from './entities/ship.js';
import { Missile, Crate, Bolt, Rift } from './entities/items.js';
import { Alien } from './entities/aliens.js';
import { View, computeLayout } from './views.js';
import { sfx } from './audio.js';
import { pick, rand, shuffle } from './util.js';

export const SHARED_BAR = 50;
const SHARED_MAX_W = 36;
const SHARED_MAX_H = 22;

export class Game {
  constructor({ renderer, world, players, mode, settings, onEnd }) {
    this.renderer = renderer;
    this.particles = renderer.particles;
    this.world = world;
    this.players = players;
    this.mode = mode;
    this.settings = settings;
    this.onEnd = onEnd;
    renderer.setLevel(world);
    renderer.clearEntities();

    this.time = 0;
    this.missiles = [];
    this.aliens = [];
    this.crates = [];
    this.bolts = [];
    this.rifts = [];
    this.texts = [];
    this.banner = null;
    this.controlsLocked = true;
    this.alienSpeedScale = 1;
    this.flowT = 0;
    this.round = 0;
    this.wave = 0;
    this.over = false;

    for (const p of players) {
      Object.assign(p, { score: 0, wins: 0, kills: 0, deaths: 0, lives: settings.lives, respawnT: 0, deathPos: null });
      p.ship = new Ship(this, p);
    }
    this.shared = world.w <= SHARED_MAX_W && world.h <= SHARED_MAX_H;
    this.views = this.makeViews();

    if (mode === 'pvp') this.startRound();
    else this.startPve();
  }

  // ---------------------------------------------------------------------------
  // Views

  makeViews() {
    if (this.shared) return [new View('shared')];
    const views = this.players.map((p) => new View('follow', p));
    if (views.length === 3) views.push(new View('overview'));
    return views;
  }

  layout(W, H) {
    // The single shared screen reserves a strip at the top for the HUD so panels never cover the arena.
    const rects = this.shared ? [{ x: 0, y: SHARED_BAR, w: W, h: H - SHARED_BAR }] : computeLayout(this.views.length, W, H);
    this.views.forEach((v, i) => v.setRect(rects[i], H));
  }

  shake(amount, x, y) {
    for (const v of this.views) v.addShake(amount, x, y);
  }

  // ---------------------------------------------------------------------------
  // Helpers used by entities

  ships() { return this.players.map((p) => p.ship); }
  aliveShips() { return this.ships().filter((s) => s.alive); }

  aimTargets(ship) {
    const out = this.aliens.filter((a) => !a.dead);
    if (this.mode === 'pvp') for (const s of this.ships()) if (s !== ship && s.alive) out.push(s);
    return out;
  }

  addText(x, y, text, color = '#fff', life = 1) {
    this.texts.push({ x, y, text, color, t: 0, life });
  }

  setBanner(text, sub = '', life = 2, color = '#fff') {
    this.banner = { text, sub, t: 0, life, color };
  }

  spawnMissile(ship, angle) {
    const cx = Math.cos(angle), cy = Math.sin(angle);
    let x = ship.x + cx * 0.45, y = ship.y + cy * 0.45;
    if (this.world.solidAt(x, y)) { x = ship.x; y = ship.y; }
    this.missiles.push(new Missile(this, ship, x, y, cx * MISSILE.speed, cy * MISSILE.speed, ship.color));
    this.capMissiles();
  }

  dropMissile(x, y, vx, vy, color) {
    this.missiles.push(new Missile(this, null, x, y, vx, vy, color, 'drop'));
    this.capMissiles();
  }

  capMissiles() {
    if (this.missiles.length <= 70) return;
    const old = this.missiles.find((m) => m.state === 'stuck');
    if (old) old.remove();
  }

  spawnBolt(x, y, vx, vy) {
    this.bolts.push(new Bolt(this, x, y, vx, vy));
  }

  spawnAlien(type, x, y) {
    if (type === 'crawler' && !this.world.gravity) type = 'spore';
    if (type === 'spore' && this.world.gravity) type = 'crawler';
    this.aliens.push(new Alien(this, type, x, y));
  }

  riftAt(type, pos) {
    this.rifts.push(new Rift(this, pos.x, pos.y, type));
  }

  // Pick a spawn location for an alien away from all ships.
  alienSpawnPos() {
    const ships = this.aliveShips();
    const rifts = shuffle(this.world.rifts.slice());
    for (const r of rifts) {
      if (ships.every((s) => this.world.dist(s, r) > 7)) return r;
    }
    return this.world.randomOpen(ships, 8);
  }

  relocateAlien(alien) {
    const ships = this.aliveShips();
    if (!ships.length) return;
    for (let i = 0; i < 50; i++) {
      const c = pick(this.world.openCells);
      const d = Math.min(...ships.map((s) => this.world.dist(s, c)));
      if (d > 6 && d < 14) {
        alien.remove();
        this.riftAt(alien.type, c);
        return;
      }
    }
  }

  spawnCrate() {
    const ships = this.aliveShips();
    const spots = shuffle(this.world.crates.slice());
    let pos = spots.find((c) => ships.every((s) => this.world.dist(s, c) > 3) && this.crates.every((k) => this.world.dist(k, c) > 2));
    if (!pos) pos = this.world.randomOpen(ships, 4);
    this.crates.push(new Crate(this, pos.x, pos.y));
  }

  // Choose `n` spawn points spread far apart.
  spreadSpawns(n, avoid = []) {
    const pts = shuffle(this.world.spawns.slice());
    const chosen = [];
    while (chosen.length < n && pts.length) {
      let best = 0, bestD = -1;
      pts.forEach((p, i) => {
        const others = [...chosen, ...avoid];
        const d = others.length ? Math.min(...others.map((o) => this.world.dist(o, p))) : Math.random();
        if (d > bestD) { bestD = d; best = i; }
      });
      chosen.push(pts.splice(best, 1)[0]);
    }
    while (chosen.length < n) chosen.push(this.world.randomOpen(chosen, 4));
    return chosen;
  }

  clearRoundEntities() {
    for (const list of [this.missiles, this.aliens, this.crates, this.bolts, this.rifts]) {
      for (const e of list) e.remove();
      list.length = 0;
    }
    for (const s of this.ships()) if (s.alive) { s.alive = false; this.renderer.entities.remove(s.mesh); }
    this.texts.length = 0;
    this.particles.clear();
  }

  // ---------------------------------------------------------------------------
  // PvP

  startRound() {
    this.clearRoundEntities();
    this.round++;
    const spawns = this.spreadSpawns(this.players.length);
    this.players.forEach((p, i) => p.ship.spawn(spawns[i]));
    for (const v of this.views) v.snap = true;
    this.controlsLocked = true;
    this.phase = 'ready';
    this.phaseT = PVP.readyTime;
    this.crateT = rand(...PVP.crateInterval);
    this.alienT = rand(...PVP.alienInterval);
    this.setBanner(`ROUND ${this.round}`, `First to ${this.settings.rounds} wins`, PVP.readyTime);
  }

  updatePvp(dt) {
    if (this.phase === 'ready') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        this.phase = 'play';
        this.controlsLocked = false;
        this.setBanner('FIGHT!', '', 0.7, '#ffd36a');
      }
      return;
    }
    if (this.phase === 'play') {
      this.crateT -= dt;
      if (this.crateT <= 0) {
        this.crateT = rand(...PVP.crateInterval);
        if (this.crates.length < 2) this.spawnCrate();
      }
      if (this.settings.hazards) {
        this.alienT -= dt;
        if (this.alienT <= 0) {
          this.alienT = rand(...PVP.alienInterval);
          if (this.aliens.length + this.rifts.length < PVP.maxHazardAliens) {
            this.riftAt(Math.random() < 0.6 ? 'wisp' : 'crawler', this.world.randomOpen(this.aliveShips(), 7));
          }
        }
      }
      if (this.aliveShips().length <= 1) {
        this.phase = 'roundEnd';
        this.phaseT = PVP.roundEndDelay;
      }
      return;
    }
    if (this.phase === 'roundEnd') {
      this.phaseT -= dt;
      if (this.phaseT > 0) return;
      const alive = this.aliveShips();
      const winner = alive.length === 1 ? alive[0].player : null;
      if (winner) {
        winner.wins++;
        winner.score = winner.wins;
        sfx.round();
        this.setBanner(`${winner.name} WINS THE ROUND`, this.scoreLine(), 2.6, winner.color.css);
      } else {
        this.setBanner('DRAW', this.scoreLine(), 2.6);
      }
      if (winner && winner.wins >= this.settings.rounds) {
        this.phase = 'matchEnd';
        this.phaseT = 2.6;
        this.matchWinner = winner;
      } else {
        this.phase = 'between';
        this.phaseT = 2.6;
      }
      return;
    }
    if (this.phase === 'between') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.startRound();
      return;
    }
    if (this.phase === 'matchEnd') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.finish({ winner: this.matchWinner });
    }
  }

  scoreLine() {
    return this.players.map((p) => `${p.name} ${p.wins}`).join('   ·   ');
  }

  // ---------------------------------------------------------------------------
  // PvE

  startPve() {
    this.clearRoundEntities();
    const spawns = this.spreadSpawns(this.players.length);
    this.players.forEach((p, i) => p.ship.spawn(spawns[i]));
    for (const v of this.views) v.snap = true;
    this.controlsLocked = true;
    this.phase = 'ready';
    this.phaseT = 1.6;
    this.setBanner('HOLD THE LINE', 'Clear every wave of aliens', 1.6);
  }

  nextWave() {
    this.wave++;
    this.alienSpeedScale = Math.min(1.55, 1 + (this.wave - 1) * 0.05);
    this.queue = this.composeWave(this.wave);
    this.spawnT = 0.8;
    this.phase = 'wave';
    this.controlsLocked = false;
    sfx.wave();
    this.setBanner(`WAVE ${this.wave}`, `${this.queue.length} hostiles inbound`, 1.8, '#c08cff');
  }

  composeWave(n) {
    const players = this.players.length;
    const total = Math.round((4 + n * 2) * (0.7 + 0.3 * players));
    const basic = this.world.gravity ? 'crawler' : 'spore';
    const weights = [[basic, 0.55], ['wisp', 0.45]];
    if (n >= 3) weights.push(['spitter', 0.15 + 0.02 * (n - 3)]);
    if (n >= 5) weights.push(['brute', 0.08 + 0.02 * (n - 5)]);
    const sum = weights.reduce((a, w) => a + w[1], 0);
    const list = [];
    for (let i = 0; i < total; i++) {
      let r = Math.random() * sum;
      for (const [t, w] of weights) { r -= w; if (r <= 0) { list.push(t); break; } }
    }
    // Make sure a newly introduced type actually shows up.
    if (n === 3) list[0] = 'spitter';
    if (n === 5) list[0] = 'brute';
    if (n % 5 === 0) for (let i = 0; i < Math.floor(n / 5); i++) list.push('brute');
    return shuffle(list);
  }

  updatePve(dt) {
    // Respawns.
    for (const p of this.players) {
      if (p.ship.alive || p.lives <= 0 || p.respawnT <= 0) continue;
      p.respawnT -= dt;
      if (p.respawnT <= 0) {
        const avoid = this.aliens.filter((a) => !a.dead);
        p.ship.spawn(this.spreadSpawns(1, avoid)[0]);
      }
    }
    if (this.phase === 'ready') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.nextWave();
    } else if (this.phase === 'wave') {
      const maxActive = Math.min(16, 4 + 2 * this.players.length + Math.floor(this.wave / 2));
      this.spawnT -= dt;
      if (this.queue.length && this.spawnT <= 0 && this.aliens.length + this.rifts.length < maxActive) {
        this.spawnT = rand(...PVE.spawnInterval);
        this.riftAt(this.queue.pop(), this.alienSpawnPos());
      }
      if (!this.queue.length && !this.aliens.length && !this.rifts.length) {
        this.phase = 'break';
        this.phaseT = PVE.waveBreak;
        sfx.round();
        this.setBanner('WAVE CLEARED', 'Supplies dropped', 2.2, '#7dff4a');
        const crates = 1 + Math.floor(this.players.length / 2);
        for (let i = 0; i < crates; i++) this.spawnCrate();
        // Teammates who ran out of lives rejoin with one.
        for (const p of this.players) {
          if (!p.ship.alive && p.lives <= 0) { p.lives = 1; p.respawnT = 0.8; }
        }
      }
    } else if (this.phase === 'break') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.nextWave();
    } else if (this.phase === 'gameOver') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.finish({ wave: this.wave });
      return;
    }
    if (this.players.every((p) => !p.ship.alive && p.lives <= 0)) {
      this.phase = 'gameOver';
      this.phaseT = 3;
      sfx.gameOver();
      this.setBanner('OVERRUN', `You reached wave ${this.wave}`, 3, '#ff6a6a');
    }
  }

  // ---------------------------------------------------------------------------
  // Events

  onShipKilled(ship, killer, cause) {
    const p = ship.player;
    p.deaths++;
    p.deathPos = { x: ship.x, y: ship.y, vx: 0, vy: 0 };
    const kp = killer && killer.player ? killer.player : killer;
    if (kp && kp !== p && this.mode === 'pvp') {
      kp.kills++;
      this.addText(ship.x, ship.y + 0.8, `${kp.name} ▸ ${p.name}`, kp.color.css, 1.4);
    } else if (kp === p) {
      this.addText(ship.x, ship.y + 0.8, 'OWN GOAL', '#ff6a6a', 1.4);
    }
    if (this.mode === 'pve') {
      p.lives--;
      if (p.lives > 0) p.respawnT = PVE.respawnDelay;
    }
  }

  onAlienKilled(alien, by) {
    const p = by && by.player ? by.player : by;
    if (p && this.mode === 'pve') {
      p.score += alien.T.score;
      p.kills++;
      this.addText(alien.x, alien.y + 0.5, `+${alien.T.score}`, p.color.css, 0.9);
    } else if (p) {
      p.kills++;
    }
    if (Math.random() < 0.14) this.dropMissile(alien.x, alien.y, rand(-2, 2), rand(2, 5), 0xcfd6e6);
  }

  finish(extra) {
    if (this.over) return;
    this.over = true;
    this.onEnd({ mode: this.mode, players: this.players, wave: this.wave, ...extra });
  }

  // ---------------------------------------------------------------------------
  // Main update

  update(dt) {
    this.time += dt;
    if (this.mode === 'pvp') this.updatePvp(dt);
    else this.updatePve(dt);

    if (this.aliens.length) {
      this.flowT -= dt;
      if (this.flowT <= 0) {
        this.flowT = 0.3;
        this.world.computeFlow(this.aliveShips());
      }
    }

    for (const s of this.ships()) s.update(dt);
    for (const m of this.missiles) if (!m.dead) m.update(dt);
    for (const r of this.rifts) if (!r.dead) r.update(dt);
    for (const a of this.aliens) if (!a.dead) a.update(dt);
    for (const b of this.bolts) if (!b.dead) b.update(dt);
    for (const c of this.crates) if (!c.dead) c.update(dt);

    this.separateAliens();
    this.collide();

    this.missiles = this.missiles.filter((e) => !e.dead);
    this.aliens = this.aliens.filter((e) => !e.dead);
    this.rifts = this.rifts.filter((e) => !e.dead);
    this.bolts = this.bolts.filter((e) => !e.dead);
    this.crates = this.crates.filter((e) => !e.dead);

    for (const t of this.texts) { t.t += dt; t.y += dt * 0.7; }
    this.texts = this.texts.filter((t) => t.t < t.life);
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t > this.banner.life) this.banner = null;
    }
    this.particles.update(dt);
  }

  // Called by a flying missile after each sub-step. Returns true if the missile was consumed.
  missileHits(m) {
    const w = this.world;
    const dx = Math.cos(m.angle), dy = Math.sin(m.angle);
    if (this.mode === 'pvp') {
      for (const s of this.ships()) {
        if (!s.alive) continue;
        if (s === m.owner && m.age < MISSILE.ownerGrace) continue;
        if (!w.overlaps(s, m)) continue;
        if (s.dashing) {
          if (s.ammo < SHIP.maxAmmo) {
            s.ammo++;
            this.addText(s.x, s.y + 0.7, 'CATCH!', s.player.color.css, 0.8);
            sfx.catch();
            m.remove();
          } else {
            m.drop();
          }
          return true;
        }
        const r = s.hit(m.owner, 'missile', dx, dy);
        if (r === 'immune') continue;
        m.drop(-m.vx * 0.1, 3);
        return true;
      }
    }
    for (const a of this.aliens) {
      if (a.dead || !w.overlaps(a, m)) continue;
      a.damage(1, m.owner, dx, dy);
      m.drop(-m.vx * 0.1, 3);
      return true;
    }
    return false;
  }

  separateAliens() {
    const list = this.aliens;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dead || !a.flying) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.dead || !b.flying) continue;
        const [dx, dy] = this.world.delta(a.x, a.y, b.x, b.y);
        const min = a.hw + b.hw;
        const d2 = dx * dx + dy * dy;
        if (d2 > min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), push = (min - d) * 0.5;
        a.vx -= (dx / d) * push * 6; a.vy -= (dy / d) * push * 6;
        b.vx += (dx / d) * push * 6; b.vy += (dy / d) * push * 6;
      }
    }
  }

  collide() {
    const w = this.world;
    const ships = this.aliveShips();

    // Alien bolts.
    for (const b of this.bolts) {
      if (b.dead) continue;
      for (const s of ships) {
        if (!s.alive || !w.overlaps(s, b)) continue;
        if (s.hit(null, 'acid', Math.sign(b.vx), Math.sign(b.vy)) !== 'immune') { b.remove(); break; }
      }
    }

    // Ships vs aliens (stomps in gravity maps).
    for (const s of ships) {
      for (const a of this.aliens) {
        if (!s.alive || a.dead || !w.overlaps(s, a)) continue;
        const fromAbove = w.gravity && s.prevY - s.hh >= a.y + a.hh - 0.25 && s.vy <= 0.5;
        if (fromAbove) {
          a.damage(1, s, 0, -1);
          s.vy = GRAV.stompBounce;
          sfx.stomp();
          continue;
        }
        const [dx, dy] = w.delta(a.x, a.y, s.x, s.y);
        const m = Math.hypot(dx, dy) || 1;
        s.hit(null, 'alien', dx / m, dy / m);
      }
    }

    // Ship vs ship: stomps in PvP gravity maps, otherwise a bump.
    for (let i = 0; i < ships.length; i++) {
      for (let j = i + 1; j < ships.length; j++) {
        const a = ships[i], b = ships[j];
        if (!a.alive || !b.alive || !w.overlaps(a, b)) continue;
        if (this.mode === 'pvp' && w.gravity && this.tryStomp(a, b)) continue;
        if (this.mode === 'pvp' && w.gravity && this.tryStomp(b, a)) continue;
        this.bump(a, b);
      }
    }

    // Pickups.
    for (const s of this.aliveShips()) {
      for (const m of this.missiles) {
        if (m.dead || !m.pickable || s.ammo >= SHIP.maxAmmo) continue;
        if (w.dist(s, m) > MISSILE.pickupRadius) continue;
        s.ammo++;
        m.remove();
        sfx.pickup();
        this.addText(s.x, s.y + 0.6, '+1', s.player.color.css, 0.6);
      }
      for (const c of this.crates) {
        if (c.dead || c.age < 0.3 || !w.overlaps(s, c)) continue;
        this.openCrate(s, c);
      }
    }
  }

  tryStomp(top, bottom) {
    if (top.prevY - top.hh < bottom.y + bottom.hh - 0.18) return false;
    if (top.vy > bottom.vy - GRAV.stompSpeed) return false;
    top.vy = GRAV.stompBounce;
    sfx.stomp();
    if (bottom.hit(top, 'stomp', 0, -1) === 'dead') this.addText(bottom.x, bottom.y + 0.8, 'STOMPED', top.player.color.css, 1.2);
    return true;
  }

  bump(a, b) {
    const [dx, dy] = this.world.delta(a.x, a.y, b.x, b.y);
    const ox = a.hw + b.hw - Math.abs(dx), oy = a.hh + b.hh - Math.abs(dy);
    if (ox < oy) {
      const sx = Math.sign(dx) || 1;
      this.world.move(a, -sx * ox / 2, 0);
      this.world.move(b, sx * ox / 2, 0);
      const avg = (a.vx + b.vx) / 2;
      a.vx = avg - sx * 2; b.vx = avg + sx * 2;
    } else {
      const sy = Math.sign(dy) || 1;
      this.world.move(a, 0, -sy * oy / 2);
      this.world.move(b, 0, sy * oy / 2);
      const avg = (a.vy + b.vy) / 2;
      a.vy = avg - sy * 1.5; b.vy = avg + sy * 1.5;
    }
  }

  openCrate(ship, crate) {
    crate.remove();
    sfx.crate();
    this.particles.burst(crate.x, crate.y, 0xffd36a, 30, 6, 0.6, 0.35);
    const r = Math.random();
    const css = ship.player.color.css;
    if (r < 0.42) {
      ship.ammo = Math.min(SHIP.maxAmmo, ship.ammo + 2);
      this.addText(crate.x, crate.y + 0.6, '+2 MISSILES', css, 1.2);
    } else if (r < 0.72 && !ship.shield) {
      ship.shield = true;
      sfx.shield();
      this.addText(crate.x, crate.y + 0.6, 'SHIELD', '#7fd8ff', 1.2);
    } else {
      ship.spread += 3;
      ship.ammo = Math.min(SHIP.maxAmmo, ship.ammo + 1);
      this.addText(crate.x, crate.y + 0.6, 'TRIPLE SHOT ×3', '#ffd36a', 1.2);
    }
  }

  updateViews(dt) {
    for (const v of this.views) v.update(dt, this);
  }

  dispose() {
    this.clearRoundEntities();
    this.renderer.clearEntities();
  }
}
