// 2D overlay drawn on a canvas above the WebGL canvas.

import { SHIP } from './config.js';
import { clamp } from './util.js';

const FONT = "'Orbitron', 'Segoe UI', system-ui, sans-serif";

export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
  }

  clear() {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  draw(game) {
    this.clear();
    const c = this.ctx;
    for (const v of game.views) {
      c.save();
      c.beginPath();
      c.rect(v.rect.x, v.rect.y, v.rect.w, v.rect.h);
      c.clip();
      this.drawWorldMarks(game, v);
      if (v.kind === 'follow') {
        this.drawOffscreen(game, v);
        this.drawPanel(game, v.player, v.rect.x + 12, v.rect.y + 12, 'left');
        this.drawDeadNotice(game, v);
      } else if (v.kind === 'overview') {
        this.drawOverview(game, v);
      }
      c.restore();
    }
    // Viewport separators.
    if (game.views.length > 1) {
      c.fillStyle = '#000';
      for (const v of game.views) {
        if (v.rect.x > 0) c.fillRect(v.rect.x - 2, v.rect.y, 4, v.rect.h);
        if (v.rect.y > 0) c.fillRect(v.rect.x, v.rect.y - 2, v.rect.w, 4);
      }
    }
    if (game.shared) this.drawBar(game, game.views[0].rect.y);
    else this.drawTopInfo(game);
    this.drawBanner(game);
  }

  // Top strip used by the shared single-screen view: P1 P2 | info | P3 P4.
  drawBar(game, h) {
    const c = this.ctx;
    c.fillStyle = '#05070f';
    c.fillRect(0, 0, this.w, h);
    c.fillStyle = 'rgba(120,180,255,0.18)';
    c.fillRect(0, h - 1, this.w, 1);
    const mid = Math.min(170, this.w * 0.16);
    const slotW = (this.w - mid) / 4;
    for (const p of game.players) {
      const i = p.slot;
      const x = (i < 2 ? i * slotW : mid + i * slotW) + 4;
      this.drawCompact(game, p, x, 4, slotW - 8, h - 8);
    }
    const info = this.infoText(game);
    if (info) this.text(info, this.w / 2, h / 2 - 7, 12, '#c8d6f0', 'center');
  }

  drawCompact(game, p, x, y, w, h) {
    const c = this.ctx;
    const s = p.ship;
    c.fillStyle = 'rgba(255,255,255,0.04)';
    c.fillRect(x, y, w, h);
    c.fillStyle = p.color.css;
    c.fillRect(x, y, 3, h);
    this.text(p.name, x + 10, y + 4, 13, p.color.css, 'left', 800);
    const stat = game.mode === 'pvp' ? `★ ${p.wins}` : `${p.score}`;
    this.text(stat, x + w - 8, y + 5, 12, '#e6ecff', 'right');
    const py = y + h - 15;
    for (let i = 0; i < SHIP.maxAmmo; i++) {
      c.fillStyle = s.alive && i < s.ammo ? p.color.css : 'rgba(255,255,255,0.12)';
      const mx = x + 10 + i * 9;
      c.beginPath();
      c.moveTo(mx, py + 11);
      c.lineTo(mx + 6, py + 11);
      c.lineTo(mx + 6, py + 3);
      c.lineTo(mx + 3, py);
      c.lineTo(mx, py + 3);
      c.closePath();
      c.fill();
    }
    const fx = x + 10 + SHIP.maxAmmo * 9 + 6;
    let icons = '';
    if (s.alive && s.shield) icons += '◈ ';
    if (s.alive && s.spread > 0) icons += `≡${s.spread} `;
    if (game.mode === 'pve') icons += `♥${Math.max(0, p.lives)}`;
    c.font = `700 11px ${FONT}`;
    const iw = icons ? c.measureText(icons).width + 10 : 0;
    const fw = Math.max(16, x + w - 8 - iw - fx);
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.fillRect(fx, py + 5, fw, 4);
    c.fillStyle = s.alive && s.fuel < 0.25 ? '#ff6a6a' : '#9fe8ff';
    c.fillRect(fx, py + 5, fw * (s.alive ? s.fuel : 0), 4);
    if (icons) this.text(icons.trim(), x + w - 8, py, 11, '#ffd0d8', 'right');
  }

  infoText(game) {
    if (game.mode === 'pve') {
      const left = (game.queue ? game.queue.length : 0) + game.aliens.length + game.rifts.length;
      return game.wave ? `WAVE ${game.wave} · ${left} LEFT` : '';
    }
    return `ROUND ${game.round}`;
  }

  text(str, x, y, size, color, align = 'left', weight = 700) {
    const c = this.ctx;
    c.font = `${weight} ${size}px ${FONT}`;
    c.textAlign = align;
    c.textBaseline = 'top';
    c.lineWidth = Math.max(2, size / 6);
    c.strokeStyle = 'rgba(0,0,0,0.75)';
    c.strokeText(str, x, y);
    c.fillStyle = color;
    c.fillText(str, x, y);
  }

  // Ammo pips above ships, floating texts.
  drawWorldMarks(game, v) {
    const c = this.ctx;
    const scale = clamp(v.rect.h / 540, 0.7, 1.6);
    for (const s of game.ships()) {
      if (!s.alive) continue;
      const p = v.project(s.x, s.y + 0.62, 0);
      if (!p || !p.inside) continue;
      const n = s.ammo;
      const pw = 4 * scale, gap = 2 * scale;
      const total = n * pw + (n - 1) * gap;
      for (let i = 0; i < n; i++) {
        c.fillStyle = s.player.color.css;
        c.fillRect(p.x - total / 2 + i * (pw + gap), p.y - 9 * scale, pw, 7 * scale);
      }
      if (s.spread > 0) this.text('×3', p.x + total / 2 + 4, p.y - 12 * scale, 10 * scale, '#ffd36a');
      if (game.views.length > 1 || game.shared) {
        this.text(s.player.name, p.x, p.y - 24 * scale, 10 * scale, s.player.color.css, 'center');
      }
    }
    for (const t of game.texts) {
      const p = v.project(t.x, t.y, 0);
      if (!p || !p.inside) continue;
      const a = 1 - Math.max(0, (t.t - t.life * 0.6) / (t.life * 0.4));
      c.globalAlpha = a;
      this.text(t.text, p.x, p.y, 13 * scale, t.color, 'center');
      c.globalAlpha = 1;
    }
  }

  drawPanel(game, p, x, y, align) {
    const c = this.ctx;
    const s = p.ship;
    const dir = align === 'left' ? 1 : -1;
    const w = 176, h = 62;
    const bx = align === 'left' ? x : x - w;
    c.fillStyle = 'rgba(5,8,16,0.6)';
    c.fillRect(bx, y, w, h);
    c.fillStyle = p.color.css;
    c.fillRect(align === 'left' ? bx : bx + w - 3, y, 3, h);
    const tx = align === 'left' ? bx + 12 : bx + w - 12;
    this.text(p.name, tx, y + 6, 14, p.color.css, align, 800);
    const stat = game.mode === 'pvp' ? `★ ${p.wins}` : `${p.score}`;
    this.text(stat, align === 'left' ? bx + w - 10 : bx + 10, y + 7, 13, '#e6ecff', align === 'left' ? 'right' : 'left');
    // Missiles.
    for (let i = 0; i < SHIP.maxAmmo; i++) {
      const has = s.alive && i < s.ammo;
      c.fillStyle = has ? p.color.css : 'rgba(255,255,255,0.12)';
      const mx = tx + dir * i * 13 - (align === 'left' ? 0 : 8);
      c.beginPath();
      c.moveTo(mx, y + 40);
      c.lineTo(mx + 8, y + 40);
      c.lineTo(mx + 8, y + 30);
      c.lineTo(mx + 4, y + 26);
      c.lineTo(mx, y + 30);
      c.closePath();
      c.fill();
    }
    // Fuel / boost.
    const fw = 100;
    const fx = align === 'left' ? tx : tx - fw;
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.fillRect(fx, y + 47, fw, 5);
    c.fillStyle = s.alive && s.fuel < 0.25 ? '#ff6a6a' : '#9fe8ff';
    c.fillRect(fx, y + 47, fw * (s.alive ? s.fuel : 0), 5);
    // Status icons.
    let ix = align === 'left' ? fx + fw + 8 : fx - 8;
    const icons = [];
    if (s.alive && s.shield) icons.push(['◈', '#7fd8ff']);
    if (s.alive && s.spread > 0) icons.push([`≡${s.spread}`, '#ffd36a']);
    if (game.mode === 'pve') icons.push([`♥${Math.max(0, p.lives)}`, '#ff7a8a']);
    for (const [str, col] of icons) {
      this.text(str, ix, y + 40, 12, col, align);
      ix += dir * (str.length * 9 + 8);
    }
  }

  drawDeadNotice(game, v) {
    const p = v.player;
    if (p.ship.alive) return;
    const cx = v.rect.x + v.rect.w / 2, cy = v.rect.y + v.rect.h * 0.62;
    let msg, sub = '';
    if (game.mode === 'pve') {
      if (p.lives > 0) msg = `RESPAWN IN ${Math.max(0, p.respawnT).toFixed(1)}`;
      else { msg = 'OUT OF LIVES'; sub = 'Back in after this wave if a teammate survives'; }
    } else {
      msg = 'ELIMINATED';
      sub = 'Spectating';
    }
    this.text(msg, cx, cy, 22, p.color.css, 'center', 800);
    if (sub) this.text(sub, cx, cy + 30, 13, '#c8d0e0', 'center', 500);
  }

  // Arrows at the viewport edge pointing to other players.
  drawOffscreen(game, v) {
    const c = this.ctx;
    for (const s of game.ships()) {
      if (!s.alive || s.player === v.player) continue;
      const p = v.project(s.x, s.y, 0);
      if (!p || p.inside) continue;
      const ang = Math.atan2(-p.ny, p.nx);
      const m = 22;
      const cx = v.rect.x + v.rect.w / 2, cy = v.rect.y + v.rect.h / 2;
      const kx = (v.rect.w / 2 - m) / Math.max(1e-6, Math.abs(Math.cos(ang)));
      const ky = (v.rect.h / 2 - m) / Math.max(1e-6, Math.abs(Math.sin(ang)));
      const k = Math.min(kx, ky);
      const ax = cx + Math.cos(ang) * k, ay = cy + Math.sin(ang) * k;
      c.save();
      c.translate(ax, ay);
      c.rotate(ang);
      c.fillStyle = s.player.color.css;
      c.beginPath();
      c.moveTo(10, 0);
      c.lineTo(-6, -7);
      c.lineTo(-6, 7);
      c.closePath();
      c.fill();
      c.restore();
      this.text(s.player.name, ax - Math.cos(ang) * 18, ay - Math.sin(ang) * 18 - 6, 10, s.player.color.css, 'center');
    }
  }

  drawOverview(game, v) {
    const c = this.ctx;
    this.text('TACTICAL', v.rect.x + 12, v.rect.y + 10, 13, '#9fe8ff');
    for (const a of game.aliens) {
      const p = v.project(a.x, a.y, 0);
      if (!p) continue;
      c.fillStyle = '#ff5050';
      c.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    for (const s of game.ships()) {
      if (!s.alive) continue;
      const p = v.project(s.x, s.y, 0);
      if (!p) continue;
      c.strokeStyle = s.player.color.css;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(p.x, p.y, 7, 0, Math.PI * 2);
      c.stroke();
      this.text(s.player.name, p.x, p.y + 9, 10, s.player.color.css, 'center');
    }
  }

  drawTopInfo(game) {
    const str = this.infoText(game);
    if (!str) return;
    const c = this.ctx;
    c.font = `700 12px ${FONT}`;
    const w = c.measureText(str).width + 24;
    const x = this.w / 2;
    c.fillStyle = 'rgba(5,8,16,0.6)';
    c.fillRect(x - w / 2, 0, w, 24);
    this.text(str, x, 6, 12, '#c8d6f0', 'center');
  }

  drawBanner(game) {
    const b = game.banner;
    if (!b) return;
    const c = this.ctx;
    const inT = Math.min(1, b.t / 0.2);
    const outT = Math.min(1, (b.life - b.t) / 0.3);
    const a = Math.max(0, Math.min(inT, outT));
    c.globalAlpha = a;
    const y = this.h * 0.36;
    const size = clamp(this.w / 22, 26, 64);
    c.fillStyle = 'rgba(3,5,12,0.55)';
    c.fillRect(0, y - size * 0.4, this.w, size * (b.sub ? 2.4 : 1.8));
    this.text(b.text, this.w / 2, y - size * 0.1 + (1 - inT) * 10, size, b.color, 'center', 900);
    if (b.sub) this.text(b.sub, this.w / 2, y + size * 1.1, Math.max(13, size * 0.32), '#d8e0f0', 'center', 500);
    c.globalAlpha = 1;
  }
}
