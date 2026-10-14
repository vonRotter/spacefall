// Headless play-test: fakes up to four standard-mapping gamepads, joins players,
// runs PvP and PvE matches on several maps, saves screenshots and fails on page errors.
// Needs Playwright with Chromium:  node tools/smoke-test.mjs [outDir]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './serve.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const req = createRequire(path.join(execSync('npm root -g').toString().trim(), 'noop.js'));
  ({ chromium } = req('playwright'));
}

const out = process.argv[2] || 'screenshots';
fs.mkdirSync(out, { recursive: true });
const PORT = 8765;
const server = await serve(PORT);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.addInitScript(() => {
  const mk = (i, id) => ({
    index: i, id, connected: true, mapping: 'standard', timestamp: 0,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0],
  });
  window.__pads = [
    mk(0, 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'),
    mk(1, 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'),
    mk(2, 'Xbox 360 Controller (XInput STANDARD GAMEPAD)'),
    mk(3, 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)'),
  ];
  navigator.getGamepads = () => window.__pads;
  window.__btn = (i, b, v) => { window.__pads[i].buttons[b] = { pressed: v, value: v ? 1 : 0 }; };
  window.__axes = (i, a) => { window.__pads[i].axes = a; };
});

const wait = (ms) => page.waitForTimeout(ms);
// Wait for the game loop to run a couple of frames (headless WebGL can be slow).
const frames = (n = 2) => page.evaluate((k) => new Promise((r) => {
  const step = () => (k-- <= 0 ? r() : requestAnimationFrame(step));
  requestAnimationFrame(step);
}), n);
const tap = async (pad, btn) => {
  await page.evaluate(([p, b]) => window.__btn(p, b, true), [pad, btn]);
  await frames(2);
  await page.evaluate(([p, b]) => window.__btn(p, b, false), [pad, btn]);
  await frames(2);
};
const shot = async (name) => { await page.screenshot({ path: path.join(out, name + '.png') }); console.log('shot', name); };
const A = 0, X = 2, START = 9, DOWN = 13, RIGHT = 15, UP = 12, LB = 4;

async function chaos(pads, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await page.evaluate((n) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        window.__axes(i, [Math.cos(a), Math.sin(a), Math.cos(a + 1), Math.sin(a + 1)]);
        window.__btn(i, 0, Math.random() < 0.5);
        window.__btn(i, 2, Math.random() < 0.3);
        window.__btn(i, 4, Math.random() < 0.05);
      }
    }, pads);
    await frames(2);
  }
  await page.evaluate(() => window.__pads.forEach((p, i) => {
    window.__axes(i, [0, 0, 0, 0]);
    p.buttons.forEach((_, b) => window.__btn(i, b, false));
  }));
  await frames(3);
}

async function setMap(id) {
  // Drive the menu through the real UI: move cursor to the map row and step right until it matches.
  for (let n = 0; n < 8; n++) {
    const cur = await page.evaluate(() => document.querySelector('.map-name').textContent);
    if (cur === id) return;
    await page.evaluate(() => { window.spacefall.menu.cursor = 1; });
    await tap(0, RIGHT);
  }
  throw new Error('map not found: ' + id);
}

async function setMode(mode) {
  const cur = await page.evaluate(() => window.spacefall.menu.settings.mode);
  if (cur !== mode) { await page.evaluate(() => { window.spacefall.menu.cursor = 0; }); await tap(0, RIGHT); }
}

await page.goto(`http://localhost:${PORT}/`);
await wait(1500);
await shot('01-lobby-empty');

for (let i = 0; i < 4; i++) await tap(i, A);
await wait(300);
await shot('02-lobby-4-joined');

// PvP, single-screen wrap map.
await setMode('pvp');
await setMap('Derelict Hub');
await tap(0, START);
await wait(1800);
await shot('03-pvp-hub-start');
await chaos(4, 3000);
await shot('04-pvp-hub-chaos');

// Pause and go back to lobby.
await tap(0, START);
await wait(200);
await shot('05-pause');
await tap(0, DOWN); await tap(0, DOWN); await tap(0, A);
await wait(400);

// PvP split screen, 4 players.
await setMap('Cargo Bay 7');
await tap(0, START);
await wait(1800);
await shot('06-pvp-cargo-4split');
await chaos(4, 2500);
await shot('07-pvp-cargo-chaos');
await tap(0, START); await tap(0, DOWN); await tap(0, DOWN); await tap(0, A); await wait(300);

// Three players: quarters with tactical overview.
await tap(3, 1); // P4 leaves (B)
await wait(200);
await setMode('pve');
await setMap('Kessler Belt');
await tap(0, START);
await wait(4500);
await shot('08-pve-kessler-3split');
await chaos(3, 4000);
await shot('09-pve-kessler-chaos');
await tap(0, START); await tap(0, DOWN); await tap(0, DOWN); await tap(0, A); await wait(300);

// Two players, PvE, hive and zero-g station.
await tap(2, 1);
await wait(200);
for (const m of ['Hive Hulk', 'Gravity Failure', 'Ice Drift']) {
  await setMap(m);
  await tap(0, START);
  await wait(4200);
  await chaos(2, 2500);
  await shot('10-pve-' + m.toLowerCase().replace(/ /g, '-'));
  await tap(0, START); await tap(0, DOWN); await tap(0, DOWN); await tap(0, A); await wait(300);
}

const stats = await page.evaluate(() => ({ state: window.spacefall.state, players: window.spacefall.players.length }));
console.log('final', JSON.stringify(stats));
await browser.close();
server.close();
if (errors.length) {
  console.log('PAGE ERRORS:\n' + [...new Set(errors)].join('\n'));
  process.exit(1);
}
console.log('no page errors');
