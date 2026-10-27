# Build LAMPKEEPER

You are the implementing game developer. Build a complete, playable browser game in this repository using this specification. Work through implementation, debugging, and verification; do not stop at a plan, a static scene, or a UI demonstration.

Make routine implementation decisions yourself. Inspect existing files and repository instructions first, preserve unrelated work, and document meaningful assumptions. Ask only if a missing decision actually prevents implementation. Do not publish, submit to Poki, or provision paid services.

## 1. Product goal

LAMPKEEPER is a small, original, single-player suspense game about maintaining an apartment building after midnight. The player restores electrical faults while a shadow creature travels through dark corridors.

The central rule is: **working building lights create safety; darkness creates danger.** The player cannot power every circuit at once, so choosing which route to illuminate is the central puzzle.

Build for desktop, mobile phones, and tablets from the beginning. Prioritize responsive controls, understandable threats, immediate interaction, short repeatable shifts, and fast restarts. Retention is a hypothesis to test, not a promise the implementation can claim.

Deliver a polished small game with five playable shifts and a replay mode. A shift should eventually take roughly 2–4 minutes for a new player, but do not add waiting or busywork to force that duration. Let playtesting determine pacing.

The intended emotional rhythm is curiosity → small accomplishment → warning → brief tension → safety → another interesting decision. Keep the tone eerie and occasionally playful rather than relentlessly frightening.

## 2. Visual reference and future revisions

If available, inspect `docs/reference/lampkeeper-mockup.png`. It is an AI-generated visual concept, not a screenshot of an existing implementation or a pixel-perfect specification.

The reference shows:

- A three-quarter overhead orthographic view into a cutaway apartment building.
- Chunky voxel furniture, modular walls, numbered apartment doors, plants, a breaker panel, and a small yellow-jacketed caretaker.
- Warm amber light in safe areas and readable cool blue darkness elsewhere.
- A lanky block-built shadow creature waiting outside the light.
- A small objective counter, a power indicator, pause, a virtual joystick, and one contextual action button.

If the image is unavailable, the written description is sufficient. Build actual interactive 3D geometry; never use the mockup as the gameplay background.

**The owner may revise the visual direction later.** Keep palette, materials, model builders, camera settings, lighting, UI tokens, effects, and animation settings separate from simulation and level rules. Avoid scattering color values and dimensions throughout unrelated systems. Do not bake gameplay into a screenshot, texture, or character mesh.

Match the composition, legibility, and atmosphere at a realistic mobile rendering cost. Favor a consistent, attractive visual language over expensive attempts to reproduce every rendered detail.

## 3. Technology and project shape

If this is an empty project, use TypeScript, Vite, Three.js, and CSS/HTML UI layered over the canvas. Use normal package dependencies bundled into the production build. Select compatible stable versions and retain the lockfile. If a suitable project already exists, adapt it instead of rewriting it unnecessarily.

Prefer a lightweight grid-based simulation with continuous actor movement on the XZ plane. Render it in 3D, but avoid a general-purpose physics engine unless inspection proves one is necessary. Use simple colliders, a navigation grid, and small reusable modules. Do not introduce a backend, accounts, multiplayer, a database, or a large UI framework just for a small HUD.

Suggested responsibilities, with filenames adaptable to the project:

```text
src/
  main.ts
  game/Game.ts                 # orchestration and game state
  game/config.ts               # tunable gameplay values
  game/types.ts
  simulation/                  # movement, collision, light safety, objectives
  ai/                          # creature state machine and navigation
  levels/                      # templates, shift definitions, seeded variation
  rendering/                   # scene, camera, procedural models, effects
  rendering/theme.ts           # colors, materials, visual tuning
  input/                       # keyboard, pointer, touch input abstraction
  ui/                          # HUD, contextual hints, menus, results
  audio/                       # audio manager and procedural sounds
  platform/                    # Poki adapter, storage, local diagnostics
tests/                         # meaningful rule and progression checks
docs/
  DESIGN.md
  TESTING.md
  POKI_CHECKLIST.md
  reference/
```

Keep simulation authoritative. Lighting shaders, CSS animation, frame rate, audio, and camera behavior must not decide whether an actor is safe or an objective is complete.

## 4. Core loop and scope

