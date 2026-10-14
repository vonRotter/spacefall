// Fast gameplay simulation: simple bots play every map in PvP and PvE for several
// minutes of game time (no rendering), then we check that the match logic progressed.
// Usage: node tools/sim-test.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { serve } from './serve.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const req = createRequire(path.join(execSync('npm root -g').toString().trim(), 'noop.js'));
  ({ chromium } = req('playwright'));
}

const PORT = 8766;
const server = await serve(PORT);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + e.stack));
await page.addInitScript(() => {
  const mk = (i) => ({ index: i, id: `Xbox Controller ${i} (045e)`, connected: true, mapping: 'standard', timestamp: 0,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] });
  window.__pads = [mk(0), mk(1), mk(2), mk(3)];
  navigator.getGamepads = () => window.__pads;
});
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.spacefall && window.spacefall.renderer.level);

const scenarios = [];
for (const map of ['hub', 'drift', 'cargo', 'kessler', 'hive', 'failure']) {
  scenarios.push({ map, mode: 'pvp', players: 4, seconds: 150 });
  scenarios.push({ map, mode: 'pve', players: 2, seconds: 240 });
}
scenarios.push({ map: 'cargo', mode: 'pve', players: 1, seconds: 180 });
scenarios.push({ map: 'hub', mode: 'pve', players: 4, seconds: 300 });

