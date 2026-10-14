// Procedural meshes, materials and textures. Geometries and materials are created once
// and shared, so spawning an entity only allocates lightweight Mesh/Group objects.

import * as THREE from 'three';

const cache = new Map();
function once(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

// ---------------------------------------------------------------------------
// Textures

export function glowTexture() {
  return once('tex:glow', () => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

export function nebulaTexture(seed = 1) {
  return once(`tex:nebula:${seed}`, () => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    let s = seed * 9301 + 49297;
    const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 40; i++) {
      const x = 128 + (r() - 0.5) * 150, y = 128 + (r() - 0.5) * 150, rad = 30 + r() * 70;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      const a = 0.05 + r() * 0.08;
      grad.addColorStop(0, `rgba(255,255,255,${a})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

export function planetTexture(hueA, hueB, seed = 3) {
  return once(`tex:planet:${hueA}:${hueB}:${seed}`, () => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    let s = seed;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let y = 0; y < 128; y++) {
      const band = Math.sin(y * 0.18 + r() * 0.6) * 0.5 + 0.5;
      g.fillStyle = `hsl(${hueA + (hueB - hueA) * band}, 45%, ${22 + band * 30}%)`;
      g.fillRect(0, y, 256, 1);
    }
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `hsla(${hueB}, 50%, ${30 + r() * 40}%, 0.25)`;
      g.beginPath();
      g.ellipse(r() * 256, r() * 128, 10 + r() * 40, 2 + r() * 6, 0, 0, Math.PI * 2);
      g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

export function makeGlow(color, scale = 1, opacity = 1) {
  const mat = new THREE.SpriteMaterial({
    map: glowTexture(),
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(scale);
  return s;
}

// ---------------------------------------------------------------------------
// Shared materials

export function stdMat(color, opts = {}) {
  const key = `mat:${color}:${JSON.stringify(opts)}`;
  return once(key, () => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.3, ...opts }));
}
export function glowMat(color) {
  return once(`glowmat:${color}`, () => new THREE.MeshBasicMaterial({ color }));
}

// ---------------------------------------------------------------------------
// Ship

const geo = {
  get hull() { return once('g:hull', () => { const g = new THREE.ConeGeometry(0.2, 0.72, 6); g.rotateZ(-Math.PI / 2); return g; }); },
  get wing() { return once('g:wing', () => new THREE.BoxGeometry(0.34, 0.07, 0.62)); },
  get fin() { return once('g:fin', () => new THREE.BoxGeometry(0.22, 0.2, 0.04)); },
  get cockpit() { return once('g:cockpit', () => new THREE.SphereGeometry(0.11, 10, 8)); },
  get nozzle() { return once('g:nozzle', () => { const g = new THREE.CylinderGeometry(0.1, 0.13, 0.12, 8); g.rotateZ(Math.PI / 2); return g; }); },
  get shield() { return once('g:shield', () => new THREE.IcosahedronGeometry(0.58, 2)); },
  get missile() { return once('g:missile', () => { const g = new THREE.CylinderGeometry(0.045, 0.045, 0.42, 6); g.rotateZ(Math.PI / 2); return g; }); },
  get missileTip() { return once('g:mtip', () => { const g = new THREE.ConeGeometry(0.06, 0.14, 6); g.rotateZ(-Math.PI / 2); g.translate(0.27, 0, 0); return g; }); },
  get missileFin() { return once('g:mfin', () => { const g = new THREE.BoxGeometry(0.1, 0.16, 0.16); g.translate(-0.18, 0, 0); return g; }); },
};

export function makeShip(colorHex) {
  const root = new THREE.Group();
  const roll = new THREE.Group();
  root.add(roll);
  const body = stdMat(colorHex, { metalness: 0.5, roughness: 0.35, emissive: colorHex, emissiveIntensity: 0.15 });
  const dark = stdMat(0x2a3140, { metalness: 0.7, roughness: 0.4 });
  const hull = new THREE.Mesh(geo.hull, body);
  roll.add(hull);
  const wing = new THREE.Mesh(geo.wing, dark);
  wing.position.set(-0.12, -0.02, 0);
  roll.add(wing);
  const fin = new THREE.Mesh(geo.fin, body);
  fin.position.set(-0.2, 0.12, 0);
  roll.add(fin);
  const cockpit = new THREE.Mesh(geo.cockpit, stdMat(0x9fe8ff, { metalness: 0.1, roughness: 0.1, emissive: 0x2288aa, emissiveIntensity: 0.6 }));
  cockpit.scale.set(1.4, 0.7, 0.8);
  cockpit.position.set(0.06, 0.08, 0);
  roll.add(cockpit);
  const nozzle = new THREE.Mesh(geo.nozzle, dark);
  nozzle.position.set(-0.36, 0, 0);
  roll.add(nozzle);
  const engine = makeGlow(colorHex, 0.5, 0.9);
  engine.position.set(-0.45, 0, 0);
  roll.add(engine);
  const halo = makeGlow(colorHex, 1.6, 0.18);
  root.add(halo);
  const shield = new THREE.Mesh(geo.shield, new THREE.MeshBasicMaterial({
    color: 0x7fd8ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true,
  }));
  shield.visible = false;
  root.add(shield);
  root.userData = { roll, engine, shield, halo };
  return root;
}

export function makeMissile(colorHex) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo.missile, stdMat(0xd8dde8, { metalness: 0.6, roughness: 0.3 })));
  g.add(new THREE.Mesh(geo.missileTip, stdMat(colorHex, { emissive: colorHex, emissiveIntensity: 0.6 })));
  g.add(new THREE.Mesh(geo.missileFin, stdMat(colorHex, { emissive: colorHex, emissiveIntensity: 0.3 })));
  const glow = makeGlow(colorHex, 0.7, 0.6);
  glow.position.x = -0.2;
  g.add(glow);
  g.userData = { glow };
  return g;
}

// ---------------------------------------------------------------------------
// Aliens

export function makeCrawler() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(once('g:crawlbody', () => new THREE.SphereGeometry(0.36, 12, 10)),
    stdMat(0x52c247, { roughness: 0.7, metalness: 0.05, emissive: 0x0e3a0a }));
  body.scale.set(1.1, 0.72, 0.9);
  body.position.y = 0.04;
  g.add(body);
  const legGeo = once('g:leg', () => { const l = new THREE.CylinderGeometry(0.03, 0.02, 0.36, 4); l.translate(0, -0.18, 0); return l; });
  const legMat = stdMat(0x2c6e25, { roughness: 0.8 });
  const legs = [];
  for (let i = 0; i < 6; i++) {
    const leg = new THREE.Mesh(legGeo, legMat);
    const side = i % 2 ? 1 : -1;
    leg.position.set(-0.2 + Math.floor(i / 2) * 0.2, -0.02, side * 0.2);
    leg.rotation.x = side * 0.7;
    g.add(leg);
    legs.push(leg);
  }
  addEyes(g, 0.28, 0.1, 0xff3030, 0.06);
  g.userData = { legs, body };
  return g;
}

function addEyes(g, x, y, color, r) {
  const eyeGeo = once(`g:eye:${r}`, () => new THREE.SphereGeometry(r, 8, 6));
  for (const z of [-0.12, 0.12]) {
    const e = new THREE.Mesh(eyeGeo, glowMat(color));
    e.position.set(x, y, z + 0.1);
    g.add(e);
  }
}

export function makeWisp() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(once('g:wispcore', () => new THREE.IcosahedronGeometry(0.24, 0)),
    stdMat(0xb455ff, { emissive: 0x7a1cff, emissiveIntensity: 0.9, flatShading: true }));
  g.add(core);
  const ring = new THREE.Mesh(once('g:wispring', () => new THREE.TorusGeometry(0.36, 0.04, 6, 18)), glowMat(0xe2a8ff));
  g.add(ring);
  g.add(makeGlow(0xa04dff, 1.4, 0.5));
  g.userData = { core, ring };
  return g;
}

export function makeSpore() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(once('g:spore', () => new THREE.IcosahedronGeometry(0.3, 1)),
    stdMat(0x7ad94a, { emissive: 0x1d5a10, flatShading: true, roughness: 0.8 }));
  g.add(core);
  const spikeGeo = once('g:spike', () => { const c = new THREE.ConeGeometry(0.06, 0.24, 5); c.translate(0, 0.38, 0); return c; });
  const spikeMat = stdMat(0xd7ff7a, { emissive: 0x4a7a10 });
  for (let i = 0; i < 8; i++) {
    const s = new THREE.Mesh(spikeGeo, spikeMat);
    s.rotation.z = (i / 8) * Math.PI * 2;
    s.rotation.x = (i % 2) * 0.6 - 0.3;
    g.add(s);
  }
  g.add(makeGlow(0x8dff4a, 1.1, 0.25));
  g.userData = { core };
  return g;
}

export function makeSpitter() {
  const g = new THREE.Group();
  const sac = new THREE.Mesh(once('g:sac', () => new THREE.SphereGeometry(0.42, 14, 10)),
    stdMat(0xd9c23a, { emissive: 0x4a3a00, roughness: 0.4, metalness: 0.1 }));
  sac.scale.set(1, 0.9, 0.9);
  g.add(sac);
  const mouth = new THREE.Mesh(once('g:mouth', () => new THREE.SphereGeometry(0.15, 10, 8)), glowMat(0x9cff2e));
  mouth.position.set(0.32, -0.05, 0.12);
  g.add(mouth);
  const tGeo = once('g:tent', () => { const c = new THREE.CylinderGeometry(0.05, 0.015, 0.5, 5); c.translate(0, -0.25, 0); return c; });
  const tMat = stdMat(0x8a7a1a, { roughness: 0.8 });
  const tentacles = [];
  for (let i = 0; i < 5; i++) {
    const t = new THREE.Mesh(tGeo, tMat);
    t.position.set(-0.24 + i * 0.12, -0.28, 0);
    g.add(t);
    tentacles.push(t);
  }
  const glow = makeGlow(0x9cff2e, 1.2, 0.0);
  glow.position.copy(mouth.position);
  g.add(glow);
  g.userData = { sac, mouth, tentacles, glow };
  return g;
}

export function makeBrute() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(once('g:brute', () => new THREE.DodecahedronGeometry(0.6, 0)),
    stdMat(0x9c2a2a, { emissive: 0x3a0606, flatShading: true, roughness: 0.6 }));
  body.scale.set(1.15, 0.95, 0.9);
  g.add(body);
  const hornGeo = once('g:horn', () => new THREE.ConeGeometry(0.1, 0.42, 6));
  const hornMat = stdMat(0xe8dcc0, { roughness: 0.5 });
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(hornGeo, hornMat);
    h.position.set(0.25, 0.48, s * 0.25);
    h.rotation.z = -0.5;
    g.add(h);
  }
  const eye = new THREE.Mesh(once('g:bruteeye', () => new THREE.SphereGeometry(0.13, 10, 8)), glowMat(0xffd23a));
  eye.position.set(0.5, 0.1, 0.25);
  g.add(eye);
  const glow = makeGlow(0xff3020, 2.2, 0);
  g.add(glow);
  g.userData = { body, eye, glow };
  return g;
}

export function makeBolt() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(once('g:bolt', () => new THREE.SphereGeometry(0.14, 8, 6)), glowMat(0xc6ff4a)));
  g.add(makeGlow(0x9cff2e, 0.9, 0.8));
  return g;
}

export function makeRift() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(once('g:rift', () => new THREE.TorusGeometry(0.6, 0.06, 6, 28)),
    new THREE.MeshBasicMaterial({ color: 0xc04dff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  g.add(ring);
  const inner = makeGlow(0x7a1cff, 1.6, 0.7);
  g.add(inner);
  g.userData = { ring, inner };
  return g;
}

export function makeCrate() {
  const g = new THREE.Group();
  const box = new THREE.Mesh(once('g:crate', () => new THREE.BoxGeometry(0.6, 0.5, 0.5)),
    stdMat(0x8a6a2a, { metalness: 0.6, roughness: 0.4, emissive: 0x2a1a00 }));
  g.add(box);
  const edges = new THREE.LineSegments(once('g:crateedge', () => new THREE.EdgesGeometry(new THREE.BoxGeometry(0.62, 0.52, 0.52))),
    once('m:crateedge', () => new THREE.LineBasicMaterial({ color: 0xffd36a })));
  g.add(edges);
  g.add(makeGlow(0xffc040, 1.4, 0.35));
  return g;
}
