// Development-only diagnostics. Loaded via dynamic import behind import.meta.env.DEV, so it is
// excluded from release builds.

import type { Game } from '../game/Game';
import { CameraRig } from '../rendering/CameraRig';
import { Bot } from './bot';

export class DevTools {
  private readonly el: HTMLDivElement;
  private frames = 0;
  private fps = 0;
  private acc = 0;
  private visible = true;
  private bot: Bot | null = null;
  private wishBot: Bot | null = null;

  constructor(private readonly game: Game) {
    this.el = document.createElement('div');
    this.el.className = 'devtools';
    document.body.appendChild(this.el);
    (window as unknown as { __lk: unknown }).__lk = {
      game,
      startBot: () => this.toggleBot(true),
      stopBot: () => this.toggleBot(false),
      makeBot: () => new Bot(game.world),
      // Screen-space intent for input-driven automation (keys / touch are sent by the test).
      wish: (dt: number) => {
        if (!this.wishBot || this.wishBot.world !== game.world) this.wishBot = new Bot(game.world);
        const d = this.wishBot.decide(dt);
        const r = CameraRig.right();
        const f = CameraRig.forward();
        return { sx: d.moveX * r.x + d.moveZ * r.z, sy: d.moveX * f.x + d.moveZ * f.z, action: d.action, status: this.wishBot.status };
      },
    };
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F2') {
        e.preventDefault();
        game.debugCollision = !game.debugCollision;
      } else if (e.code === 'F3') {
        e.preventDefault();
        this.visible = !this.visible;
        this.el.style.display = this.visible ? '' : 'none';
      } else if (e.code === 'F4') {
        e.preventDefault();
        this.toggleBot(!this.bot);
      }
    });
    let last = performance.now();
    const tick = (now: number): void => {
      requestAnimationFrame(tick);
      this.frames++;
      this.acc += now - last;
      last = now;
      if (this.acc >= 500) {
        this.fps = Math.round((this.frames * 1000) / this.acc);
        this.frames = 0;
        this.acc = 0;
        this.draw();
      }
    };
    requestAnimationFrame(tick);
  }

  private toggleBot(on: boolean): void {
    if (on) {
      this.bot = new Bot(this.game.world);
      const bot = this.bot;
      this.game.autopilot = (dt) => (bot && this.game.world === bot.world ? bot.decide(dt) : { moveX: 0, moveZ: 0, action: false });
    } else {
      this.bot = null;
      this.game.autopilot = null;
    }
  }

  private draw(): void {
    if (!this.visible) return;
    const g = this.game;
    const w = g.world;
    if (!w) return;
    const s = w.setup;
    this.el.textContent = [
      `FPS ${this.fps}  frame ${g.frameMs.toFixed(1)}ms  draws ${g.render.drawCalls}`,
      `state ${g.state}${g.pause.paused ? ` (paused: ${g.pause.list().join(',')})` : ''}`,
      `shift ${s.shift}  seed ${s.seed}  ${s.templateId}${s.usedFallback ? ' FALLBACK' : ''}`,
      `creature ${w.creature.state}  chases ${w.chases}  t ${w.time.toFixed(1)}`,
      `player ${w.px.toFixed(2)},${w.pz.toFixed(2)} ${w.playerProtected ? 'SAFE' : 'dark'}`,
      `tutorial ${g.tutorialStep}  bot ${this.bot ? this.bot.status : 'off'}`,
      `F2 collision  F3 panel  F4 autopilot  ?shift=N&seed=S`,
    ].join('\n');
  }
}
