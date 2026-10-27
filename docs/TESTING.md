# Testing record

Every check below was run on 2026-10-27, on Windows 11, Node 23.6, and Microsoft Edge (Chromium)
driven headless by Playwright with **software WebGL (SwiftShader)**. The results fall into four
categories, and the sections below keep them separate:

- **Automated**: Vitest, simulation only, no browser.
- **Browser emulation**: real game code in a real browser, with emulated viewports and touch.
- **Real devices**: none were used.
- **Platform**: Poki checks, tried only against a stub SDK.

No physical phone or tablet was used, and nothing ran on Poki.

## 1. Type check, unit and simulation tests: passed

`npm run typecheck` passes with no errors.

`npm test` runs 9 files and **79 tests, all passing**, in about 2 s.

| Suite | What it proves |
| --- | --- |
| `circuits.test.ts` | Capacity can never be exceeded. Power-full keeps the allocation unchanged. A switch-off still counts against capacity until its warning ends. Cancel works. Protection disappears only after about 1 s. |
| `protection.test.ts` | On every template, **no lamp protects a cell behind a wall**, even inside its radius (more than 10 such cases per template, so the check is meaningful). Broken and unpowered lamps are distinguishable and both leave darkness. A repaired lamp is safe only once powered. Emergency cells are always lit. Player safety reads the same mask as the footprint and the creature. |
| `creature.test.ts` | Across 15 full autopilot runs the creature **never stands in a protected cell while hunting**. When relit it **retreats without capturing** and ends in the dark. With no dark route left it **dissolves**, then returns telegraphed, at least 9 units away with no line of sight. **No capture through a wall.** A **protected player is never caught** at the boundary. Capture needs a sustained 0.3 s contact. There is about 0.8 s of warning before a chase. The tutorial demonstration is harmless and stops at the light. Navigation work is bounded. |
| `interaction.test.ts` | **No targeting through walls.** From every standable cell on every template, a highlighted target is in range with a clear line. Nearest target wins with a stable tie-break. One press flips exactly one switch. The 1.5 s repair hold cancels on release with no partial progress, and also cancels when you walk out of range. A completed hold does not trigger anything else. Repairs work on unpowered circuits. The exit opens after three repairs whatever the power. A tenant is helped once. |
| `generation.test.ts` | **The same seed reproduces the setup and the creature's behaviour.** Seeds vary layouts. Cosmetic streams are independent. Every default seed validates without fallback. Across 60 seeds per shift, every result validates and fallback use stays under 3. Authored fallbacks are valid. The fallback is used after the bounded attempts when no combination can pass. The validator rejects concrete faults. The power-aware check fails when the exposure limit is impossible. Progression facts hold. |
| `storage.test.ts` | Save round-trip. **Corrupt JSON resets.** Invalid fields are sanitised. A v1 save migrates. **Storage that throws on read or write leaves the game playable with session-only progress.** A missing storage object is handled. Records survive a failed attempt. |
| `platform.test.ts` | Loading is reported once. **No duplicate start/stop.** Gameplay stops before a break. **No events during a break.** Error and no-ad outcomes continue. A second break request is ignored. The Poki adapter copes with a missing SDK and a hanging `init()`. **Pause reasons compose**: an ad ending does not resume a hidden tab or an open menu. |
| `templates.test.ts` | Required markers exist. Every door is labelled. **Every floor cell is reachable.** Furniture never blocks a doorway. Tenant spots are valid. 104 is the final exit. |
| `playthrough.test.ts` | The **autopilot completes all five story shifts** on their default seeds with zero captures, and progression reaches the ending and unlocks replay. **12 of 12 replay seeds complete.** Tenants are helped in shifts 3–4. The ending does not need optional content. A retry rebuilds a clean, identical run. |

The autopilot (`src/dev/bot.ts`) only uses the same input the keyboard and touch produce: a
movement vector and one action. It is omniscient, though: it knows the map and the creature's
position. Its completion times (about 20–60 s of simulated time per shift) are **not** a pacing
measure for new players.

Bugs found and fixed by these tests:

- Ring template: a table blocked apartment 201's doorway, and a corner cell was unreachable.
- A shift 4 fallback had no valid spawn once the pocket rule was added.
- Repair movement was so slow you could never walk out of range before the repair finished.
- The creature could camp forever in the dark room holding a required repair. This is fixed by the
  pocket rule described in DESIGN.md.

## 2. Production build: passed

`npm run build` and `npm run build:poki` both pass. **Measured output:**

| File | Size | Gzipped |
| --- | --- | --- |
| JS | 701 KB | 184.5 KB |
| CSS | 14.1 KB | 3.9 KB |
| HTML | 1.2 KB | 0.7 KB |
| **Total** | | **about 189 KB** |

That is well under the 5 MB goal. The release bundle contains no dev tools or autopilot code (string
grep). Its only URLs are XML/SVG namespace strings and a Three.js comment.

## 3. Browser checks (emulation): passed

**Production build**, `npm run e2e:smoke`, served under the sub-path `/games/lampkeeper/`:

