import * as THREE from 'three';
import { Particles } from './particles.js';
import { buildLevel } from './level.js';
import { VIEW } from './config.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.15;
    this.gl.autoClear = false;
    this.scene = new THREE.Scene();
    this.ambient = new THREE.AmbientLight(0xffffff, 1);
    this.hemi = new THREE.HemisphereLight(0x8ab4ff, 0x201820, 0.6);
    this.key = new THREE.DirectionalLight(0xffffff, 2);
    this.key.position.set(-0.5, 0.9, 1.2);
    this.scene.add(this.ambient, this.hemi, this.key, this.key.target);
    this.particles = new Particles();
    this.scene.add(this.particles.points);
    this.entities = new THREE.Group();
    this.scene.add(this.entities);
    this.level = null;
    this.bg = new THREE.Color(0x03050b);
    this.width = 1;
    this.height = 1;
    this.resize();
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.gl.setSize(this.width, this.height, false);
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
  }

  setLevel(world) {
    if (this.level && this.level.world === world) return;
    if (this.level) {
      this.scene.remove(this.level.group);
      this.level.dispose();
    }
    this.level = buildLevel(world);
    this.level.world = world;
    this.scene.add(this.level.group);
    const t = this.level.theme;
    this.bg = new THREE.Color(t.bg);
    this.ambient.color.set(t.ambient);
    this.ambient.intensity = t.ambientI;
    this.key.color.set(t.key);
    this.key.intensity = t.keyI;
    this.key.target.position.set(world.w / 2, world.h / 2, 0);
    this.key.position.set(world.w / 2 - 20, world.h / 2 + 30, 40);
  }

  clearEntities() {
    for (const c of [...this.entities.children]) this.entities.remove(c);
    this.particles.clear();
  }

  render(views) {
    const gl = this.gl;
    gl.setScissorTest(true);
    gl.setScissor(0, 0, this.width, this.height);
    gl.setClearColor(0x000000, 1);
    gl.clear();
    const pr = gl.getPixelRatio();
    for (const v of views) {
      const r = v.rect;
      const y = this.height - r.y - r.h;
      gl.setViewport(r.x, y, r.w, r.h);
      gl.setScissor(r.x, y, r.w, r.h);
      gl.setClearColor(this.bg, 1);
      gl.clear(true, true, false);
      this.particles.setViewportHeight(r.h * pr, VIEW.fov);
      gl.render(this.scene, v.camera);
    }
    gl.setScissorTest(false);
  }
}