1. Begin in a permanently lit maintenance nook with a clear repair objective.
2. Inspect the route, nearby breaker switches, and the creature's position or warning cues.
3. Allocate limited power and walk to a fault.
4. Repair it using the contextual action.
5. Return to safety or reroute power to reach the next task.
6. Optionally help a tenant and discover a short story fragment.
7. After all required repairs, reach the exit and end the shift.
8. Show a concise result and offer the next shift or immediate retry.

Initial release scope: one building setting, one creature with consistent rules, three reusable authored floor templates, five authored shift configurations, three repairs per shift, a maximum of one optional tenant per shift, six short story records, and seeded replay. Reuse systems and geometry; do not create five separate games.

Do not add combat, crafting, a large inventory, sprint stamina, hunger, daily streaks, purchasable currency, a skill tree, or an open world. Expansion hooks are useful; unfinished expansion systems are not.

## 5. Resolve the light rules explicitly

### Building light versus the player's lantern

Only working, powered **building fixtures** create protected areas. These have a visibly defined warm amber floor footprint with a clear edge, supported by a small safety icon when useful.

The caretaker carries a weak inspection lantern. It improves local visibility but does **not** repel the creature. Give it a small, pale neutral glow without the amber safety footprint. Teach this distinction early with a short visual hint: “Building lights keep it away.” Never imply that carrying the lantern makes the player invulnerable.

This is an intentional clarification of the concept image. Keep it consistent across visuals, tutorial, collision rules, and documentation. Do not silently add a permanent protective aura around the player.

### Circuits and faults

- Start with three independently switchable circuits and a capacity of two active circuits.
- The permanent maintenance nook is on emergency power and does not consume this budget.
- Each circuit controls a clearly identifiable group of fixtures. Use A/B/C labels plus symbols, not color alone.
- Circuit state and fixture health are separate: a repaired fixture can be off; a powered circuit can contain a broken fixture.
- Repairing a fault fixes it for the rest of that run. It does not automatically exceed the power budget.
- The player carries the required tools. Do not add a fuse scavenging prerequisite.
- Faults can be repaired while their circuit is off. The repaired fixture becomes safe only when powered.
- At capacity, requesting another circuit shows “Power full — switch another circuit off.” Do not secretly disable an arbitrary circuit.
- Use individually targetable world switches near safe junctions. The same action input toggles the currently highlighted switch. A breaker UI must never require tiny targets or rapid menu navigation during a chase.
- Turning a circuit off gives a clear approximately one-second visual and audio warning before its protected areas disappear. This is a transition warning, not random flickering.
- The exit unlocks after three required repairs regardless of the current circuit allocation. Its final landing has emergency lighting so the end cannot become a power-budget softlock.

Represent protection with a deterministic grid mask or equivalent geometric model. It must respect walls and closed boundaries: lamps do not protect through a wall merely because a radius overlaps it. Use the same protection model for creature navigation, player safety, previews, and visual floor footprints.

The creature cannot enter protected areas to hunt or capture. If a circuit turns on around an existing creature, immediately cancel attacks and enter a non-attacking retreat state until it reaches valid darkness. It may traverse the newly protected area only to leave it; it cannot use that exception to chase through a safe route. If no dark route remains, let it dissolve harmlessly and return later at a valid, telegraphed dark spawn outside the player's view and safety buffer. Never spawn it on the player.

## 6. Player actions and movement

Use one movement input and one contextual action. No manual camera aiming is necessary.

Desktop:

- WASD and arrow keys move relative to the screen/camera axes.
- E or Space performs the highlighted action. Prevent Space from also pausing.
- Escape pauses or resumes. Keyboard users can operate menus with focus, Enter, and arrows where appropriate.
- Mouse can activate UI buttons. Do not require pointer lock.

Touch:

- A forgiving lower-left virtual joystick and a large lower-right contextual action button.
- Simultaneous movement and action must work with separate pointer IDs.
- The button changes its icon and short label for REPAIR, SWITCH, HELP, or EXIT.
- Support pointer capture, cancellation, lost focus, touch release outside the joystick, safe areas, and orientation changes without stuck input.
- Show touch controls on tablets and touch devices, with an override for hybrid devices. Do not rely only on a narrow viewport or user-agent string.

Normalize diagonal movement, slide naturally along walls, avoid snagging on decorative props, and face the movement direction. Prevent movement through closed doors, furniture colliders, and walls. Use a stable timestep or equivalent frame-independent simulation with a capped catch-up budget.