| Viewport | Start screen | Touch UI | Play | Esc / pause button | Hidden tab → stays paused | Resize keeps run | Console errors | External requests | 404s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1280×720 desktop | 0.9 s | no | ✓ | ✓ | ✓ | ✓ | 0 | 0 | 0 |
| 640×360 | 0.5 s | no | ✓ | ✓ | ✓ | ✓ | 0 | 0 | 0 |
| 844×390 phone landscape (touch) | 0.6 s | yes | ✓ | ✓ | ✓ | ✓ | 0 | 0 | 0 |
| 390×844 phone portrait (touch) | 0.6 s | yes | ✓ | ✓ | ✓ | ✓ | 0 | 0 | 0 |
| 1180×820 tablet (touch, wide) | 0.9 s | **yes** | ✓ | ✓ | ✓ | ✓ | 0 | 0 | 0 |

The Poki build was also exercised at 1031×580, below.

**Dev server**, real input events, with the autopilot deciding only:

- `e2e:keyboard`: **shift 1 reached the results screen** using real `keydown`/`keyup` events
  (WASD and E). That run covered the tutorial, the staged demonstration, switching, three repairs
  and the exit.
- `e2e:touch`: **shift 1 reached the results screen** using CDP multi-touch events on the floating
  joystick and the action button.
- `e2e:multitouch` (1180×820 touch):
  - Stick held **plus** REPAIR held with a second finger completed the repair.
  - Lifting only the action finger kept the stick active.
  - `touchcancel` released everything.
  - Window blur cleared all input and opened the pause menu.
  - Holding the stick through a resize to portrait, then releasing, left no stuck input.
- `e2e:menus`:
  - Enter starts the game. Space does not pause.
  - **The simulation is frozen while paused** (sim time unchanged over 1.2 s).
  - Focus lands on Resume, arrows move focus, Enter opens Settings, Esc goes back, and Esc resumes.
- `e2e:lifecycle`, after 8 restarts from the pause menu:
  - Animation-frame callbacks stayed constant (one game loop).
  - Window/document listeners stayed at 38 → 38.
  - GPU geometries went 51 → 49 and textures 23 → 23. Scene children stayed at 13.
  - Low quality turns off shadows and bloom and uses 3 warm lights. Protection footprints look
    identical.
- Visual checks, inspected by eye (`docs/screenshots/`):
  - start screen over the live scene;
  - amber-versus-blue readability;
  - the creature warning (eye and arrow cue plus toast);
  - chase;
  - the restrained capture screen with its explanation;
  - results with transparent criteria;
  - the blackout warning (dashed, pulsing edge, chip and toast);
  - low quality;
  - the ending at 104 (shadow at a dark threshold, fading);
  - phone portrait and landscape HUD layouts.

  Layering and wrapping bugs found here were fixed:
  - the overlay ignored mouse and touch input;
  - the tutorial panel sat above the pause menu;
  - tutorial text wrapped one word per line in portrait;
  - the idle action button looked active.

**Poki build with a stub SDK** (`e2e:poki`, 1031×580). Event order observed:

`init > gameLoadingFinished > (first key) gameplayStart > (Esc) gameplayStop > (Resume)
commercialBreak > breakDone > gameplayStart > (Esc) gameplayStop > (Restart) commercialBreak >
breakDone > gameplayStart`

The game was frozen during each break, and the run produced no errors. With the SDK request
**blocked**, the game loaded and played with no errors. A stub cannot confirm real SDK behaviour;
use the Poki Inspector for that.

**Startup under emulated constraints** (`e2e:startup`, production build, 4× CPU throttle,
1.6 Mbps / 150 ms network, phone viewport, gzip, software GL):

- the loading text paints in **0.42–0.45 s**;
- the start screen is ready in **1.9–2.2 s**;
- 184 KB is transferred.

Served uncompressed, the start screen took 4.6–4.9 s (701 KB). This is emulation on a desktop
machine and does not measure a real midrange phone.

**Frame rate.** These headless runs use software rendering at about 8–10 FPS on high quality and
about 22 FPS on low. Those numbers say nothing about real GPU performance. Draw calls are about
55–105 during play (dev panel). The 60 FPS desktop and 30 FPS phone targets are **not verified**.

## 4. Still needed on physical devices

Nothing below has been done:

- [ ] Midrange Android phone (Chrome): FPS on high and low quality, thermal behaviour over 3+
      shifts, and readability in a bright room.
- [ ] iPhone (Safari): safe areas and notch, audio unlock on first tap, the background tab
      returning to the pause menu, and orientation changes mid-stick.
- [ ] iPad or Android tablet: touch controls shown, joystick comfort, action button reach.
- [ ] Touch-screen laptop (hybrid): touch UI appears on first touch, keyboard still works, and the
      settings override works.
- [ ] Desktop with a real GPU: hold 60 FPS, bloom cost, and dev-panel draw calls.
- [ ] Muted playthrough: threats, repair completion and blackouts are readable from visuals alone.
- [ ] Gentle scare mode and reduced motion, judged by real players for tone.
- [ ] **New-player playtests** of each shift. Do they finish shift 1 without help? How long does
      each shift take (target 2–4 min)? Where do they get stuck? Is the tone too scary?
- [ ] Poki Inspector run of `dist-poki/` (see POKI_CHECKLIST.md).

## How to re-run

```bash
npm run typecheck && npm test && npm run build && npm run build:poki
npm run e2e:smoke && npm run e2e:startup && npm run e2e:poki          # production / Poki builds
npm run dev   # then, in another terminal (LK_URL defaults to http://localhost:5173/):
npm run e2e:keyboard && npm run e2e:touch && npm run e2e:multitouch && npm run e2e:menus && npm run e2e:lifecycle
```
