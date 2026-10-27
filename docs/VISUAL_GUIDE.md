# Visual customisation guide

All of the look can be changed without touching simulation rules. Nothing below affects protection
boundaries, AI or objectives. Those live in `src/simulation`, `src/ai` and `src/levels` and are
covered by tests, so `npm test` should still pass after any visual change.

| You want to change… | Edit | Notes |
| --- | --- | --- |
| **Palette** (walls, floors, furniture, caretaker, creature, bulbs, footprint colours) | `src/rendering/theme.ts` → `PALETTE` | Bulb colours are linear RGB triples above 1.0 so they bloom. `safeFill`, `safeEdge` and `darkTint` colour the floor footprint. |
| **Lighting** (ambient, moonlight, warm light pool, lantern, wall warm/cool tint) | `theme.ts` → `LIGHTING` | Warm point lights are a fixed pool (6 on high quality, 3 on low) assigned to the powered fixtures nearest the view, so many fixtures never mean many lights. |
| **Camera** (angle, distance, zoom, portrait framing, look-ahead, DPR caps) | `theme.ts` → `CAMERA` | `viewHeight` is the visible world height in landscape. `minViewWidth` keeps narrow portrait screens seeing ahead. |
| **Wall height and cutaway** | `theme.ts` → `GEOMETRY` (`wallHeight`, `wallCutHeight`, `cutForward`, `cutLateral`) | Walls between the camera and the caretaker shrink to stubs. Collision and line of sight are unaffected. |
| **Animation** (walk bob and swing, bulb ignition, cutaway speed, creature sway) | `theme.ts` → `ANIMATION` | Reduced-motion mode already zeroes bob, sway and look-ahead. |
| **Bloom and particles** | `theme.ts` → `EFFECTS` | Bloom only runs on high quality. |
| **Model geometry** (caretaker, creature, tenant, sofa, bed, shelves, tables, cabinets, plants, sconces, lamp posts, breaker panels, doors, exit) | `src/rendering/models.ts` | Each builder is a small function of semantic inputs (prop footprint and wall side, mount direction). Swap a builder for a loaded mesh and the rest of the game is unchanged. Furniture is authored "back to −Z" and rotated to its wall. |
| **Voxel primitive** | `src/rendering/voxel.ts` | Merges boxes into one vertex-coloured geometry: one draw call per model. |
| **Labels and icons in the world** (door plaques, circuit tags A▲ B● C■, repair, help and exit markers) | `src/rendering/textures.ts` | Drawn on canvases at runtime. No image files. |
| **Floor footprint shader** (edge width, pulse, dashes, preview outline) | `src/rendering/LevelView.ts` → `buildOverlay()` | It *displays* the simulation mask. Do not compute safety here. |
| **HUD and menus** (fonts, colours, sizes, tap targets, safe-area spacing, layouts) | `src/ui/styles.css` (`:root` tokens at the top) | `--tap` keeps touch targets about 48 px. `body.touch-ui` rules move the power panel clear of the platform pill. |
| **HUD and menu text** | `src/ui/strings.ts` | All player-facing text lives here (localisation-ready). |
| **UI icons** | `src/ui/icons.ts` | Inline SVG using `currentColor`. |
| **Sounds** | `src/audio/AudioManager.ts` | Each cue is a small synthesis function. Levels are deliberately low. |

## Tips

- Keep the amber-versus-blue contrast readable on a phone in a bright room. Safety is also shown
  by the footprint edge, the "In the light" / "In the dark" chip and the circuit symbols, so never
  rely on colour alone.
- If you replace models with imported assets, bundle them locally (Poki blocks external requests)
  and keep the total compressed payload small. The current build is about 190 KB gzipped.
- The concept image `docs/reference/lampkeeper-mockup.png` is reference only. Do not ship it as a
  background.
