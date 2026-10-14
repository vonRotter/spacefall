import { Input } from './input.js';
import { initAudio, sfx, setMuted, isMuted } from './audio.js';
import { Renderer } from './renderer.js';
import { Hud } from './hud.js';
import { Menu } from './menu.js';
import { Game } from './game.js';
import { World } from './world.js';
import { MAPS } from './maps.js';
import { View } from './views.js';
import { FIXED_DT, PLAYER_COLORS } from './config.js';
import { storageGet, storageSet } from './util.js';

class App {
  constructor() {
    this.input = new Input();
    this.input.onActivity = () => initAudio();
    this.input.onPadEvent = (kind, pad) => this.onPadEvent(kind, pad);
    this.renderer = new Renderer(document.getElementById('gl'));
    this.hud = new Hud(document.getElementById('hud'));
    this.players = [];
    this.state = 'lobby';
    this.game = null;
    this.acc = 0;
    this.attract = new View('attract');
    this.attractT = 0;
    this.worlds = new Map();
    this.maps = MAPS;
    this.menu = new Menu(document.getElementById('ui'), this);
    this.previewMap(MAPS[this.menu.settings.map]);
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => { if (e.code === 'KeyM') setMuted(!isMuted()); });
    this.resize();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  world(def) {
    if (!this.worlds.has(def.id)) this.worlds.set(def.id, new World(def));
    return this.worlds.get(def.id);
  }

  previewMap(def) {
    this.renderer.setLevel(this.world(def));
  }

  resize() {
    this.renderer.resize();
    this.hud.resize();
    const W = this.renderer.width, H = this.renderer.height;
    this.attract.setRect({ x: 0, y: 0, w: W, h: H }, H);
    if (this.game) this.game.layout(W, H);
  }

  // ---------------------------------------------------------------------------
  // Players

  join(dev) {
    const used = new Set(this.players.map((p) => p.slot));
    const slot = [0, 1, 2, 3].find((i) => !used.has(i));
    const input = this.input;
    const player = {
      slot,
      deviceId: dev.id,
      name: `P${slot + 1}`,
      color: PLAYER_COLORS[slot],
      get device() { return input.get(this.deviceId); },
    };
    this.players.push(player);
    this.players.sort((a, b) => a.slot - b.slot);
    dev.rumble(0.5, 120);
    sfx.join();
  }

  leave(player) {
    this.players = this.players.filter((p) => p !== player);
    sfx.ui();
  }

  onPadEvent(kind, pad) {
    if (kind === 'disconnected') {
      const p = this.players.find((pl) => pl.deviceId === `gp${pad.index}`);
      if (p && this.state === 'game') this.pause(`${p.name}'s controller disconnected. Reconnect it, then resume.`);
      else if (p) this.menu.renderLobby();
    } else if (this.state === 'lobby') {
      this.menu.showNotice('Controller connected: press A / ✕ to join');
    }
  }

  // ---------------------------------------------------------------------------
  // Flow

  startGame(settings) {
    this.lastSettings = settings;
    if (this.game) this.game.dispose();
    this.game = new Game({
      renderer: this.renderer,
      world: this.world(settings.mapDef),
      players: this.players,
      mode: settings.mode,
      settings,
      onEnd: (r) => this.onGameEnd(r),
    });
    this.game.layout(this.renderer.width, this.renderer.height);
    this.acc = 0;
    this.state = 'game';
    this.menu.show('none');
    this.input.clearLatches();
  }

  onGameEnd(r) {
    if (r.mode === 'pve') {
      const key = `spacefall.best.${this.lastSettings.mapDef.id}`;
      const score = r.players.reduce((a, p) => a + p.score, 0);
      const prev = storageGet(key, null);
      const isNew = !prev || r.wave > prev.wave || (r.wave === prev.wave && score > prev.score);
      if (isNew) storageSet(key, { wave: r.wave, score });
      r.best = isNew ? { wave: r.wave, score, isNew } : prev;
    }
    this.state = 'results';
    this.menu.show('results');
    this.menu.showResults(r);
  }

  pause(message = '') {
    if (this.state !== 'game') return;
    this.state = 'paused';
    this.menu.show('pause');
    this.menu.showPause(message);
  }

  resume() {
    const missing = this.players.find((p) => !p.device || !p.device.connected);
    if (missing) { this.menu.showPause(`${missing.name}'s controller is still disconnected.`); return; }
    this.state = 'game';
    this.menu.show('none');
    this.input.clearLatches();
  }

  restart() {
    this.startGame(this.lastSettings);
  }

  toLobby() {
    if (this.game) { this.game.dispose(); this.game = null; }
    this.state = 'lobby';
    this.players = this.players.filter((p) => p.device && p.device.connected);
    this.previewMap(MAPS[this.menu.settings.map]);
    this.menu.show('lobby');
  }

  // ---------------------------------------------------------------------------
  // Loop

  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.input.poll();

    if (this.state === 'lobby') {
      this.menu.updateLobby();
      this.updateAttract(dt);
      this.renderer.particles.update(dt);
      this.renderer.render([this.attract]);
      this.hud.clear();
    } else {
      const devices = this.players.map((p) => p.device);
      if (this.state === 'game') {
        if (devices.some((d) => d && d.pressed('start'))) {
          this.pause();
        } else {
          this.acc += dt;
          let steps = 0;
          while (this.acc >= FIXED_DT && steps < 6) {
            this.game.update(FIXED_DT);
            this.input.clearLatches();
            this.acc -= FIXED_DT;
            steps++;
          }
          if (steps === 6) this.acc = 0;
        }
      } else if (this.state === 'paused') {
        this.menu.navigateList(this.menu.pause, devices, () => this.resume());
      } else if (this.state === 'results') {
        this.menu.navigateList(this.menu.results, devices);
      }
      if (this.game) {
        this.game.updateViews(this.state === 'game' ? dt : 0);
        this.renderer.render(this.game.views);
        this.hud.draw(this.game);
      }
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  updateAttract(dt) {
    const v = this.attract;
    const world = this.renderer.level.world;
    this.attractT += dt;
    const t = this.attractT;
    v.visH = Math.min(Math.max(world.h * 0.75, 14), 22);
    const spanX = Math.max(0, world.w / 2 - v.visW / 2);
    const spanY = Math.max(0, world.h / 2 - v.visH / 2);
    v.x = world.w / 2 + Math.sin(t * 0.07) * spanX;
    v.y = world.h / 2 + Math.sin(t * 0.05 + 1) * spanY;
    v.apply();
  }
}

window.spacefall = new App();
