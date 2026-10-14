// Builds the 3D look of a map (walls, platforms, trims, back walls) and its space backdrop.

import * as THREE from 'three';
import { SOLID, PLATFORM } from './world.js';
import { mulberry32 } from './util.js';
import { glowTexture, nebulaTexture, planetTexture } from './assets.js';

const DEPTH = 1.4;

export const THEMES = {
  station: {
    wall: 0x404b60, girder: 0x6b5a44, panel: 0x56627a, trim: 0x3fd0ff, trimAlt: 0xffa040,
    back: 0x141a26, platform: 0x8a96aa, bg: 0x03050b,
    nebula: [0x2a4cff, 0x9a2aff], planet: [200, 260],
    ambient: 0x7080b0, ambientI: 1.1, key: 0xdde6ff, keyI: 2.2,
  },
  asteroid: {
    wall: 0x7a7068, crystal: 0x5ff0ff, trim: 0x5ff0ff, platform: 0x8a8070, bg: 0x04060a,
    nebula: [0x1a8a9a, 0xff7a3a], planet: [20, 50],
    ambient: 0x8090a0, ambientI: 0.9, key: 0xfff0dd, keyI: 2.6,
  },
  hive: {
    wall: 0x5a3050, panel: 0x6a3a5a, crystal: 0x7dff4a, trim: 0x7dff4a, back: 0x1c0d1a,
    platform: 0x7dff4a, bg: 0x070308,
    nebula: [0xff2a5a, 0x5a1aff], planet: [320, 375],
    ambient: 0xa07090, ambientI: 1.0, key: 0xffd6e6, keyI: 2.0,
  },
};

