# LAMPKEEPER design notes

This document records what was built and why: the final mechanic decisions, where the tuning
lives, how shifts are put together, and any deliberate deviations from `prompt.md`.

## Architecture in one paragraph

`simulation/World.ts` is the authority. It steps at a fixed 60 Hz, with frame deltas clamped to
0.1 s and at most 5 steps per frame, so a suspended tab never causes a huge catch-up step. It owns
player movement, collision, interaction targeting, circuits, the protection mask, the creature, and
win/capture. It receives one input per step (a world-space movement vector plus one action
boolean) and emits events. `game/Game.ts` converts camera-relative input into that vector, routes
events to audio, HUD, effects, saving and the tutorial, and owns the state machine:
`loading → ready → playing ⇄ (paused) → captured | complete | ending`, plus `adBreak`. Rendering,
CSS, audio and frame rate never decide safety or objectives.

## Light and safety (the central rule)

- **One protection model.** `simulation/protection.ts` builds a per-cell mask (1 = protected). It
  is the union of:
  - the emergency cells: the maintenance nook, the exit landing, a radius-1.5 pad at every breaker
    switch, and the porch of the active tenant;
  - the precomputed coverage of every fixture that is both powered and working.

  Player safety, creature navigation and collision, switch previews and the amber floor footprint
  (`rendering/LevelView.ts`, which samples the mask texture with nearest filtering) all read this
  same array.
- **Walls block light.** A cell is in a fixture's coverage only if it is within the fixture's radius
  (2.6 for corridors, 3.1 for rooms) **and** the straight segment from the fixture to the cell
  crosses no wall, closed door or exit, including diagonal corner seams (`grid.segmentClear`). Light
  does spill through open doorways, consistently for every system that reads the mask.
- **Lantern ≠ protection.** The caretaker's lantern is a small pale point light, purely visual. The
  tutorial line is "Building lights keep it away. Your lantern does not."
- **Circuits** (`simulation/circuits.ts`): three circuits, capacity 2. Turning one on when full
  returns `full` and shows "Power full — switch another circuit off." Nothing is ever disabled
  silently. Switching off starts a 1.0 s warning: the circuit still protects and still counts
  against capacity, its footprint pulses at about 1.5 Hz with a dashed edge, a descending tone
  plays and the HUD chip pulses. Operating the switch again during the warning cancels it.
