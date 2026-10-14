// Pooled additive point particles drawn in one call. Sizes are in world units;
// setViewportHeight() must be called before rendering each viewport.

import * as THREE from 'three';
import { rand, TAU } from './util.js';

const MAX = 5000;

const vert = /* glsl */ `
attribute float size;
attribute float alpha;
attribute vec3 tint;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
  vColor = tint;
  vAlpha = alpha;
}`;

const frag = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a *= a;
  gl_FragColor = vec4(vColor, a * vAlpha);
}`;

const tmpColor = new THREE.Color();

export class Particles {
  constructor() {
    this.count = 0;
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 2);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.size0 = new Float32Array(MAX);
    this.size1 = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.alpha0 = new Float32Array(MAX);

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('tint', this.colAttr);
    geo.setAttribute('size', this.sizeAttr);
    geo.setAttribute('alpha', this.alphaAttr);
    geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 } },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.geo = geo;
  }

  setViewportHeight(px, fovDeg) {
    this.material.uniforms.uScale.value = px / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  clear() {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }

  emit(x, y, z, vx, vy, life, size0, size1, color, opts = {}) {
    if (this.count >= MAX) return;
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 2] = vx; this.vel[i * 2 + 1] = vy;
    this.life[i] = life; this.maxLife[i] = life;
    this.size0[i] = size0; this.size1[i] = size1;
    tmpColor.set(color);
    this.col[i * 3] = tmpColor.r; this.col[i * 3 + 1] = tmpColor.g; this.col[i * 3 + 2] = tmpColor.b;
    this.drag[i] = opts.drag ?? 2;
    this.grav[i] = opts.gravity ?? 0;
    this.alpha0[i] = opts.alpha ?? 1;
    this.size[i] = size0;
    this.alpha[i] = this.alpha0[i];
  }

  burst(x, y, color, count, speed, life = 0.6, size = 0.35, opts = {}) {
    for (let n = 0; n < count; n++) {
      const a = rand(0, TAU), s = speed * Math.sqrt(Math.random());
      this.emit(x, y, rand(-0.3, 0.3), Math.cos(a) * s, Math.sin(a) * s, life * rand(0.5, 1.2), size * rand(0.6, 1.3), 0, color, opts);
    }
  }

  explosion(x, y, color, big = false) {
    const k = big ? 1.7 : 1;
    this.burst(x, y, 0xffffff, 10 * k, 3 * k, 0.25, 1.4 * k, { drag: 6 });
    this.burst(x, y, 0xffc060, 26 * k, 7 * k, 0.55, 0.6 * k, { drag: 3.5 });
    this.burst(x, y, color, 30 * k, 9 * k, 0.9, 0.35 * k, { drag: 2.5 });
    this.burst(x, y, 0x554a44, 12 * k, 2 * k, 1.4, 0.9 * k, { drag: 1.5, alpha: 0.35 });
  }

  update(dt) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.copy(--this.count, i);
        continue;
      }
      const t = 1 - this.life[i] / this.maxLife[i];
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 2] *= d;
      this.vel[i * 2 + 1] = this.vel[i * 2 + 1] * d - this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 2] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 2 + 1] * dt;
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      this.alpha[i] = this.alpha0[i] * (1 - t * t);
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  copy(from, to) {
    if (from === to) return;
    for (let k = 0; k < 3; k++) {
      this.pos[to * 3 + k] = this.pos[from * 3 + k];
      this.col[to * 3 + k] = this.col[from * 3 + k];
    }
    this.vel[to * 2] = this.vel[from * 2];
    this.vel[to * 2 + 1] = this.vel[from * 2 + 1];
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.size0[to] = this.size0[from];
    this.size1[to] = this.size1[from];
    this.size[to] = this.size[from];
    this.drag[to] = this.drag[from];
    this.grav[to] = this.grav[from];
    this.alpha0[to] = this.alpha0[from];
    this.alpha[to] = this.alpha[from];
  }
}