class InstanceBuilder {
  constructor() { this.items = []; }
  add(x, y, z, sx = 1, sy = 1, sz = 1, color = 0xffffff, rx = 0, ry = 0, rz = 0) {
    this.items.push({ x, y, z, sx, sy, sz, color, rx, ry, rz });
  }
  build(geometry, material) {
    if (!this.items.length) { geometry.dispose(); return null; }
    const mesh = new THREE.InstancedMesh(geometry, material, this.items.length);
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    this.items.forEach((it, i) => {
      o.position.set(it.x, it.y, it.z);
      o.rotation.set(it.rx, it.ry, it.rz);
      o.scale.set(it.sx, it.sy, it.sz);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, c.set(it.color).multiplyScalar(1));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  }
}

function vary(hex, rng, amount = 0.12) {
  const c = new THREE.Color(hex);
  const k = 1 + (rng() - 0.5) * 2 * amount;
  return c.multiplyScalar(k).getHex();
}

export function buildLevel(world) {
  const theme = THEMES[world.def.theme];
  const rng = mulberry32(world.w * 131 + world.h * 7 + world.def.id.length);
  const group = new THREE.Group();
  const add = (m) => m && group.add(m);
  const isSolid = (x, y) => world.tile(x, y) === SOLID;
  const open = (x, y) => world.tile(x, y) !== SOLID;

  const walls = new InstanceBuilder();
  const girders = new InstanceBuilder();
  const faces = new InstanceBuilder();
  const trims = new InstanceBuilder();
  const crystals = new InstanceBuilder();
  const platforms = new InstanceBuilder();
  const backs = new InstanceBuilder();
  const backLights = [];

  // Hull breaches: holes in the back wall that reveal space.
  const breaches = [];
  const nb = world.def.theme === 'asteroid' ? 0 : 1 + Math.floor(rng() * 2) + Math.floor((world.w * world.h) / 700);
  for (let i = 0; i < nb; i++) breaches.push({ x: rng() * world.w, y: rng() * world.h, r: 1.2 + rng() * 1.8 });
  const inBreach = (x, y) => breaches.some((b) => {
    const d = Math.hypot(x + 0.5 - b.x, y + 0.5 - b.y);
    return d < b.r * (0.75 + 0.5 * rng());
  });

  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      const t = world.tile(x, y);
      const ch = world.charAt(x, y);
      const cx = x + 0.5, cy = y + 0.5;
      if (t === SOLID) {
        const exposed = open(x + 1, y) || open(x - 1, y) || open(x, y + 1) || open(x, y - 1);
        if (world.def.theme === 'station') {
          if (ch === '=') {
            girders.add(cx, cy, 0, 1, 0.82, DEPTH * 0.8, vary(theme.girder, rng, 0.1));
          } else {
            walls.add(cx, cy, 0, 1, 1, DEPTH, vary(theme.wall, rng, 0.08));
            if (exposed || rng() < 0.3) faces.add(cx, cy, DEPTH / 2 + 0.005, 0.78, 0.78, 0.02, vary(theme.panel, rng, 0.15));
          }
        } else if (world.def.theme === 'asteroid') {
          const s = 0.92 + rng() * 0.2;
          if (ch === '*') {
            walls.add(cx, cy, 0, s, s, s, vary(theme.wall, rng, 0.15), rng() * 6, rng() * 6, rng() * 6);
            crystals.add(cx + (rng() - 0.5) * 0.3, cy + (rng() - 0.5) * 0.3, 0.55, 0.35, 0.7 + rng() * 0.5, 0.35, theme.crystal, 0, 0, (rng() - 0.5) * 1.2);
          } else {
            walls.add(cx, cy, (rng() - 0.5) * 0.3, s, s, s * 1.1, vary(theme.wall, rng, 0.18), rng() * 6, rng() * 6, rng() * 6);
            if (!exposed && rng() < 0.5) walls.add(cx, cy, -0.6, 1.1, 1.1, 1.1, vary(theme.wall, rng, 0.2), rng() * 6, rng() * 6, rng() * 6);
          }
        } else {
          const s = 0.95 + rng() * 0.35;
          walls.add(cx + (rng() - 0.5) * 0.1, cy + (rng() - 0.5) * 0.1, 0, s, s, s * 1.3, vary(theme.wall, rng, 0.2), rng(), rng(), rng());
          if (ch === '*') crystals.add(cx, cy + 0.3, 0.45, 0.45, 0.45, 0.45, theme.crystal);
        }
        // Glowing trim on top of walkable surfaces.
        if (world.def.theme === 'station' && open(x, y + 1) && ch !== '=') {
          const col = rng() < 0.12 ? theme.trimAlt : theme.trim;
          if (rng() > 0.15) trims.add(cx, y + 1 - 0.035, DEPTH / 2 + 0.03, 0.92, 0.05, 0.05, col);
        }
      } else if (t === PLATFORM || (ch === '-' && !world.gravity)) {
        platforms.add(cx, y + 1 - 0.09, 0, 1, 0.16, DEPTH * 0.75, vary(theme.platform, rng, 0.06));
        trims.add(cx, y + 1 - 0.01, DEPTH * 0.375 + 0.02, 0.96, 0.03, 0.04, theme.trim);
      }
      if (t !== SOLID && theme.back && !inBreach(x, y)) {
        backs.add(cx, cy, -DEPTH / 2 - 0.02, 1, 1, 1, vary(theme.back, rng, 0.25));
        if (rng() < 0.025) backLights.push({ x: cx, y: cy });
      }
    }
  }

  if (world.def.theme === 'asteroid') {
    const rock = new THREE.IcosahedronGeometry(0.72, 0);
    add(walls.build(rock, new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.05, flatShading: true })));
    const crystal = new THREE.OctahedronGeometry(0.5, 0);
    add(crystals.build(crystal, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: theme.crystal, emissiveIntensity: 0.8, roughness: 0.2, flatShading: true })));
  } else if (world.def.theme === 'hive') {
    const blob = new THREE.IcosahedronGeometry(0.66, 1);
    add(walls.build(blob, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05, flatShading: true, emissive: 0x150510 })));
    const pod = new THREE.SphereGeometry(0.5, 10, 8);
    add(crystals.build(pod, new THREE.MeshBasicMaterial({ color: 0xffffff })));
  } else {
    add(walls.build(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.45 })));
    add(faces.build(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.6 })));
    add(girders.build(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.6 })));
  }
  const platMat = world.def.theme === 'hive'
    ? new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.55, emissive: 0x2a6a10, roughness: 0.3 })
    : new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.7 });
  add(platforms.build(new THREE.BoxGeometry(1, 1, 1), platMat));
  add(trims.build(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff })));
  add(backs.build(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.2 })));

  // Small lamps on the back wall.
  const lampMat = new THREE.SpriteMaterial({
    map: glowTexture(), color: theme.trim, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  for (const l of backLights) {
    const s = new THREE.Sprite(lampMat);
    s.position.set(l.x, l.y, -DEPTH / 2 + 0.05);
    s.scale.setScalar(1.2);
    group.add(s);
  }

  group.add(buildBackdrop(world, theme, rng));
  return {
    group,
    theme,
    dispose() {
      group.traverse((o) => {
        if (o.geometry && !o.isSprite) o.geometry.dispose();
        if (o.material && !o.material.map?.isCanvasTexture) o.material.dispose();
      });
    },
  };
}

function buildBackdrop(world, theme, rng) {
  const g = new THREE.Group();
  const cx = world.w / 2, cy = world.h / 2;

  // Stars.
  const n = 2600;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const z = -450 - rng() * 300;
    const spread = 1.2 + (-z) / 55;
    pos[i * 3] = cx + (rng() - 0.5) * (world.w + 60) * spread;
    pos[i * 3 + 1] = cy + (rng() - 0.5) * (world.h + 60) * spread;
    pos[i * 3 + 2] = z;
    c.setHSL(0.55 + rng() * 0.2, 0.4, 0.6 + rng() * 0.4);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.8, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false })));

  // Nebula clouds.
  theme.nebula.forEach((hex, i) => {
    const m = new THREE.SpriteMaterial({ map: nebulaTexture(i + 1), color: hex, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false });
    const s = new THREE.Sprite(m);
    s.position.set(cx + (i ? 1 : -1) * world.w * 0.6, cy + (i ? -0.3 : 0.4) * world.h, -260);
    s.scale.setScalar(220 + world.w * 2);
    g.add(s);
  });

  // Planet with an atmosphere glow.
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(34, 48, 32),
    new THREE.MeshStandardMaterial({ map: planetTexture(theme.planet[0], theme.planet[1], world.w), roughness: 1, metalness: 0 }),
  );
  planet.position.set(cx + world.w * 0.5 + 40, cy + world.h * 0.4 + 30, -420);
  planet.rotation.set(0.3, 0.5, 0.2);
  g.add(planet);
  const atm = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: theme.nebula[0], transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
  atm.position.copy(planet.position);
  atm.position.z += 1;
  atm.scale.setScalar(105);
  g.add(atm);

  // Distant debris for parallax.
  const debris = new InstanceBuilder();
  const count = 20 + Math.floor((world.w * world.h) / 60);
  for (let i = 0; i < count; i++) {
    const z = -14 - rng() * 36;
    const s = 0.4 + rng() * (world.def.theme === 'asteroid' ? 2.2 : 1.2);
    debris.add(rng() * (world.w + 40) - 20, rng() * (world.h + 30) - 15, z, s, s * (0.6 + rng() * 0.6), s, vary(theme.wall, rng, 0.3) , rng() * 6, rng() * 6, rng() * 6);
  }
  const dGeo = world.def.theme === 'station' ? new THREE.BoxGeometry(0.8, 0.3, 0.5) : new THREE.IcosahedronGeometry(0.7, 0);
  // Dim and translucent so it never reads as collidable terrain.
  const dMat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.2, flatShading: true, transparent: true, opacity: 0.55, depthWrite: false });
  dMat.color.setScalar(0.3);
  const dMesh = debris.build(dGeo, dMat);
  if (dMesh) g.add(dMesh);
  return g;
}