Context targeting must be deterministic: eligible nearby object, correct distance, no intervening wall, nearest target with stable tie-breaking. Highlight exactly one target and keep it stable during an action. Never repair something through a wall or operate two things with one press.

Repair uses a hold of about 1.5 seconds with a progress ring. Releasing, moving away, or losing eligibility cancels it; no permanent partial progress is required. Switch, exit, and help actions use a deliberate press with appropriate debounce. Do not make every interaction a hold.

## 7. Creature behavior and fairness

Create one original lanky voxel shadow creature with a readable silhouette. It needs simple idle, walk, notice, retreat, and capture motions, not a complex rig.

Use an explicit state machine such as patrol, investigate, warn, chase, retreat, and cooldown. Use the shared navigation grid with light protection applied. Recalculate intelligently when circuits change; do not run a full expensive search every render frame.

Behavior:

- Patrol eligible dark corridors using navigation, not random collision-prone steering.
- Detect the player only within a tunable range and valid line of sight. Walls block sight.
- Repairs create a brief localized investigation cue. The creature does not gain permanent knowledge of the player's position.
- Before a new chase, give a readable warning of roughly 0.8 seconds: posture, small eye highlight, directional UI cue, and sound.
- Chase through darkness. Stop at the actual protection boundary rather than visually passing through it.
- Investigate the last seen position after losing sight, then return to patrol.
- Allow the player to escape using route choices and safe lighting. Begin with the player modestly faster than the creature on straight paths; tune danger through position and objectives rather than impossible speed.
- A capture requires close contact, valid line of sight, and an unprotected player. Use a brief reaction window rather than instant death on a boundary pixel.
- End capture with a short, restrained vignette and a clear explanation such as “Caught in an unlit corridor.” Offer Retry immediately. No loud full-screen face or gore.

Fairness requirements: no attacks through walls, no unannounced teleporting, no attacks during menus or ads, no enemies spawned next to the player, no permanently blocked mandatory route, and no spawn placement that violates the tutorial's safe opening. A returning player should recognize why a failure happened.

## 8. Levels, onboarding, and procedural variation

Build authored navigation and encounter structure first. Procedural voxel art does not require an unconstrained procedural maze.

Each template should define walkable cells, walls, doors, props, safe nook, circuit switches, fixture protection regions, eligible fault locations, creature spawn candidates, tenant locations, and exit. Keep blocking props outside required paths.

Use a seeded PRNG for gameplay-affecting variation. Given the same seed and shift definition, layout selection, faults, tenant placement, and creature starting conditions should match. Keep cosmetic randomness separate so changing a plant color does not move a fault.

Select from validated combinations. Check connectivity, interaction access, capacity, objective placement, spawn clearance, and an achievable repair-and-exit sequence. Include a conservative authored fallback if validation fails after a bounded number of attempts. A single geometric flood fill is insufficient to prove a circuit puzzle is solvable: account for available switch access and power states. Do not require an exhaustive real-time AI proof, but supplement structural validation with complete playthroughs.

Suggested progression:

| Shift | New situation | Intended lesson |
| --- | --- | --- |
| 1 | Guided first repair; staged creature demonstration | Powered building lights create safety |
| 2 | A third circuit competes for two power slots | Choose a safe route before switching |
| 3 | One optional tenant on a side route | Decide whether extra risk is worthwhile |
| 4 | A broken fixture interrupts an otherwise powered route | Power and repair are different states |
| 5 | A compact combination of learned situations | Apply mastery and reach apartment 104 |

First session flow:

- One unobtrusive “Tap / press to start” overlay over the actual scene; no long title sequence.
- Begin moving immediately after that gesture; it also unlocks audio.
- Highlight a nearby repair in a safe space before introducing circuit decisions.
- Demonstrate the creature stopping outside a safe footprint with a staged, harmless encounter. Advance onboarding by player actions, not only elapsed timers.
- Introduce warnings, then circuit allocation. Avoid a wall of instructions.
- Offer skip-tutorial and do not replay completed tutorial steps on every death.

After shift five, unlock a replay mode using the same tested systems and combinations. Show the seed in results and development diagnostics for reproduction. Do not build server leaderboards or sharing infrastructure.

## 9. Story and rewards

