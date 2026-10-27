# LAMPKEEPER

A small single-player suspense game for desktop, phones and tablets. You are the caretaker of an
apartment building after midnight: restore broken lights while a shadow creature walks the dark
corridors. **Working building lights keep it away; darkness is dangerous.** Only two of the three
circuits can be powered at once, so choosing which route to light is the puzzle.

Five story shifts (about 2–4 minutes each for a new player, still to be confirmed by playtesting),
six short story records, and a seeded replay mode that unlocks after shift 5.

Built with TypeScript, Vite, Three.js and a plain HTML/CSS HUD. There is no backend.

## Quick start

```bash
npm install          # .npmrc sets legacy-peer-deps (works around an npm 10.9 peer-resolution crash)
npm run dev          # http://localhost:5173
npm run typecheck
npm test             # Vitest: rules, AI, generation, saves, platform, full playthroughs
npm run build        # production build → dist/
npm run preview      # serve dist/ locally
npm run build:poki   # Poki variant → dist-poki/ (adds the official SDK script tag)
```

Developed on Node 23.6. Vitest 5 officially supports Node 22.12+ or 24+, so a current LTS release is
the safer choice for CI.

The production build uses relative asset paths (`base: './'`), so `dist/` can be hosted from any
sub-path.

## Controls

| | Desktop | Touch (phones, tablets, touch hybrids) |
| --- | --- | --- |
| Move | WASD or arrow keys (screen-relative) | Drag anywhere in the lower-left area (floating joystick) |
| Act | **E** or **Space**: hold to repair, press to switch, help or exit | Big lower-right button; its icon and label change: REPAIR / SWITCH / HELP / EXIT |
| Pause | **Esc** (Space never pauses) | Pause button, top right |
| Menus | Mouse, or arrows + Enter, Esc to go back | Tap |

Touch controls appear on any touch-capable device, including wide tablets. Settings has an
Auto / On / Off override for hybrid devices.

## Rules in one minute

- **Building fixtures** (wall sconces and floor lamps) protect the floor around them when they are
  powered *and* working. The protected area is drawn as a warm amber footprint with a bright edge.
  It never reaches through walls.
- **Your lantern** only helps you see. It does **not** keep the creature away.
- **Circuits A ▲ / B ● / C ■**: up to two can be on at once. If power is full, switch another
  circuit off first. A circuit you switch off flickers its footprint for about a second before going
  dark. Operate circuits at breaker switches: there is a panel in the maintenance nook, and remote
  panels have a small emergency light.
- **Repairs**: hold the action button for about 1.5 s at a broken lamp (wrench icon). Repairing and
  powering are separate: a repaired lamp on a switched-off circuit stays dark.
- **The creature** patrols the dark. When it spots you, its eyes light up and it pauses for about
  0.8 s, then gives chase. It cannot enter protected light. If a circuit turns on around it, it
  retreats out of the light without attacking.
- **Three repairs** open the exit. The final landing always has emergency lighting.
- **Optional tenants** (shifts 3–4 and some replays) wait at lit doorways. One press helps them,
  and they share a story record.

## Playing and testing

- Normal play: `npm run dev`, then open the page and press any key or tap.
- **Development tools** (dev server only, never in release builds):
  - `?shift=N&seed=S` starts a given shift and seed (`shift=0` is replay).
  - **F2**: collision overlay. **F3**: FPS, draw calls, seed and state panel. **F4**: autopilot.
  - `window.__lk` exposes the game, the autopilot and a screen-space intent helper for automation.
- Browser checks (Playwright driving an installed Edge; set `LK_BROWSER=chrome` to use Chrome):
  - With `npm run dev` running, use `LK_URL` to point at another port:
    `npm run e2e:keyboard`, `e2e:touch`, `e2e:multitouch`, `e2e:lifecycle`, `e2e:menus`.
  - After `npm run build`: `npm run e2e:smoke` and `npm run e2e:startup`.
  - After `npm run build:poki`: `npm run e2e:poki`.
  - Screenshots go to `test-artifacts/`, which git ignores.

See [docs/TESTING.md](docs/TESTING.md) for what was actually run and what still needs physical
devices.

## Local vs Poki builds

- `npm run build` (local) uses no SDK and simulates no ads. The platform adapter is a no-op.
- `npm run build:poki` injects `<script src="https://game-cdn.poki.com/scripts/v2/poki-sdk.js">`
  (the official loading method) and enables the Poki adapter. If the SDK is missing, blocked or
  slow, the game still starts.
- Nothing has been submitted to Poki. [docs/POKI_CHECKLIST.md](docs/POKI_CHECKLIST.md) lists the
  Inspector, tone-review and thumbnail work that remains.

## Project layout

```text
src/
  main.ts                  entry
  game/                    Game orchestration (states, run lifecycle), Tutorial, config.ts (tuning), types
  simulation/              World (authoritative), grid geometry, circuits, protection mask, seeded RNG
  ai/                      Creature state machine, NavGrid (bounded Dijkstra)
  levels/                  3 floor templates, parser, 5 shift definitions + replay, seeded generation + validator, story
  rendering/               theme.ts (look), voxel builder, model builders, LevelView, actor views, effects, camera, renderer
  input/                   keyboard/touch abstraction, virtual joystick + action button
  ui/                      HUD, menus, strings (all player-facing text), icons, styles.css (UI tokens)
  audio/                   procedural Web Audio (no audio files)
  platform/                Poki/local adapter + session guard, pause reasons, versioned save, local diagnostics
  dev/                     autopilot bot and dev tools (dev-only)
tests/                     Vitest suites; tests/e2e/ browser checks
docs/                      DESIGN, TESTING, POKI_CHECKLIST, VISUAL_GUIDE, screenshots, reference/
```

To change the look, start with [docs/VISUAL_GUIDE.md](docs/VISUAL_GUIDE.md). The concept image in
`docs/reference/` is reference only and is not bundled.

## Assets and licences

All geometry, textures (canvas-drawn labels and icons), SVG icons and sounds (Web Audio synthesis)
are generated in code for this project. No fonts are bundled: the UI uses system font stacks.
Runtime dependency: [three](https://threejs.org) (MIT).
