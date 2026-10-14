// Unified input for gamepads (Xbox / PlayStation via the standard Gamepad API
// mapping) and two keyboard layouts sharing one keyboard.

const DEADZONE = 0.24;

const ACTIONS = ['thrust', 'fire', 'dash', 'start', 'confirm', 'back', 'up', 'down', 'left', 'right'];

// Standard mapping button indices.
const GP = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

const KEY_LAYOUTS = {
  kb1: {
    label: 'Keyboard (WASD)',
    up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    thrust: ['KeyW'],
    fire: ['Space', 'KeyF'],
    dash: ['ShiftLeft', 'KeyG'],
    confirm: ['Space'],
    back: ['ShiftLeft'],
    start: ['Escape'],
    glyphs: { confirm: 'Space', back: 'L-Shift', fire: 'Space', dash: 'L-Shift', thrust: 'W', start: 'Esc' },
  },
  kb2: {
    label: 'Keyboard (Arrows)',
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    thrust: ['ArrowUp'],
    fire: ['Enter', 'NumpadEnter', 'Numpad0', 'ControlRight', 'Slash'],
    dash: ['ShiftRight', 'Period', 'NumpadDecimal'],
    confirm: ['Enter', 'NumpadEnter'],
    back: ['ShiftRight'],
    start: ['Escape'],
    glyphs: { confirm: 'Enter', back: 'R-Shift', fire: 'Enter', dash: 'R-Shift', thrust: '↑', start: 'Esc' },
  },
};

const GLYPHS = {
  xbox: { confirm: 'A', back: 'B', fire: 'X / RT', dash: 'B / LT', thrust: 'A', start: 'Menu' },
  playstation: { confirm: '✕', back: '○', fire: '□ / R2', dash: '○ / L2', thrust: '✕', start: 'Options' },
  generic: { confirm: 'A', back: 'B', fire: 'X / RT', dash: 'B / LT', thrust: 'A', start: 'Start' },
};

function detectPadType(id) {
  const s = id.toLowerCase();
  if (s.includes('045e') || s.includes('xbox') || s.includes('xinput') || s.includes('microsoft')) return 'xbox';
  if (s.includes('054c') || s.includes('dualshock') || s.includes('dualsense') ||
      s.includes('playstation') || s.includes('wireless controller') || s.includes('ps4') || s.includes('ps5')) {
    return 'playstation';
  }
  return 'generic';
}

function blankState() {
  const s = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, aimActive: false, analog: false };
  for (const a of ACTIONS) s[a] = false;
  return s;
}

function radial(x, y) {
  const m = Math.hypot(x, y);
  if (m < DEADZONE) return [0, 0];
  const k = Math.min(1, (m - DEADZONE) / (1 - DEADZONE)) / m;
  return [x * k, y * k];
}

class Device {
  constructor(id, kind) {
    this.id = id;
    this.kind = kind;
    this.connected = true;
    this.state = blankState();
    this.prev = blankState();
    this.latch = {};
  }
  held(action) { return this.state[action]; }
  // Edge since the previous frame (menus).
  pressed(action) { return this.state[action] && !this.prev[action]; }
  // Edge since the last simulation step consumed it (gameplay, which runs at a fixed rate).
  hit(action) { return !!this.latch[action]; }
  updateLatch() { for (const a of ACTIONS) if (this.pressed(a)) this.latch[a] = true; }
  clearLatch() { this.latch = {}; }
  anyPressed() { return ACTIONS.some((a) => this.pressed(a)); }
  rumble() {}
}