Keep the story brief, coherent, and skippable. Deliver it through environmental details, tenant interactions, a single line after selected repairs, and a compact record collection.

Premise: the caretaker is covering five midnight shifts in a building maintained by an old emergency-light network. The previous caretaker vanished from the staff roster, but the building still responds to his repairs.

Suggested six-record arc, with wording editable for natural dialogue:

1. “Two circuits at once. Leave yourself a way back.” — a practical note in the maintenance nook.
2. A tenant says the previous caretaker always checked apartment 104 last.
3. An old work order says its occupant could not tolerate bright ceiling lights.
4. Another note explains that the shadow loses its way when the emergency network changes.
5. The network was built to guide the caretaker home; the dim inspection lantern was his marker.
6. In the final shift, the player restores the route to 104. The shadow pauses at its threshold, recognizes the marker, and fades. A new note reads, “Thank you for keeping the way home lit.”

Preserve the game rule during the ending: do not have the creature casually cross powered safety to complete a cutscene. Stage the final departure from a dark threshold after active gameplay stops. No lengthy twist exposition is necessary.

Helping a tenant is a single short interaction at a safe doorway that records assistance; do not implement escort AI. An optional tenant can award a story record or cosmetic stamp. Mandatory progress and the base ending must never depend on watching an ad or finding every optional item.

Save completed shifts, found records, settings, and tutorial completion. Found records survive failed attempts. Store a small versioned save with validation and graceful migration/reset for corrupt data. Wrap storage access in error handling and fall back to in-memory progress if persistence is unavailable.

Results should show repairs, optional assistance, time, and a simple rating based on transparent criteria. Do not show an unexplained score formula, punish taking a safe route, or use a currency economy. Offer Next Shift and Replay, or Retry after capture, without unnecessary screens.

## 10. Visual implementation

Build procedural box-based geometry for walls, floors, doors, cabinets, lamps, sofa, bed, bookshelves, plants, breaker panel, player, and creature. Consistent voxel scale and palette matter more than the number of tiny cubes.

- Combine or instance repeated geometry and reuse materials. Do not create thousands of independent draw calls to imitate voxels.
- Use simple local model builders with semantic parameters so later asset replacement is practical.
- Use an orthographic camera angled downward, stable tracking, and zoom/framing appropriate to the current viewport.
- Hide or fade obstructing foreground walls without changing their collision or sight-blocking behavior. Do not make the whole building transparent.
- Show enough ahead to react to danger, including on narrow screens.
- Warm amber protected areas and cool blue unprotected areas must remain readable in a bright room on a phone.
- Safety depends on footprints and icons as well as color; darkness cannot mean a nearly black unreadable canvas.
- Use low-cost ambient illumination, emissive fixtures, floor footprints, and limited actual dynamic lights. Many working fixtures must not imply many expensive shadow-casting lights.
- Provide a low quality mode without bloom or real-time shadows. Quality changes must not alter protection boundaries, enemy behavior, or objective readability.
- Animate walk bob, repair motion, bulb ignition, switch movement, and creature warnings. Keep camera shake off by default or very restrained, with reduced-motion support.

Use a compact HUD: repair count at top left, circuit load with A/B/C status near the top, pause at top right, contextual hint near the current target, touch controls at the bottom when appropriate. A contextual circuit label should make it clear what the selected switch affects.

Fit the full canvas responsively, using 16:9 as the main landscape composition and checking the current Poki scaling guidance before submission. Handle portrait gracefully with adapted framing and HUD rather than a blocking rotate screen. Keep touch targets at least approximately 48 CSS pixels where space allows; test the small landscape canvas too. Honor device safe areas and avoid the platform overlay region.

Keep HUD text short and centralized for future localization. Do not place implementation details, technical jargon, debug counters, or developer instructions in the player-facing UI.

## 11. Audio and accessibility

Use Web Audio synthesis or small bundled original/licensed sounds. Include footsteps, quiet electrical hum, switches, repair progress/completion, creature warnings, safe arrival, and a restrained result cue. Avoid a continuous high-volume horror drone.

Initialize/resume audio from an actual user gesture. Provide mute and separate sensible levels for ambience and effects. Pause or mute appropriately for background tabs, pause states, and advertisements, preserving the user's settings afterward.