let failed = false;
for (const sc of scenarios) {
  const r = await page.evaluate((sc) => {
    const app = window.spacefall;
    app.input.poll();
    app.players.length = 0;
    for (let i = 0; i < sc.players; i++) app.join(app.input.get(`gp${i}`));
    app.startGame({ mode: sc.mode, rounds: 5, lives: 3, hazards: true, mapDef: app.maps.find((m) => m.id === sc.map) });
    const game = app.game;
    const w = game.world;
    const dt = 1 / 60;
    const stats = { aliensSeen: 0, maxAliens: 0, shots: 0, pickups: 0, stuckFrames: 0, maxRound: 0, maxWave: 0, ended: null };
    let ended = null;
    game.onEnd = (res) => { ended = res; };
    // Bot pathfinding: BFS from the goal tile, then step toward the lower-distance neighbor.
    const bfs = (gx, gy) => {
      const dist = new Int16Array(w.w * w.h).fill(-1);
      const q = [w.index(Math.floor(gx), Math.floor(gy))];
      if (q[0] < 0) return dist;
      dist[q[0]] = 0;
      for (let h = 0; h < q.length; h++) {
        const i = q[h], x = i % w.w, y = (i / w.w) | 0;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const j = w.index(x + ox, y + oy);
          if (j < 0 || dist[j] !== -1 || w.tiles[j] === 1) continue;
          dist[j] = dist[i] + 1;
          q.push(j);
        }
      }
      return dist;
    };
    const pathDir = (dist, x, y) => {
      const tx = Math.floor(x), ty = Math.floor(y);
      const here = dist[w.index(tx, ty)];
      let best = here, bx = 0, by = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if ((!ox && !oy) || (ox && oy && (w.solid(tx + ox, ty) || w.solid(tx, ty + oy)))) continue;
        const j = w.index(tx + ox, ty + oy);
        if (j >= 0 && dist[j] >= 0 && (best < 0 || dist[j] < best)) { best = dist[j]; bx = ox; by = oy; }
      }
      const [dx, dy] = w.delta(x, y, tx + bx + 0.5, ty + by + 0.5);
      const m = Math.hypot(dx, dy) || 1;
      return [dx / m, dy / m];
    };
    const plans = new Map();
    const nearest = (ship, list) => {
      let best = null, bd = Infinity;
      for (const t of list) {
        const d = w.dist(ship, t);
        if (d < bd) { bd = d; best = t; }
      }
      return [best, bd];
    };
    for (let step = 0; step < sc.seconds * 60 && !ended; step++) {
      for (const p of app.players) {
        const dev = p.device, s = dev.state, ship = p.ship;
        Object.assign(s, { moveX: 0, moveY: 0, aimX: 0, aimY: 0, aimActive: false, thrust: false, analog: true });
        if (!ship.alive) continue;
        const targets = game.aimTargets(ship);
        const [t, d] = nearest(ship, targets);
        const pick = game.missiles.filter((m) => m.pickable);
        let goal = t;
        if (ship.ammo === 0 && pick.length) goal = nearest(ship, pick)[0];
        if (goal) {
          let plan = plans.get(p);
          if (!plan || step - plan.t > 20 || plan.goal !== goal) {
            plan = { goal, t: step, dist: bfs(goal.x, goal.y) };
            plans.set(p, plan);
          }
          const seen = w.lineOfSight(ship.x, ship.y, goal.x, goal.y);
          let [dx, dy] = seen ? w.delta(ship.x, ship.y, goal.x, goal.y) : pathDir(plan.dist, ship.x, ship.y);
          const m = Math.hypot(dx, dy) || 1;
          const dir = goal === t && d < 3.5 && seen ? -1 : 1;
          dx = (dx / m) * dir; dy = (dy / m) * dir;
          s.moveX = dx;
          s.moveY = dy;
          if (t) {
            const [ax, ay] = w.delta(ship.x, ship.y, t.x, t.y);
            const am = Math.hypot(ax, ay) || 1;
            s.aimX = ax / am; s.aimY = ay / am; s.aimActive = true;
          }
          if (w.gravity) {
            s.thrust = dy > 0.3 || (ship.fuel > 0.6 && Math.random() < 0.25);
            if (dy > -0.3) s.moveY = Math.max(0, s.moveY);
          }
          if (t && d < 14 && ship.ammo > 0 && Math.random() < 0.05 && w.lineOfSight(ship.x, ship.y, t.x, t.y)) {
            dev.latch.fire = true; stats.shots++;
          }
          if (t && d < 1.6 && Math.random() < 0.2) dev.latch.dash = true;
        } else {
          s.moveX = Math.sin(step / 50 + p.slot);
          s.thrust = w.gravity && Math.random() < 0.4;
        }
        // Detect ships embedded in walls (should never happen).
        if (w.boxSolid(ship.x, ship.y, ship.hw - 0.02, ship.hh - 0.02)) stats.stuckFrames++;
      }
      game.update(dt);
      app.input.clearLatches();
      stats.maxAliens = Math.max(stats.maxAliens, game.aliens.length);
      stats.maxRound = Math.max(stats.maxRound, game.round);
      stats.maxWave = Math.max(stats.maxWave, game.wave);
      for (const a of game.aliens) if (w.boxSolid(a.x, a.y, a.hw - 0.05, a.hh - 0.05)) stats.stuckFrames++;
    }
    const res = {
      ...stats,
      phase: game.phase,
      ended: ended ? (ended.mode === 'pvp' ? `winner ${ended.winner.name}` : `overrun wave ${ended.wave}`) : null,
      kills: app.players.map((p) => p.kills).join('/'),
      deaths: app.players.map((p) => p.deaths).join('/'),
      wins: app.players.map((p) => p.wins).join('/'),
      score: app.players.map((p) => p.score).join('/'),
      missiles: game.missiles.length,
    };
    app.toLobby();
    return res;
  }, sc);
  let ok = true;
  const why = [];
  if (r.stuckFrames > 0) { ok = false; why.push(`entities inside walls for ${r.stuckFrames} frames`); }
  if (sc.mode === 'pvp' && r.maxRound < 2) { ok = false; why.push('no round completed'); }
  if (sc.mode === 'pve' && r.maxWave < 2 && !r.ended) { ok = false; why.push('wave 1 never cleared'); }
  if (sc.mode === 'pve' && r.maxAliens === 0) { ok = false; why.push('no aliens spawned'); }
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${sc.map.padEnd(8)} ${sc.mode} x${sc.players}  round=${r.maxRound} wave=${r.maxWave} phase=${r.phase} ended=${r.ended} kills=${r.kills} deaths=${r.deaths} wins=${r.wins} score=${r.score} shots=${r.shots} maxAliens=${r.maxAliens} missiles=${r.missiles} ${why.join('; ')}`);
}
await browser.close();
server.close();
if (errors.length) { console.log('PAGE ERRORS:\n' + [...new Set(errors)].join('\n')); failed = true; }
process.exit(failed ? 1 : 0);