class GamepadDevice extends Device {
  constructor(pad) {
    super(`gp${pad.index}`, 'gamepad');
    this.index = pad.index;
    this.padId = pad.id;
    this.type = detectPadType(pad.id);
    this.label = this.type === 'playstation' ? 'PlayStation controller' : this.type === 'xbox' ? 'Xbox controller' : 'Gamepad';
    this.glyphs = GLYPHS[this.type];
    this.pad = pad;
  }
  read(pad) {
    this.pad = pad;
    const b = (i) => {
      const btn = pad.buttons[i];
      return !!btn && (btn.pressed || btn.value > 0.45);
    };
    const ax = (i) => pad.axes[i] || 0;
    const s = this.state;
    let [mx, my] = radial(ax(0), -ax(1));
    // D-pad overrides the stick when held.
    const dx = (b(GP.RIGHT) ? 1 : 0) - (b(GP.LEFT) ? 1 : 0);
    const dy = (b(GP.UP) ? 1 : 0) - (b(GP.DOWN) ? 1 : 0);
    if (dx || dy) {
      const m = Math.hypot(dx, dy);
      mx = dx / m; my = dy / m;
    }
    s.moveX = mx; s.moveY = my;
    const [rx, ry] = radial(ax(2), -ax(3));
    s.aimX = rx; s.aimY = ry;
    s.aimActive = Math.hypot(rx, ry) > 0.35;
    s.analog = !(dx || dy);
    s.thrust = b(GP.A);
    s.fire = b(GP.X) || b(GP.Y) || b(GP.RB) || b(GP.RT);
    s.dash = b(GP.B) || b(GP.LB) || b(GP.LT);
    s.start = b(GP.START);
    s.confirm = b(GP.A);
    s.back = b(GP.B);
    s.up = my > 0.6;
    s.down = my < -0.6;
    s.left = mx < -0.6;
    s.right = mx > 0.6;
  }
  rumble(strength = 0.6, ms = 160) {
    const act = this.pad && this.pad.vibrationActuator;
    if (!act || !act.playEffect) return;
    try {
      act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.7 }).catch(() => {});
    } catch { /* unsupported */ }
  }
}

class KeyboardDevice extends Device {
  constructor(id, keys, tapped) {
    super(id, 'keyboard');
    this.tapped = tapped;
    this.layout = KEY_LAYOUTS[id];
    this.label = this.layout.label;
    this.type = 'keyboard';
    this.glyphs = this.layout.glyphs;
    this.keys = keys;
  }
  read() {
    const L = this.layout;
    // A key tapped and released between two frames still counts as held for one frame.
    const any = (codes) => codes.some((c) => this.keys.has(c) || this.tapped.has(c));
    const s = this.state;
    const x = (any(L.right) ? 1 : 0) - (any(L.left) ? 1 : 0);
    const y = (any(L.up) ? 1 : 0) - (any(L.down) ? 1 : 0);
    const m = Math.hypot(x, y) || 1;
    s.moveX = x / m; s.moveY = y / m;
    s.aimX = 0; s.aimY = 0; s.aimActive = false; s.analog = false;
    s.thrust = any(L.thrust);
    s.fire = any(L.fire);
    s.dash = any(L.dash);
    s.start = any(L.start);
    s.confirm = any(L.confirm);
    s.back = any(L.back);
    s.up = y > 0; s.down = y < 0; s.left = x < 0; s.right = x > 0;
  }
}

const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash', 'Enter', 'Tab']);

export class Input {
  constructor() {
    this.keys = new Set();
    this.tapped = new Set();
    this.devices = new Map();
    this.onActivity = null;
    for (const id of Object.keys(KEY_LAYOUTS)) this.devices.set(id, new KeyboardDevice(id, this.keys, this.tapped));

    window.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code) && !(e.target instanceof HTMLInputElement)) e.preventDefault();
      this.keys.add(e.code);
      this.tapped.add(e.code);
      this.onActivity && this.onActivity();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('pointerdown', () => this.onActivity && this.onActivity());
    window.addEventListener('gamepadconnected', (e) => this.onPadEvent && this.onPadEvent('connected', e.gamepad));
    window.addEventListener('gamepaddisconnected', (e) => this.onPadEvent && this.onPadEvent('disconnected', e.gamepad));
  }

  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const seen = new Set();
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const id = `gp${pad.index}`;
      seen.add(id);
      let dev = this.devices.get(id);
      if (!dev || dev.padId !== pad.id) {
        dev = new GamepadDevice(pad);
        this.devices.set(id, dev);
      }
      dev.connected = true;
    }
    for (const dev of this.devices.values()) {
      Object.assign(dev.prev, dev.state);
      if (dev.kind === 'gamepad') {
        if (!seen.has(dev.id)) {
          dev.connected = false;
          Object.assign(dev.state, blankState());
          continue;
        }
        dev.read(pads[dev.index]);
        if (dev.anyPressed() && this.onActivity) this.onActivity();
      } else {
        dev.read();
      }
      dev.updateLatch();
    }
    this.tapped.clear();
  }

  clearLatches() {
    for (const dev of this.devices.values()) dev.clearLatch();
  }

  get(id) { return this.devices.get(id); }
  all() { return [...this.devices.values()]; }
  padCount() { return this.all().filter((d) => d.kind === 'gamepad' && d.connected).length; }
}