Important information must have a visual equivalent: muted players can identify threats, repair completion, and pending blackouts. Include reduced motion and controllable scare intensity that changes presentation, not puzzle rules. Avoid rapid flashing and surprise volume spikes.

## 12. States, lifecycle, and robustness

Use explicit states for loading, ready, playing, paused, captured, shift complete, ending, and ad break. Keep transition ownership clear so clicks cannot start two runs or resume through an active overlay.

Pause simulation, repair holds, and hostile actions when paused or backgrounded. On visibility/focus loss, clear held inputs and return to a paused overlay; resume only from a deliberate user action. Multiple pause reasons must compose: finishing an ad must not override a still-hidden tab or open pause menu.

Resize without resetting a run. Handle WebGL unavailability or context loss with a useful recovery message or safe reload option. Restart without duplicate listeners, animation loops, leaked scene resources, or continuing audio nodes. Do not simulate a huge catch-up step after a suspended tab.

## 13. Poki preparation

Prepare integration, but do not claim acceptance, monetization readiness, or a passed platform review without actual verification. Platform rules can change: read the official sources below again during implementation, and record the review date and outstanding checks in `docs/POKI_CHECKLIST.md`.

Build a small platform adapter with local and Poki modes. Local mode requires no SDK and simulates no real ads. Enable the real integration explicitly for a Poki build. Follow the official SDK loading method rather than importing a guessed npm SDK package. The approved Poki SDK script is a platform-specific exception to bundling application dependencies.

SDK behavior:

- Attempt initialization without blocking the game indefinitely on failure.
- Report loading completion once the game is usable.
- Report gameplay start only when actual play starts after player input, and stop on interruptions.
- Guard duplicate start/stop calls through state ownership.
- At an appropriate transition back into play, request a commercial break following current SDK guidance. Do not interrupt a chase or insert your own ad frequency timer.
- Freeze game input and simulation and mute audio throughout the ad request; restore correctly when its promise settles, including no-ad and error outcomes.
- Ensure no gameplay lifecycle events leak during an active ad request.
- Unit-test the adapter with a stub. Real event ordering remains an Inspector check.

Rewarded ads are outside the initial feature scope. If added later, they require explicit player choice and verified success before a reward. There must always be a normal path to continue.

Bundle game libraries, fonts, images, and sounds locally. Use no third-party telemetry or remote asset calls. Support desktop, touch devices, and restricted storage. Prevent gameplay keys and gestures from scrolling the host page. Keep the build compact and onboarding direct. Add no purchases, outgoing promotional links, third-party ads, or ad-blocker prompts.

Poki's current content policy lists “sustained scary themes” as out of scope. Treat acceptance of this suspense concept as unresolved. Keep scares mild and separated by relief, make presentation adjustable, and flag tone review for an early representative prototype. Existing horror listings do not establish approval for this game. Do not remove the central light-and-route mechanic merely to claim compliance.

Official references, checked when this brief was prepared on 2026-10-27:

- Requirements: https://developers.poki.com/guide/requirements-quality
- SDK overview: https://developers.poki.com/guide/sdk-overview
- HTML5 SDK: https://developers.poki.com/guide/sdk-html5
- External resources: https://developers.poki.com/guide/external-resources-policy
- Content policy: https://developers.poki.com/guide/content-player-safety
- Engagement: https://developers.poki.com/guide/engagement
- Submission/prototype process: https://developers.poki.com/guide/adding-your-game

## 14. Performance targets and diagnostics

These are project goals, not quoted platform pass marks:

- Aim for 60 FPS on ordinary desktop hardware and stable 30 FPS or better on a representative midrange phone.
- Cap device pixel ratio, provide a lower rendering quality setting, avoid per-frame allocations, and bound navigation work.
- Aim for a compressed initial game payload below roughly 5 MB, excluding the platform SDK. Measure the actual production output and report it. Do not add large libraries or audio files without a clear benefit.
- Show a usable loading state immediately. Measure startup with mobile CPU/network throttling instead of claiming fast loads from a development machine alone.
- Keep recurring gameplay free of large garbage-collection pauses.

Provide development-only FPS/draw-call information, seed inspection, collision and safety-mask overlays, and a way to select a shift for testing. Exclude or disable those tools in the release build.

Use a bounded local diagnostics buffer with events such as first movement, first repair, circuit switch, chase start, capture, shift completion, and retry. It should aid observation and testing without sending data externally. Do not represent local logs as real retention analytics or integrate an unapproved external analytics service.

