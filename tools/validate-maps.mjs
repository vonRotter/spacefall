// Sanity-checks every map: row widths, spawn counts, closed borders and reachability.
// Usage: node tools/validate-maps.mjs [--print]
import { MAPS } from '../src/maps.js';
import { World, SOLID } from '../src/world.js';

const print = process.argv.includes('--print');
let failed = false;
for (const def of MAPS) {
  const errs = [];
  let world;
  try {
    world = new World(def);
  } catch (e) {
    console.log(`FAIL ${def.id}: ${e.message}`);
    failed = true;
    continue;
  }
  const { w, h } = world;
  if (world.spawns.length < 4) errs.push(`only ${world.spawns.length} spawns`);
  if (!def.wrap) {
    for (let x = 0; x < w; x++) if (!world.solid(x, 0) || !world.solid(x, h - 1)) errs.push(`border gap at column ${x}`);
    for (let y = 0; y < h; y++) if (!world.solid(0, y) || !world.solid(w - 1, y)) errs.push(`border gap at row ${h - 1 - y}`);
  }
  for (const p of [...world.spawns, ...world.rifts, ...world.crates]) {
    const i = world.index(Math.floor(p.x), Math.floor(p.y));
    if (!world.reachable[i]) errs.push(`marker at ${p.x},${p.y} unreachable`);
  }
  let open = 0, reach = 0;
  for (let i = 0; i < w * h; i++) if (world.tiles[i] !== SOLID) { open++; if (world.reachable[i]) reach++; }
  const status = errs.length ? 'FAIL' : 'ok  ';
  if (errs.length) failed = true;
  console.log(`${status} ${def.id.padEnd(8)} ${w}x${h} spawns=${world.spawns.length} rifts=${world.rifts.length} crates=${world.crates.length} open=${open} reachable=${reach}`);
  for (const e of [...new Set(errs)].slice(0, 8)) console.log('     - ' + e);
  if (print) console.log(world.rows.join('\n') + '\n');
}
process.exit(failed ? 1 : 0);
