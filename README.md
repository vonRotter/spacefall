# Spacefall

A TowerFall-style local multiplayer arena shooter with tiny spaceships, built with three.js.
1–4 players on one computer, using Xbox controllers, PlayStation controllers, or keyboard.

- **Versus (PvP):** last ship standing wins the round; first to N rounds wins the match.
  Optional alien hazards drift in during rounds.
- **Co-op (PvE):** survive escalating waves of aliens together. Each player has a number of lives,
  and teammates who run out rejoin after the wave if anyone survives.

Each ship carries a few missiles. Fired missiles stick in walls and have to be flown over to pick
them up again. A dash gives brief invulnerability and catches incoming missiles in Versus.
In gravity maps you can stomp other ships and aliens by landing on them.

## Maps

| Map | Setting | Movement | Screen |
| --- | --- | --- | --- |
| Derelict Hub | Gutted docking hub | Gravity | Single screen, edges wrap |
| Ice Drift | Tight asteroid cluster | Zero-g | Single screen, edges wrap |
| Cargo Bay 7 | Six-deck freight station | Gravity | Split screen |
| Kessler Belt | Sprawling debris belt | Zero-g | Split screen |
| Hive Hulk | Station overgrown by the swarm | Gravity | Split screen |
| Gravity Failure | Station with dead gravity generators | Zero-g | Split screen |

Maps that fit on one screen use a single shared camera. Larger maps give every player their own
viewport, and all viewports are always the same size: halves for 2 players, quarters for 3–4
(with 3 players the fourth quarter shows a tactical overview of the whole map).

## Aliens

| Alien | Behavior |
| --- | --- |
| Crawler | Walks along floors, hops between decks (gravity maps) |
| Spore | Slow drifting blob (zero-g stand-in for the crawler) |
| Wisp | Fast flying drone that weaves toward you |
| Spitter | Keeps its distance and lobs acid bolts (from wave 3) |
| Brute | Four hits to kill; winds up and charges (from wave 5) |

## Controls

| Action | Gamepad (Xbox / PlayStation) | Keyboard 1 | Keyboard 2 |
| --- | --- | --- | --- |
| Join (lobby) | A / ✕ | Space | Enter |
| Leave (lobby) | B / ○ | Left Shift | Right Shift |
| Move / aim | Left stick or D-pad | WASD | Arrow keys |
| Thrust (gravity) / boost (zero-g) | A / ✕ | W | ↑ |
| Fire | X / □, RB / R1, RT / R2 | Space or F | Enter, Right Ctrl, Numpad 0 or / |
| Dash | B / ○, LB / L1, LT / L2 | Left Shift or G | Right Shift, . or Numpad . |
| Free aim (optional) | Right stick | (aims where you move) | (aims where you move) |
| Drop through a platform | Hold down | S | ↓ |
| Pause | Menu / Options | Esc | Esc |
| Mute | | M | M |

The zero-g boost is gamepad-only, because on the keyboard the thrust key is also "up".

## Play locally

The game is plain HTML and ES modules with three.js vendored in `vendor/three`, so there is no
build step and nothing to install. Any static file server works:

```sh
node tools/serve.mjs          # http://localhost:8080
# or: python3 -m http.server 8080
```

Opening `index.html` straight from the file system does not work, because browsers block ES
module imports from `file://` pages.

### Controllers

- Connect the controllers (USB or Bluetooth) before or after opening the page, then **press a
  button**. Browsers only expose a gamepad to a page after it has been pressed while the page is
  open (MDN Web Docs, n.d.).
- Keep the game window focused. Browsers stop delivering gamepad input to background tabs.
- Chrome and Edge give Xbox and PlayStation (DualShock 4, DualSense) controllers the "standard"
  button layout this game uses (W3C, n.d.). Firefox may report a non-standard layout for some
  controllers on some operating systems, in which case buttons can end up mismatched; use Chrome
  or Edge if that happens.
- Sound starts after the first click or key press, since browsers keep audio locked until then.
  The lobby shows a "Sound off · click to enable" button while it is locked.

## Publish on GitHub Pages

The repository root is the site, so no workflow is needed:

1. Push the branch you want to publish (for example `main`).
2. On GitHub, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**, pick that branch and
   the `/ (root)` folder, and save (GitHub Docs, n.d.).
4. After a minute the game is live at `https://<user>.github.io/<repo>/`.

`.nojekyll` is included so Pages serves every file as-is.

## Project layout

```
index.html, style.css     page shell and menu styling
src/main.js               app loop, lobby/game/pause/results flow
src/game.js               match logic: PvP rounds, PvE waves, collisions
src/entities/             ship, aliens, missiles/crates/bolts/rifts
src/world.js              tile grid, collision, line of sight, alien flow field
src/maps.js               map layouts and the asteroid/hive generators
src/level.js              3D map meshes and space backdrop
src/views.js              split-screen layout and cameras
src/hud.js                2D overlay (ammo, fuel, lives, banners, off-screen markers)
src/menu.js               lobby, pause and results screens
src/input.js              gamepads and the two keyboard layouts
src/audio.js              synthesized sound effects
src/config.js             tuning constants
tools/                    local server, map validator and headless tests
```

## Tests

```sh
node tools/validate-maps.mjs   # widths, spawns, closed borders, reachability
node tools/smoke-test.mjs out  # headless Chromium with 4 fake gamepads, saves screenshots
node tools/sim-test.mjs        # bots play every map in PvP and PvE without rendering
```

The two browser tests need Playwright with Chromium installed.

## References

GitHub Docs. (n.d.). *Configuring a publishing source for your GitHub Pages site*. GitHub.
https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

MDN Web Docs. (n.d.). *Using the Gamepad API*. Mozilla.
https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API

three.js authors. (2026). *three.js* (Version 0.185.1) [Computer software]. https://threejs.org

W3C. (n.d.). *Gamepad* [Working draft]. https://www.w3.org/TR/gamepad/
