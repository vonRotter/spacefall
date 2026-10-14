// DOM menus: lobby (join + match setup), pause and results. Navigable with any
// joined controller or keyboard layout, and with the mouse.

import { MAPS } from './maps.js';
import { World, SOLID, PLATFORM } from './world.js';
import { PLAYER_COLORS } from './config.js';
import { sfx, initAudio, setMuted, isMuted, audioRunning } from './audio.js';

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

const THEME_PREVIEW = {
  station: { wall: '#4a5670', plat: '#9fb0c8', bg: '#0b1020' },
  asteroid: { wall: '#7a7068', plat: '#9a9080', bg: '#080a10' },
  hive: { wall: '#6a3a5a', plat: '#7dff4a', bg: '#120812' },
};

export class Menu {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.settings = { mode: 'pvp', map: 0, rounds: 5, lives: 3, hazards: true };
    this.cursor = 0;
    this.focus = 0;
    this.previewCache = new Map();
    this.buildLobby();
    this.buildPause();
    this.buildResults();
    this.buildNotice();
    this.renderLobby();
  }

  // ---------------------------------------------------------------------------
  // Lobby

  buildLobby() {
    const s = el('div', 'screen lobby');
    s.innerHTML = `
      <button class="sound" type="button"></button>
      <header>
        <div class="logo">SPACE<span>FALL</span></div>
        <div class="tagline">Tiny ships · retrievable missiles · 1–4 players local</div>
      </header>
      <div class="slots"></div>
      <div class="setup">
        <div class="rows"></div>
        <div class="preview">
          <canvas width="320" height="180"></canvas>
          <div class="map-name"></div>
          <div class="tags"></div>
          <p class="desc"></p>
        </div>
      </div>
      <div class="hint"></div>
      <footer class="controls">
        <div><b>Gamepad</b> Move <i>L-stick / D-pad</i> · Thrust <i>A / ✕</i> · Fire <i>X / □ · RT / R2</i> · Dash <i>B / ○ · LT / L2</i> · Aim <i>R-stick</i> · Pause <i>Menu / Options</i></div>
        <div><b>Keyboard 1</b> Move <i>WASD</i> (W thrusts) · Fire <i>Space</i> · Dash <i>L-Shift</i> &nbsp; <b>Keyboard 2</b> Move <i>Arrows</i> (↑ thrusts) · Fire <i>Enter / R-Ctrl</i> · Dash <i>R-Shift</i> &nbsp; <b>Pause</b> <i>Esc</i></div>
      </footer>`;
    this.root.appendChild(s);
    this.lobby = s;
    this.slotsEl = s.querySelector('.slots');
    this.rowsEl = s.querySelector('.rows');
    this.previewCanvas = s.querySelector('.preview canvas');
    this.hintEl = s.querySelector('.hint');
    for (let i = 0; i < 4; i++) this.slotsEl.appendChild(el('div', 'slot'));
    this.soundEl = s.querySelector('.sound');
    this.soundEl.addEventListener('click', () => {
      if (audioRunning()) setMuted(!isMuted());
      else { initAudio(); setMuted(false); }
      this.updateSound(true);
    });
  }

  // Browsers keep audio locked until a click or key press; show that state.
  updateSound(force = false) {
    const label = !audioRunning() ? 'Sound off · click to enable' : isMuted() ? 'Muted · M' : 'Sound on · M';
    if (force || label !== this.soundLabel) {
      this.soundLabel = label;
      this.soundEl.textContent = label;
      this.soundEl.classList.toggle('off', !audioRunning() || isMuted());
    }
  }

  rows() {
    const st = this.settings;
    const rows = [
      { key: 'mode', label: 'Mode', value: st.mode === 'pvp' ? 'Versus (PvP)' : 'Co-op (PvE)' },
      { key: 'map', label: 'Map', value: MAPS[st.map].name },
    ];
    if (st.mode === 'pvp') {
      rows.push({ key: 'rounds', label: 'Rounds to win', value: String(st.rounds) });
      rows.push({ key: 'hazards', label: 'Alien hazards', value: st.hazards ? 'On' : 'Off' });
    } else {
      rows.push({ key: 'lives', label: 'Lives each', value: String(st.lives) });
    }
    rows.push({ key: 'start', label: 'START', value: '' });
    return rows;
  }

  change(key, dir) {
    const st = this.settings;
    if (key === 'mode') st.mode = st.mode === 'pvp' ? 'pve' : 'pvp';
    else if (key === 'map') { st.map = (st.map + dir + MAPS.length) % MAPS.length; this.app.previewMap(MAPS[st.map]); }
    else if (key === 'rounds') st.rounds = Math.min(15, Math.max(1, st.rounds + dir * 2));
    else if (key === 'lives') st.lives = Math.min(9, Math.max(1, st.lives + dir));
    else if (key === 'hazards') st.hazards = !st.hazards;
    sfx.ui();
    this.renderLobby();
  }

  activate(key) {
    if (key === 'start') this.tryStart();
    else this.change(key, 1);
  }

  tryStart() {
    const n = this.app.players.length;
    if (n === 0) { this.flashHint('Join first: press A / ✕ on a controller, Space or Enter on the keyboard'); return; }
    if (this.settings.mode === 'pvp' && n < 2) { this.flashHint('Versus needs at least 2 players. Switch Mode to Co-op to play solo.'); return; }
    sfx.uiConfirm();
    this.app.startGame({ ...this.settings, mapDef: MAPS[this.settings.map] });
  }

  flashHint(msg) {
    this.hintEl.textContent = msg;
    this.hintEl.classList.remove('flash');
    void this.hintEl.offsetWidth;
    this.hintEl.classList.add('flash');
  }

  renderLobby() {
    const app = this.app;
    // Slots.
    [...this.slotsEl.children].forEach((slot, i) => {
      const p = app.players.find((pl) => pl.slot === i);
      const col = PLAYER_COLORS[i];
      slot.style.setProperty('--c', col.css);
      if (p) {
        const dev = p.device;
        slot.className = 'slot joined';
        slot.innerHTML = `<div class="ship-icon"></div><div class="pname">P${i + 1}</div>
          <div class="dev">${dev ? dev.label : 'Disconnected'}</div>
          <div class="leave">${dev ? dev.glyphs.back : ''} to leave</div>`;
      } else {
        slot.className = 'slot';
        slot.innerHTML = `<div class="pname">P${i + 1}</div><div class="join">Press <b>A / ✕</b><br>or <b>Space</b> / <b>Enter</b></div>`;
      }
    });
    // Settings rows.
    const rows = this.rows();
    this.cursor = Math.min(this.cursor, rows.length - 1);
    this.rowsEl.innerHTML = '';
    rows.forEach((r, i) => {
      const row = el('div', 'row' + (i === this.cursor ? ' sel' : '') + (r.key === 'start' ? ' start' : ''));
      if (r.key === 'start') {
        row.textContent = 'START';
      } else {
        row.innerHTML = `<span class="label">${r.label}</span><span class="val"><button class="arr" data-d="-1">◀</button><span>${r.value}</span><button class="arr" data-d="1">▶</button></span>`;
        row.querySelectorAll('.arr').forEach((b) => b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.cursor = i;
          this.change(r.key, Number(b.dataset.d));
        }));
      }
      row.addEventListener('click', () => { this.cursor = i; if (r.key === 'start') this.tryStart(); else this.renderLobby(); });
      this.rowsEl.appendChild(row);
    });
    this.renderPreview();
    if (!this.hintEl.classList.contains('flash')) {
      const n = app.players.length;
      this.hintEl.textContent = n === 0 ? 'Up to 4 players. Each controller or keyboard layout joins as its own player.'
        : `${n} player${n > 1 ? 's' : ''} ready · choose START or press Menu / Options / Esc`;
    }
  }

  renderPreview() {
    const def = MAPS[this.settings.map];
    let world = this.previewCache.get(def.id);
    if (!world) { world = new World(def); this.previewCache.set(def.id, world); }
    const c = this.previewCanvas, g = c.getContext('2d');
    const th = THEME_PREVIEW[def.theme];
    const cell = Math.min(c.width / world.w, c.height / world.h);
    const ox = (c.width - cell * world.w) / 2, oy = (c.height - cell * world.h) / 2;
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = th.bg;
    g.fillRect(ox, oy, cell * world.w, cell * world.h);
    for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) {
      const t = world.tile(x, y);
      if (t === SOLID) g.fillStyle = th.wall;
      else if (t === PLATFORM) g.fillStyle = th.plat;
      else continue;
      const py = oy + (world.h - 1 - y) * cell;
      if (t === PLATFORM) g.fillRect(ox + x * cell, py, cell, Math.max(1, cell * 0.3));
      else g.fillRect(ox + x * cell, py, cell + 0.5, cell + 0.5);
    }
    const dot = (pts, color, r) => {
      g.fillStyle = color;
      for (const p of pts) { g.beginPath(); g.arc(ox + p.x * cell, oy + (world.h - p.y) * cell, r, 0, Math.PI * 2); g.fill(); }
    };
    dot(world.rifts, '#c04dff', Math.max(2, cell * 0.4));
    dot(world.spawns, '#35e0ff', Math.max(2, cell * 0.4));
    const shared = world.w <= 36 && world.h <= 22;
    this.lobby.querySelector('.map-name').textContent = def.name;
    this.lobby.querySelector('.tags').innerHTML = [
      def.gravity ? 'Gravity' : 'Zero-G',
      shared ? 'Single screen' : 'Split screen',
      def.wrap ? 'Wrap-around' : `${world.w}×${world.h}`,
    ].map((t) => `<span>${t}</span>`).join('');
    this.lobby.querySelector('.desc').textContent = def.desc;
  }

  updateLobby() {
    const app = this.app;
    this.updateSound();
    let changed = false;
    for (const dev of app.input.all()) {
      if (!dev.connected) continue;
      const player = app.players.find((p) => p.deviceId === dev.id);
      if (!player) {
        if (dev.pressed('confirm') && app.players.length < 4) { app.join(dev); changed = true; }
        continue;
      }
      if (dev.pressed('back')) { app.leave(player); changed = true; continue; }
      const rows = this.rows();
      if (dev.pressed('up')) { this.cursor = (this.cursor - 1 + rows.length) % rows.length; sfx.ui(); changed = true; }
      if (dev.pressed('down')) { this.cursor = (this.cursor + 1) % rows.length; sfx.ui(); changed = true; }
      const key = rows[this.cursor].key;
      if (key !== 'start') {
        if (dev.pressed('left')) { this.change(key, -1); return; }
        if (dev.pressed('right')) { this.change(key, 1); return; }
      }
      if (dev.pressed('confirm')) { this.activate(key); return; }
      if (dev.pressed('start')) { this.tryStart(); return; }
    }
    if (changed) this.renderLobby();
  }

  // ---------------------------------------------------------------------------
  // Generic button list screens (pause, results)

  buildList(cls) {
    const s = el('div', `screen ${cls} hidden`);
    s.innerHTML = '<div class="panel"><h2></h2><div class="body"></div><div class="buttons"></div></div>';
    this.root.appendChild(s);
    return s;
  }

  setButtons(screen, items) {
    const box = screen.querySelector('.buttons');
    box.innerHTML = '';
    this.items = items;
    this.focus = 0;
    items.forEach((it, i) => {
      const b = el('button', 'btn', it.label);
      b.addEventListener('click', () => it.action());
      b.addEventListener('mouseenter', () => { this.focus = i; this.paintFocus(screen); });
      box.appendChild(b);
    });
    this.paintFocus(screen);
  }

  paintFocus(screen) {
    [...screen.querySelectorAll('.btn')].forEach((b, i) => b.classList.toggle('sel', i === this.focus));
  }

  navigateList(screen, devices, onBack) {
    for (const dev of devices) {
      if (!dev || !dev.connected) continue;
      if (dev.pressed('up')) { this.focus = (this.focus - 1 + this.items.length) % this.items.length; sfx.ui(); this.paintFocus(screen); }
      if (dev.pressed('down')) { this.focus = (this.focus + 1) % this.items.length; sfx.ui(); this.paintFocus(screen); }
      if (dev.pressed('confirm')) { sfx.uiConfirm(); this.items[this.focus].action(); return; }
      if (onBack && (dev.pressed('back') || dev.pressed('start'))) { onBack(); return; }
    }
  }

  buildPause() {
    this.pause = this.buildList('pause');
    this.pause.querySelector('h2').textContent = 'PAUSED';
  }

  showPause(message = '') {
    this.pause.querySelector('.body').textContent = message;
    this.setButtons(this.pause, [
      { label: 'Resume', action: () => this.app.resume() },
      { label: 'Restart match', action: () => this.app.restart() },
      { label: 'Quit to lobby', action: () => this.app.toLobby() },
    ]);
    this.pause.classList.remove('hidden');
  }

  buildResults() {
    this.results = this.buildList('results');
  }

  showResults(r) {
    const h = this.results.querySelector('h2');
    const players = r.players.slice();
    if (r.mode === 'pvp') {
      h.innerHTML = `<span style="color:${r.winner.color.css}">${r.winner.name}</span> WINS THE MATCH`;
      players.sort((a, b) => b.wins - a.wins || b.kills - a.kills);
    } else {
      h.textContent = `OVERRUN AT WAVE ${r.wave}`;
      players.sort((a, b) => b.score - a.score);
    }
    const head = r.mode === 'pvp' ? '<th>Rounds</th><th>Kills</th><th>Deaths</th>' : '<th>Score</th><th>Kills</th><th>Deaths</th>';
    const body = players.map((p) => `<tr><td style="color:${p.color.css}">${p.name}</td>${
      r.mode === 'pvp' ? `<td>${p.wins}</td>` : `<td>${p.score}</td>`}<td>${p.kills}</td><td>${p.deaths}</td></tr>`).join('');
    let extra = '';
    if (r.mode === 'pve' && r.best) extra = `<p class="best">Best on this map: wave ${r.best.wave} · ${r.best.score} pts${r.best.isNew ? ' — new record!' : ''}</p>`;
    this.results.querySelector('.body').innerHTML = `<table><tr><th></th>${head}</tr>${body}</table>${extra}`;
    this.setButtons(this.results, [
      { label: 'Rematch', action: () => this.app.restart() },
      { label: 'Back to lobby', action: () => this.app.toLobby() },
    ]);
    this.results.classList.remove('hidden');
  }

  buildNotice() {
    this.notice = el('div', 'notice hidden');
    this.root.appendChild(this.notice);
  }

  showNotice(msg) {
    this.notice.textContent = msg;
    this.notice.classList.remove('hidden');
    clearTimeout(this.noticeT);
    this.noticeT = setTimeout(() => this.notice.classList.add('hidden'), 2600);
  }

  show(screen) {
    this.lobby.classList.toggle('hidden', screen !== 'lobby');
    this.pause.classList.toggle('hidden', screen !== 'pause');
    this.results.classList.toggle('hidden', screen !== 'results');
    if (screen === 'lobby') this.renderLobby();
  }
}