## 15. Build sequence

Implement in these stages while continuing toward the full deliverable:

1. **Playable foundation:** initialize the project, render one floor, implement camera-relative movement, collision, resize, input, and a real repair action.
2. **Complete vertical slice:** add circuit capacity, authoritative light safety, one creature, a fair capture, a win condition, retry, pause, and the action-based tutorial. Finish an entire shift on both control schemes.
3. **Content and replay:** add the three floor templates, five shift definitions, validated seeded variation, optional tenant interactions, records, saving, progression, and ending.
4. **Presentation:** improve voxel models, visual hierarchy, sound, animations, contextual feedback, quality modes, and accessibility settings without breaking the tested rules.
5. **Platform and verification:** complete the adapter, build production output, perform browser checks, measure available performance signals, and write the handoff documentation.

Verify each stage before expanding it. Do not spend the entire effort polishing a static room while the game loop remains absent. If an external platform check is unavailable, finish all local work and record the exact remaining external step.

## 16. Verification and acceptance criteria

Add focused automated tests for actual rules, using a lightweight runner appropriate to the stack. At minimum cover circuit capacity, wall-respecting protection, creature exclusion and retreat on relighting, interaction eligibility, seeded reproducibility, level validation/fallback, save corruption/storage failure, and platform pause/event transitions. Avoid trivial tests that merely repeat constants.

Run type checking, tests, and a production build. Where browser automation is available, use it for smoke checks and screenshots of the actual running game; inspect the screenshots. Keyboard automation alone is insufficient evidence for touch behavior or game feel. Include a manual checklist for physical devices.

Verify these scenarios:

- A first-time player can move, repair, learn safety, and complete shift one without reading a document.
- One desktop playthrough and one touch-control playthrough reach a genuine shift-complete state.
- All five authored shifts are completable; progression reaches the ending and unlocks replay.
- The same seed reproduces gameplay-affecting starting conditions.
- Touch movement and repair work simultaneously; cancellation, resizing, and tab switching do not stick inputs.
- Circuits cannot exceed capacity; broken versus unpowered fixtures are distinguishable.
- A safe player cannot be caught through a wall, during relighting retreat, or at a visual/simulation boundary mismatch.
- Blackout transitions, creature warnings, and muted-mode feedback are readable.
- Retry creates a clean run; repeated retries do not multiply event handlers or active loops.
- Pause, backgrounding, ad completion, and resume cannot override each other's pause reasons.
- Storage failure leaves the game playable, with honest session-only progress feedback.
- Check 640×360, 1280×720, a representative phone landscape size, a phone portrait size, and a tablet size. These are test viewports, not a claim of tested physical hardware.
- Check a touch-capable tablet even if its viewport is wide; touch controls must remain available.
- Check production asset paths under a non-root base path suitable for static hosting.
- Production console has no unexplained errors and no unintended external requests. Check the configured platform SDK separately in Poki mode.

Do not claim a test was run if it was only planned. Clearly distinguish automated checks, browser emulation, real-device observations, and platform checks requiring access.

## 17. Deliverables and final handoff

Deliver working source and a reproducible production build with commands for development, type checking, tests, build, and preview. Use `npm run dev`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run preview` unless the existing project has a sensible equivalent.

Include:

- `README.md`: setup, controls, game rules, local versus Poki builds, and how to play/test.
- `docs/DESIGN.md`: final mechanic decisions, tuning locations, shift/content structure, and any justified deviations from this brief.
- `docs/TESTING.md`: checks actually run, results, representative screenshots if produced, measured limits, and physical-device checks still needed.
- `docs/POKI_CHECKLIST.md`: source review date, adapter status, SDK/Inspector work, content-tone uncertainty, thumbnail preparation, and outstanding submission checks. Do not label unfinished items complete.
- A small visual-customization guide identifying where to revise palette, model geometry, lighting, camera, HUD, and animation without changing simulation.

The concept image is a reference artifact and must not be bundled into the runtime unless used for a deliberate non-gameplay purpose. Keep generated production assets original and document any licenses or provenance that matter.

In the final response, summarize what is playable, how to launch it, what was verified, and any concrete limitations. The outcome should be a complete small game that the owner can play and iterate on, with visuals intentionally easy to revise.