- **Broken vs unpowered.** These are separate state: `World.broken[]` versus `CircuitBoard.on[]`.
  Bulbs read differently (bright amber when lit, dim cream when off, near-black plus a wrench marker
  when broken), and the capture message says which applied ("Circuit B ● was off here." versus "The
  lamp here on circuit B was still broken.").
- **The exit** unlocks after three repairs, whatever the power allocation. The landing is
  emergency-lit.

## The creature

`ai/Creature.ts` is an explicit state machine:
`inactive, emerging, patrol, investigate, warn, chase, retreat, cooldown, dissolving, gone, staged,
capturing`.

- **Navigation.** `ai/nav.ts` runs a bounded Dijkstra flood over the grid (8-connected, no corner
  cutting, preallocated buffers). While hunting, protected cells are impassable *and* solid for
  collision, so the creature stops exactly at the drawn boundary. Paths are replanned about every
  0.3 s during a chase and whenever the mask changes, never once per frame. A test caps the flood
  count.
- **Detection.** The creature notices the player within `detectRange` with a clear line of sight,
  and only when the player is unprotected. It then **warns for 0.8 s** (it rises, its eyes grow and
  brighten, a growl plays, and a HUD arrow and eye point at it from the player) before chasing.
- **Losing you.** After 1.25 s without sight it investigates your last seen position. If you sit in
  the light for 2.5 s it gives up, and for 6 s afterwards it wanders off and only notices players
  very close to it ("disinterest").
- **Repairs make noise.** A completed repair makes a patrolling creature within 9 cells investigate
  that spot once. A ripple ring marks the noise, and the creature does not keep knowing where you
  are.
- **Relighting.** When the mask changes and the creature's cell becomes protected, any attack is
  cancelled and it enters `retreat`. It may cross protected cells only along a path to the nearest
  dark cell. If no dark cell is reachable it dissolves, harmlessly.
- **Returning.** It returns after `respawnDelay` at a cell that is dark, out of the player's line of
  sight, at least 9 units away, outside the nook and landing, and in a dark region of at least 60
  cells. The return is telegraphed with dark smoke, a sound and the toast "Something stirs in the
  dark…". It never spawns on the player.
- **Capture.** Requires the chase state, an unprotected player, a clear line of sight, and a
  distance of 0.8 or less, sustained for 0.3 s (the reaction window). The capture timer decays when
  contact breaks, so jittering on a boundary is not lethal. The result screen explains the cause.
- **Speeds.** Player 3.4. Creature chase speed is 2.5 in shift 1 rising to 3.0 in shift 5; patrol
  is about 1.5.

### Deviations and additions (justified)

1. **"Loses its way" pocket rule.** If the creature has been confined for 8 s to a reachable dark
   region smaller than 60 cells, it dissolves and returns elsewhere. Without this rule, playtests
   with the autopilot found the creature could camp permanently in the single dark room that held
   a required repair, which made a mandatory route permanently blocked (forbidden by the brief). It
   also fits record 4 ("When the emergency network changes, the shadow loses its way."). Spawns and
   seeded starts never begin inside such a pocket.
2. **Disinterest after a failed lurk** (see above). This prevents an endless warn, chase, lurk
   loop beside a player standing in the light.
3. **Moving while repairing** is allowed at 60 % speed, so holding the joystick and the action
   button together works. Leaving the 1.3 range (+0.2 grace) cancels the repair.
4. **Commercial break on resume.** Poki's event flow lists `gameplayStop → commercialBreak →
   gameplayStart` for pause/unpause. Resume therefore requests a break, except during a warning or
   chase, which an ad must never interrupt.
5. **Spawn "outside the player's view"** is approximated in the simulation as at least 9 units
   away and with no line of sight. The simulation never depends on the camera.

## Interaction

- Targets are faults, switches, the tenant, and the exit once unlocked. A target is eligible when
  it is within its range (repair 1.3, switch 1.15, help 1.45, exit 1.55) and the segment to it is
  clear. The nearest eligible target wins, with a stable authored order breaking exact ties and a
  0.12 hysteresis margin so the highlight does not flicker. During a repair the target is locked.
- **Repair** is a 1.5 s hold. Releasing, walking out of range or losing eligibility cancels it, and
  progress is not kept. **Switch, help and exit** need a fresh press, with a 0.25 s debounce. One
  press or hold never operates two things.
- After any menu, a latch ignores a held action key until it is released, so a click or keypress in
  a menu can never become a gameplay press.

## Levels, shifts and variation

- **Three templates** (`levels/templates.ts`), authored as ASCII maps with a legend for walls,
  floors, doors, the nook, fixtures by circuit, breaker switches, spawn candidates, tenant porches,
  furniture and the exit:
  - *East Hall*: an L-shaped corridor with stairs.
  - *Courtyard Ring*: a loop around a boiler room, good for escapes.
  - *Long Wing*: a long corridor ending at **apartment 104**.

  Each template has a nook breaker (A/B/C) and one remote panel.
- **Shifts** (`levels/shifts.ts`):

  | Shift | Template(s) | Start power | Rule highlights | Lesson |
  | --- | --- | --- | --- | --- |
  | 1 | East Hall | A | tutorial: first fault is the nook lamp; staged demo | powered lights keep it away |
  | 2 | Ring | A | faults on all three circuits | choose a route before switching |
  | 3 | East Hall / Ring | A | tenant always present | is extra risk worthwhile? |
  | 4 | Ring / East Hall | A + B | at least 2 faults on powered circuits; tenant | powered ≠ working |
  | 5 | Long Wing | A | faults on all three circuits; ending at 104 | mastery |
  | Replay | all | A | 50 % tenant chance, fresh seed | — |

- **Seeding** (`simulation/rng.ts`). Mulberry32 with derived streams (`template#k`, `faults#k`,
  `tenant#k`, `spawn#k`, `creature`, and `cosmetic:<template>` for rugs, books and plants). Cosmetic
  randomness therefore cannot shift gameplay. Story shifts use a fixed default seed, so a retry is
  identical. Replay uses a fresh seed, shown in the results and the dev panel, and can be typed into
  the Shifts screen.
