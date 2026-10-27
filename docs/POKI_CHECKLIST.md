# Poki preparation checklist

**Sources re-read on 2026-10-27** (the official developer guides):
[requirements](https://developers.poki.com/guide/requirements-quality),
[SDK overview](https://developers.poki.com/guide/sdk-overview),
[HTML5 SDK](https://developers.poki.com/guide/sdk-html5),
[external resources](https://developers.poki.com/guide/external-resources-policy),
[content and player safety](https://developers.poki.com/guide/content-player-safety),
[engagement](https://developers.poki.com/guide/engagement),
[adding your game](https://developers.poki.com/guide/adding-your-game).
Platform rules change, so re-read these before submitting.

Nothing has been uploaded, submitted or reviewed. No item below means Poki has accepted the game,
that it is ready for monetisation, or that it passed review.

## Legend

- **Done locally**: implemented and checked on this machine.
- **Stub-tested**: checked against a fake SDK only.
- **Outstanding**: needs Poki access, real devices, or a decision.

## SDK and adapter

| Item | Status |
| --- | --- |
| Local and Poki modes; real integration only in `npm run build:poki` | Done locally |
| SDK loaded by the official `<script src="https://game-cdn.poki.com/scripts/v2/poki-sdk.js">` in `<head>`, not an npm package | Done locally (injected by `vite.config.ts`). It has no SRI hash because Poki serves a rolling v2 script. |
| `PokiSDK.init()` never blocks the game: 4 s timeout, and both failure paths continue | Done locally, unit-tested |
| `gameLoadingFinished()` once, when the start screen is usable | Stub-tested |
| `gameplayStart()` only on the first real input. `gameplayStop()` on pause, menu, capture, shift end, ending cutscene and hidden tab | Stub-tested |
| No duplicate start/stop: `PlatformSession` owns the state | Unit-tested and stub-tested |
| `commercialBreak()` at natural transitions back into play: next shift, retry, play again, restart, picking a shift from pause, and resuming from pause (never during a warning or chase). No custom ad timer. | Stub-tested |
| During a break: input cleared, simulation frozen, audio muted. Restored on resolve, no-ad and error. No gameplay events leak during the break. | Unit-tested and stub-tested |
| A tab hidden during a break keeps the pause menu afterwards (composed pause reasons) | Unit-tested |
| Game works with the SDK blocked (ad blocker) | Done locally (SDK request aborted in the browser test: no errors) |
| Rewarded ads | Not implemented (out of scope). There is always a normal path. |
| **Real event ordering in the Poki Inspector** | **Outstanding.** Upload `dist-poki/` and check the Inspector event log. |

## Technical requirements

| Item | Status |
| --- | --- |
| Fills the canvas; 16:9 main composition; tested at 640×360, 1280×720 and 1031×580 (Poki build); phone landscape and portrait; tablet | Done locally (browser emulation) |
| Portrait handled with adapted framing, no rotate screen | Done locally |
| Touch controls forced on tablets (touch-capable devices, any width) with an override | Done locally (emulation) |
| Keyboard pause on **Esc** with matching SDK events. Space is the action key and does not pause. | Done locally |
| Page scrolling prevented (arrows, Space, wheel `passive:false`, touchmove, gesture) | Done locally |
| No external requests (fonts, assets and libraries bundled; SVG and canvas only) | Done locally. Production test logged zero non-local requests. |
| Mute during ads | Done locally (mute reasons compose) |
| localStorage in try/catch; session-only notice | Done locally, unit-tested |
| Dev tools and debug UI absent from the release bundle | Done locally (dev tools are a dynamic import behind `import.meta.env.DEV`; bundle grep shows none). One inert test helper (`World.debugTeleport`) remains but is unreachable from the UI. |
| Small build | About 188 KB gzipped (JS + CSS + HTML) |
| Mobile overlay pill region kept clear | Done locally: on touch layouts the power panel moves below or beside the top-centre area. Check on a real device in the Inspector (outstanding). |
| **Inspector automated checks** | **Outstanding** |

## Content and tone (unresolved)

Poki's content policy lists "**sustained scary themes**" as out of scope and does not define
"sustained". Acceptance of this suspense concept is **unresolved**, and existing horror listings
prove nothing about this game.

The game mitigates this:

- Short shifts with frequent relief in light.
- No gore or jump-scare face. The capture is a restrained vignette.
- A playful tone: tenants and notes.
- A **Gentle** scare setting (quieter creature audio, smaller eye glow, softer vignette).
- Reduced motion.

The central light-and-route mechanic is kept.

**Outstanding:** request an early tone/prototype review from Poki with a representative build before
investing further.

## Thumbnails

**Outstanding.** Poki needs both static and animated thumbnails for global release. None have been
prepared. Capture them from the running game (not the AI concept image), for example the shift 1
staged moment where the shadow stops at the amber edge, and the ending at 104.

## Submission steps still to do

1. Read the current developer Terms & Conditions.
2. `npm run build:poki`, then upload `dist-poki/` to Poki for Developers. It contains `index.html`.
3. Run the **Inspector**: check SDK events, mobile behaviour and scaling.
4. Pass content moderation, flagging the tone question above.
5. Request the first playtest. Treat retention as a hypothesis to test.
6. Prepare the static and animated thumbnails.
7. Re-check this list against the guides again, since they may have changed since 2026-10-27.