- **Validation** (`levels/generate.ts`), up to 40 seeded attempts, then the shift's authored
  fallback. A fallback spawn is re-validated too. The checks are:
  - **Structure.** Distinct, spaced faults that satisfy the shift's rules; capacity sanity; every
    fault, switch, the landing and the tenant porch reachable; a reachable switch for every circuit;
    creature clearance (distance, no line of sight, dark, large region); the tutorial's safe
    opening; and the ending at 104.
  - **Power-aware solvability.** A depth-first search over (position, power configuration, repairs
    done) proves that some repair order and some per-leg allocation exist. Switches can only change
    at reachable panels and never above capacity. Every leg, including the final walk to the exit,
    must cross at most `maxLegExposure` unlit cells (7–9 depending on the shift). This is not an AI
    proof. Full autopilot playthroughs supplement it (see TESTING.md).
- **Template tests** guarantee that every floor cell is reachable and that furniture never blocks a
  doorway. These tests caught a real blocked doorway in the Ring template during development.

## Onboarding (shift 1)

`game/Tutorial.ts` advances by actions, not timers:

1. Move.
2. Hold to repair the nook lamp. This is safe: it sits in emergency light.
3. Staged demonstration: the creature emerges in view, walks to the amber edge, stops and watches,
   then leaves. It is harmless throughout. "Building lights keep it away. Your lantern does not."
4. Breakers: "only two at once". This advances when any circuit is operated.
5. "Repair the other lamps, then reach the exit."

Steps reached are saved, so a retry resumes after the demonstration. "Skip tutorial" is always
offered. Warnings are taught in context: the first sighting shows "It has seen you — get to the
light!".

## Story and rewards

There are six records (`levels/story.ts`):

| Record | How it is found |
| --- | --- |
| 1 | Shift 1, after the 1st repair |
| 2 | Shift 3 tenant (optional) |
| 3 | Shift 2, after the 2nd repair |
| 4 | Shift 4 tenant (optional) |
| 5 | Shift 5, after the 2nd repair |
| 6 | The ending |

Replay tenants hand over any tenant record you missed. Records are saved the moment they are found,
so they survive captures. The ending sequence starts after active play stops. The caretaker raises
the lantern, the shadow appears at a dark cell near the 104 threshold (in view and never inside
light), pauses, and fades. The sequence is skippable.

**Rating.** Three lamps, each with its criterion shown on the results screen:

1. Shift complete (always lit).
2. Stayed unseen (no chase started).
3. Helped the tenant, or for shifts without a tenant, "Finished within" a generous par of 5–6
   minutes.

Taking a safe route is never penalised. There is no currency.

**Save** (`platform/storage.ts`). A versioned JSON record holding completed shifts, records,
tutorial progress, best ratings and settings. Every field is sanitised, and a v1 save migrates. A
corrupt save resets. If storage throws, the game keeps progress in memory and says "Progress is
kept for this session only."

## Tuning locations

| What | Where |
| --- | --- |
| Player speed, repair time, ranges, debounce, capacity, warning time, light radii | `src/game/config.ts` |
| Creature defaults (speeds, detect range, warn, capture, lurk, pocket rule, respawn) | `src/game/config.ts` (`CREATURE_DEFAULT`) |
| Per-shift creature overrides, exposure limits, par times, records, fallbacks | `src/levels/shifts.ts` |
| Layouts, fixtures, switches, spawns, tenants, door numbers | `src/levels/templates.ts` |
| Validation attempts, spawn clearance, fault spacing | `src/game/config.ts` (`VALIDATION`) |
| Look: palette, lights, camera, wall cutaway, animation, bloom | `src/rendering/theme.ts` (see VISUAL_GUIDE.md) |
| HUD text | `src/ui/strings.ts` |

## Expansion hooks (not unfinished systems)

- Templates are data, so more floors only need new maps.
- `ShiftDef` supports per-shift capacity and initial circuits.
- The platform adapter has a single place where rewarded breaks could be added later. They are not
  implemented and would need explicit player choice.
