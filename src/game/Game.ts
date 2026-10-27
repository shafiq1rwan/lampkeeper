// Orchestration: game states, run lifecycle, and wiring between the authoritative simulation
// and presentation (rendering, HUD, audio) and platform services.

import { NavGrid } from '../ai/nav';
import { AudioManager } from '../audio/AudioManager';
import { Input } from '../input/Input';
import { TouchControls } from '../input/TouchControls';
import { generateRun } from '../levels/generate';
import { getShift } from '../levels/shifts';
import { getRecord, TENANT_LINES } from '../levels/story';
import { Diagnostics } from '../platform/diagnostics';
import { PauseController } from '../platform/PauseController';
import { createAdapter, PlatformSession } from '../platform/Platform';
import { SaveStore, type Settings } from '../platform/storage';
import { CreatureView, PlayerView } from '../rendering/ActorViews';
import { CameraRig } from '../rendering/CameraRig';
import { Effects } from '../rendering/Effects';
import { LevelView } from '../rendering/LevelView';
import { RenderSystem, webglAvailable } from '../rendering/RenderSystem';
import { GEOMETRY } from '../rendering/theme';
import { segmentClear } from '../simulation/grid';
import { randomSeed } from '../simulation/rng';
import { REQUIRED_REPAIRS, World } from '../simulation/World';
import { Hud, type HudState } from '../ui/Hud';
import { formatTime, Menus, type ResultInfo } from '../ui/Menus';
import { STR } from '../ui/strings';
import { PLAYER, SIM } from './config';
import { TSTEP, Tutorial } from './Tutorial';
import type { CircuitId, SimEvent, SimInput } from './types';

export type GameState = 'loading' | 'ready' | 'playing' | 'captured' | 'complete' | 'ending' | 'adBreak' | 'error';

const projOut = { x: 0, y: 0, visible: false };

export class Game {
  state: GameState = 'loading';
  readonly save = new SaveStore();
  readonly diag = new Diagnostics();
  readonly pause = new PauseController();
  readonly platform = new PlatformSession(createAdapter());
  readonly audio = new AudioManager();
  readonly input = new Input();
  render!: RenderSystem;
  hud!: Hud;
  menus!: Menus;
  touch!: TouchControls;
  world!: World;
  private levelView: LevelView | null = null;
  private playerView!: PlayerView;
  private creatureView!: CreatureView;
  private effects!: Effects;
  private tutorial: Tutorial | null = null;
  private guideNav: NavGrid | null = null;
  private readonly guidePath = new Int32Array(256);
  private readonly guidePts = new Float32Array(64);
  private guideTimer = 0;
  private readonly events: SimEvent[] = [];
  private readonly simInput: SimInput = { moveX: 0, moveZ: 0, action: false };
  private acc = 0;
  private last = 0;
  private looping = false;
  private actionLatch = false;
  private shift = 1;
  private seed = 0;
  private runNewRecords: number[] = [];
  private warnedOnce = false;
  private endingT = -1;
  private endingSpot = { x: 0, z: 0, yaw: 0 };
  private captureTimer = -1;
  private completeTimer = -1;
  /** Development/test hook: when set, replaces player input each step. */
  autopilot: ((dt: number) => SimInput) | null = null;
  /** Development: render the collision overlay. */
  debugCollision = false;
  frameMs = 16;

  constructor(private readonly container: HTMLElement) {}

  // ------------------------------------------------------------------ boot

  async boot(): Promise<void> {
    const ui = document.getElementById('ui')!;
    // Menus listen for keys before gameplay input, so Escape inside a menu never re-pauses.
    this.menus = new Menus(ui);
    this.hud = new Hud(ui);
    this.touch = new TouchControls(ui, this.input);
    this.input.attach();
    this.applySettings(false);

    if (!webglAvailable()) {
      this.fail(STR.error.webgl, STR.error.webglHint);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    this.container.prepend(canvas);
    try {
      this.render = new RenderSystem(canvas);
    } catch {
      this.fail(STR.error.webgl, STR.error.webglHint);
      return;
    }
    this.render.onContextLost = () => {
      this.pause.add('overlay');
      this.menus.showError(STR.error.lost, '');
    };
    this.render.onContextRestored = () => {
      this.menus.hide();
      this.pause.remove('overlay');
      if (this.state === 'playing') this.openPause();
    };
    this.render.setQuality(this.save.data.settings.quality);
    this.playerView = new PlayerView(this.render.scene);
    this.creatureView = new CreatureView(this.render.scene);
    this.effects = new Effects(this.render.scene);

    this.wireLifecycle();
    await this.platform.adapter.init().catch(() => {});

    const params = new URLSearchParams(location.search);
    const devShift = import.meta.env.DEV ? parseInt(params.get('shift') ?? '', 10) : NaN;
    const devSeed = import.meta.env.DEV ? parseInt(params.get('seed') ?? '', 10) : NaN;
    const shift = Number.isFinite(devShift) && devShift >= 0 && devShift <= 5 ? devShift : this.save.unlockedShift;
    this.buildRun(shift, Number.isFinite(devSeed) ? devSeed >>> 0 : undefined);
    this.resize();
    this.render.rig.snap(this.world.px, this.world.pz);
    document.getElementById('boot')?.remove();
    this.state = 'ready';
    this.showStart();
    this.platform.loadingFinished();
    this.diag.log('loaded');
    if (!this.looping) {
      this.looping = true;
      this.last = performance.now();
      requestAnimationFrame(this.loop);
    }
    if (import.meta.env.DEV) {
      const { DevTools } = await import('../dev/DevTools');
      new DevTools(this);
    }
  }

  private fail(msg: string, hint: string): void {
    this.state = 'error';
    document.getElementById('boot')?.remove();
    this.menus.showError(msg, hint);
  }

  private wireLifecycle(): void {
    this.pause.onChange = (paused) => {
      this.input.clear();
      this.touch.release();
      this.audio.setMuted('pause', paused);
      this.syncGameplay();
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pause.add('hidden');
        this.audio.setMuted('hidden', true);
        if (this.state === 'playing') this.openPause();
      } else {
        this.pause.remove('hidden');
        this.audio.setMuted('hidden', false);
      }
    });
    window.addEventListener('blur', () => {
      this.input.clear();
      this.touch.release();
      if (this.state === 'playing' && !this.pause.paused) this.openPause();
    });
    const onResize = (): void => this.resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => {
      this.input.clear();
      setTimeout(onResize, 200);
    });
    window.visualViewport?.addEventListener('resize', onResize);
    this.input.onPauseKey = () => {
      if (this.state === 'playing' && !this.menus.open) this.openPause();
    };
    this.input.onDeviceChange = () => this.tutorial?.refresh();
    this.hud.pauseButton.addEventListener('click', () => {
      if (this.state === 'playing' && !this.menus.open) this.openPause();
    });
    this.hud.tutorialSkip.addEventListener('click', () => {
      this.tutorial?.skip();
      this.hud.pauseButton.blur();
    });
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.render.resize(w, h);
  }

  private applySettings(persist = true): void {
    const s = this.save.data.settings;
    this.audio.setLevels(s.muted, s.ambience, s.effects, s.scare === 'gentle');
    this.render?.setQuality(s.quality);
    document.body.classList.toggle('reduced-motion', s.reducedMotion);
    document.body.classList.toggle('gentle', s.scare === 'gentle');
    this.touch.setMode(s.touch);
    if (persist) this.save.save();
  }

  private syncGameplay(): void {
    this.platform.setGameplay(this.state === 'playing' && !this.pause.paused);
  }

  private setState(s: GameState): void {
    this.state = s;
    this.input.gameplayActive = s === 'playing';
    this.hud.show(s === 'playing' || s === 'captured' || s === 'complete');
    this.touch.setEnabled(s === 'playing');
    this.syncGameplay();
  }

  // ------------------------------------------------------------------ runs

  private buildRun(shift: number, seed?: number): void {
    const def = getShift(shift);
    this.shift = shift;
    this.seed = seed ?? (shift === 0 ? randomSeed() : def.defaultSeed);
    const setup = generateRun(def, this.seed);
    if (shift === 0 && setup.tenant >= 0) {
      // Replay tenants hand over any tenant record the player missed.
      setup.tenantRecord = [2, 4].find((r) => !this.save.data.records.includes(r)) ?? -1;
    }
    this.levelView?.dispose();
    this.world = new World(setup);
    this.levelView = new LevelView(this.world, this.render.warmLights);
    this.render.rig.setWorldBounds(this.world.level.w, this.world.level.h);
    this.render.scene.add(this.levelView.root);
    this.guideNav = new NavGrid(this.world.level.w, this.world.level.h);
    this.effects.clear();
    this.creatureView.ending = null;
    this.playerView.setRaise(0);
    this.render.rig.zoom = 1;
    this.render.rig.snap(this.world.px, this.world.pz);
    this.hud.clearTransient();
    this.hud.tutorial(null);
    this.tutorial = new Tutorial(this.world, this.hud, this.save, () => this.touch.visible);
    this.runNewRecords = [];
    this.acc = 0;
    this.captureTimer = -1;
    this.completeTimer = -1;
    this.endingT = -1;
    this.actionLatch = true;
    document.body.classList.remove('vignette-capture');
    this.diag.log('runStart', { shift, seed: this.seed, template: setup.templateId, fallback: setup.usedFallback });
  }

  private showStart(): void {
    this.setState('ready');
    this.menus.showStart(
      {
        label: STR.shiftLabel(this.shift),
        intro: STR.shiftIntro[this.shift] ?? '',
        touch: this.touch.visible,
        sessionOnly: !this.save.persistent,
      },
      () => this.beginPlay(),
      () => this.showShiftsFrom('start'),
      () => this.showSettingsFrom('start'),
    );
  }

  /** First gesture: unlock audio and play immediately. */
  private beginPlay(): void {
    if (this.state !== 'ready') return;
    this.audio.unlock();
    this.menus.hide();
    this.setState('playing');
    this.tutorial?.start();
    this.diag.log('play', { shift: this.shift });
  }

  /**
   * Transition back into play through a commercial-break opportunity. Input, simulation and
   * audio stay frozen until the SDK promise settles (ad, no ad, or error).
   */
  private async transition(shift: number, seed?: number): Promise<void> {
    if (this.state === 'adBreak') return;
    this.menus.hide();
    // Enter the break before clearing the menu reason so no gameplay event slips out.
    this.setState('adBreak');
    this.pause.add('ad');
    this.pause.remove('menu');
    this.audio.setMuted('ad', true);
    this.diag.log('adBreak');
    try {
      await this.platform.commercialBreak(() => this.audio.setMuted('ad', true));
    } finally {
      this.audio.setMuted('ad', false);
      this.audio.unlock();
      this.buildRun(shift, seed);
      this.pause.remove('ad');
      this.setState('playing');
      this.tutorial?.start();
      if (this.pause.has('hidden') || document.hidden) this.openPause();
    }
  }

  private openPause(): void {
    if (this.state !== 'playing' || this.menus.open) return;
    this.pause.add('menu');
    this.diag.log('pause');
    this.menus.showPause(
      () => this.resume(),
      () => void this.transition(this.shift, this.seed),
      () => this.showSettingsFrom('pause'),
      () => this.menus.showRecords(this.save.data.records, () => this.reopenPause()),
      () => this.showShiftsFrom('pause'),
    );
  }

  private reopenPause(): void {
    this.menus.hide();
    this.pause.remove('menu');
    this.openPause();
  }

  /**
   * Leave the pause menu. Returning from pause is a natural break, so a commercial break is
   * requested first — except during a warning or chase, which an ad must never interrupt.
   */
  private async resume(): Promise<void> {
    if (this.pause.has('ad')) return;
    this.menus.hide();
    this.actionLatch = true;
    const cr = this.world.creature.state;
    if (cr === 'warn' || cr === 'chase') {
      this.pause.remove('menu');
      return;
    }
    this.pause.add('ad');
    this.audio.setMuted('ad', true);
    try {
      await this.platform.commercialBreak(() => this.audio.setMuted('ad', true));
    } finally {
      this.audio.setMuted('ad', false);
      this.pause.remove('ad');
      // A pause requested during the break (e.g. the tab was hidden) keeps its menu.
      if (this.menus.current !== 'pause') this.pause.remove('menu');
    }
  }

  private showSettingsFrom(from: 'start' | 'pause' | 'results'): void {
    const s: Settings = { ...this.save.data.settings };
    this.menus.showSettings(
      s,
      this.touch.visible || navigator.maxTouchPoints > 0,
      (next) => {
        this.save.data.settings = { ...next };
        this.applySettings();
      },
      () => (from === 'start' ? this.showStart() : this.reopenPause()),
    );
  }

  private showShiftsFrom(from: 'start' | 'pause' | 'end'): void {
    this.menus.showShifts(
      this.save.data,
      this.save.unlockedShift,
      (shift, seed) => {
        if (from === 'start') {
          // Still the first session start: switch run and start straight away.
          this.audio.unlock();
          this.buildRun(shift, seed);
          this.menus.hide();
          this.state = 'ready';
          this.beginPlay();
        } else void this.transition(shift, seed);
      },
      () => {
        if (from === 'start') this.showStart();
        else if (from === 'pause') this.reopenPause();
        else this.showResultsAgain();
      },
    );
  }

  private lastResult: ResultInfo | null = null;

  private showResultsAgain(): void {
    if (this.state === 'ending' || !this.lastResult) {
      this.showEndingScreen();
      return;
    }
    this.showResults(this.lastResult);
  }

  // ------------------------------------------------------------------ loop

  private readonly loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    const t0 = performance.now();
    const dt = Math.min(SIM.maxFrameDelta, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.render.contextLost) return;
    this.input.update();

    const running = this.state === 'playing' && !this.pause.paused;
    if (running) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= SIM.dt && steps < SIM.maxStepsPerFrame && this.state === 'playing') {
        this.stepSim(SIM.dt);
        this.acc -= SIM.dt;
        steps++;
      }
      if (steps >= SIM.maxStepsPerFrame) this.acc = 0;
    } else this.acc = 0;

    this.present(dt);
    this.render.render();
    this.frameMs = performance.now() - t0;
  };

  private stepSim(dt: number): void {
    const w = this.world;
    let inp: SimInput;
    if (this.autopilot) inp = this.autopilot(dt);
    else {
      const f = CameraRig.forward();
      const r = CameraRig.right();
      const mx = this.input.moveX;
      const my = this.input.moveY;
      let action = this.input.action;
      if (this.actionLatch) {
        if (!action) this.actionLatch = false;
        action = false;
      }
      this.simInput.moveX = r.x * mx + f.x * my;
      this.simInput.moveZ = r.z * mx + f.z * my;
      this.simInput.action = action;
      inp = this.simInput;
    }
    w.step(dt, inp);
    for (const e of w.drainEvents(this.events)) this.onSimEvent(e);
    this.tutorial?.update(dt);
  }

  private onSimEvent(e: SimEvent): void {
    const w = this.world;
    const a = this.audio;
    this.tutorial?.onEvent(e);
    const cName = (c: number): string => `${STR.circuit[c]} ${STR.circuitSymbol[c]}`;
    switch (e.type) {
      case 'firstMove':
        this.diag.log('firstMove');
        break;
      case 'footstep':
        a.footstep();
        break;
      case 'repairStart':
        a.startRepair();
        break;
      case 'repairCancel':
        a.stopRepair();
        break;
      case 'repairDone': {
        a.repairDone();
        const f = w.level.fixtures[e.fixture];
        this.effects.burstSparks(f.cx + 0.5 + f.mount.dx * 0.3, GEOMETRY.fixtureHeight, f.cz + 0.5 + f.mount.dz * 0.3, this.save.data.settings.reducedMotion);
        this.effects.ripple(f.cx + 0.5, f.cz + 0.5);
        this.hud.toast(w.circuits.on[f.circuit] ? STR.toast.repaired : STR.toast.repairedUnpowered, 'good');
        const rec = w.setup.repairRecords[e.count];
        if (rec) this.awardRecord(rec);
        this.diag.log('repair', { count: e.count });
        break;
      }
      case 'circuitOn':
        a.switchOn();
        a.setHum(w.circuits.used());
        this.diag.log('circuit', { c: e.circuit, on: true });
        break;
      case 'circuitOffPending':
        a.switchOffWarning();
        this.hud.toast(STR.toast.goingDark(cName(e.circuit)), 'warn');
        this.diag.log('circuit', { c: e.circuit, on: false });
        break;
      case 'circuitOffCancelled':
        a.switchOn();
        break;
      case 'circuitOff':
        a.circuitOff();
        a.setHum(w.circuits.used());
        break;
      case 'powerFull':
        a.powerFull();
        this.hud.toast(STR.toast.powerFull, 'warn');
        break;
      case 'safeEnter':
        if (w.creature.present) a.safeArrival();
        break;
      case 'creatureEmerge':
        a.emerge();
        if (w.creature.state === 'emerging') this.hud.toast(STR.toast.returning, 'warn');
        break;
      case 'creatureWarn':
        a.warn();
        if (!this.warnedOnce) {
          this.warnedOnce = true;
          this.hud.toast(STR.toast.noticed, 'warn');
        }
        break;
      case 'chaseStart':
        this.diag.log('chaseStart');
        break;
      case 'creatureRetreat':
        a.retreat();
        this.hud.toast(STR.toast.retreat, 'good');
        break;
      case 'creatureDissolve':
        a.retreat();
        break;
      case 'capture':
        this.onCapture(e);
        break;
      case 'exitUnlocked':
        this.hud.toast(STR.toast.exitUnlocked, 'good');
        break;
      case 'tenantHelped': {
        a.tenant();
        const rec = w.setup.tenantRecord;
        const line = TENANT_LINES[rec > 0 ? rec : 0];
        if (rec > 0) this.awardRecord(rec, line);
        else this.hud.story(STR.toast.tenantThanks, line);
        this.diag.log('tenantHelped');
        break;
      }
      case 'shiftComplete':
        this.onComplete();
        break;
      default:
    }
  }

  private awardRecord(id: number, line?: string): void {
    const r = getRecord(id);
    if (!r) return;
    const isNew = this.save.addRecord(id);
    if (isNew) this.runNewRecords.push(id);
    this.hud.story(r.title, line ? `${line}` : r.text);
  }

  private onCapture(e: Extract<SimEvent, { type: 'capture' }>): void {
    this.audio.stopRepair();
    this.audio.capture();
    this.setState('captured');
    this.captureTimer = 1.1;
    document.body.classList.add('vignette-capture');
    this.diag.log('capture', { cause: e.cause });
    const c = e.circuit >= 0 ? `${STR.circuit[e.circuit]} ${STR.circuitSymbol[e.circuit]}` : '';
    const detail = e.cause === 'circuitOff' ? STR.capture.circuitOff(c) : e.cause === 'broken' ? STR.capture.broken(c) : STR.capture.unlit;
    this.pendingCapture = { headline: e.room ? STR.capture.room : STR.capture.corridor, detail };
  }

  private pendingCapture: { headline: string; detail: string } | null = null;

  private onComplete(): void {
    const w = this.world;
    this.audio.stopRepair();
    this.audio.result();
    this.setState(w.setup.ending ? 'ending' : 'complete');
    if (this.shift >= 1) this.save.completeShift(this.shift);
    const crit: { label: string; met: boolean }[] = [
      { label: STR.results.lampDone, met: true },
      { label: STR.results.lampUnseen, met: w.chases === 0 },
      w.tenantActive ? { label: STR.results.lampTenant, met: w.tenantHelped } : { label: STR.results.lampPar(formatTime(w.setup.parTime)), met: w.time <= w.setup.parTime },
    ];
    const rating = crit.filter((c) => c.met).length;
    const key = String(this.shift);
    if ((this.save.data.best[key] ?? 0) < rating) {
      this.save.data.best[key] = rating;
      this.save.save();
    }
    this.lastResult = {
      shift: this.shift,
      repairs: w.repairs,
      tenant: w.tenantActive ? (w.tenantHelped ? 'helped' : 'missed') : 'none',
      time: w.time,
      seed: this.seed,
      criteria: crit,
      newRecords: [],
      hasNext: this.shift >= 1 && this.shift < 5,
    };
    this.diag.log('shiftComplete', { shift: this.shift, time: Math.round(w.time), rating });
    if (w.setup.ending) this.startEnding();
    else this.completeTimer = 0.7;
  }

  private showResults(r: ResultInfo): void {
    this.menus.showResults(
      r,
      () => void this.transition(this.shift + 1),
      () => void this.transition(this.shift, this.shift === 0 ? undefined : this.seed),
      () => this.showShiftsFrom('end'),
    );
  }

  // ------------------------------------------------------------------ ending

  private startEnding(): void {
    const w = this.world;
    const lvl = w.level;
    // Stage the departure from a dark cell near the 104 threshold — never inside protection.
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < lvl.w * lvl.h; i++) {
      if (!lvl.walk[i] || w.prot.mask[i]) continue;
      const cx = (i % lvl.w) + 0.5;
      const cz = Math.floor(i / lvl.w) + 0.5;
      const d = Math.hypot(cx - w.px, cz - w.pz);
      // Prefer a threshold in plain view of the caretaker over one behind a wall.
      const score = d + (segmentClear(lvl, lvl.blockSight, cx, cz, w.px, w.pz) ? 0 : 50);
      if (d >= 2.5 && score < bd) {
        bd = score;
        best = i;
      }
    }
    if (best < 0) best = lvl.spawns[0];
    const x = (best % lvl.w) + 0.5;
    const z = Math.floor(best / lvl.w) + 0.5;
    this.endingSpot = { x, z, yaw: Math.atan2(w.px - x, w.pz - z) };
    this.endingT = 0;
    this.awardRecord(6);
    this.menus.showEndingSkip(() => this.finishEnding());
  }

  private updateEnding(dt: number): void {
    if (this.endingT < 0) return;
    this.endingT += dt;
    const t = this.endingT;
    const s = this.endingSpot;
    const fadeIn = Math.min(1, Math.max(0, (t - 1.0) / 1.2));
    const fadeOut = Math.min(1, Math.max(0, (t - 4.2) / 1.4));
    this.creatureView.ending = { x: s.x, z: s.z, yaw: s.yaw, opacity: fadeIn * (1 - fadeOut), alert: t > 2.4 && t < 4.2 ? 0.35 : 0 };
    this.playerView.setRaise(Math.min(1, t / 1.0) * (1 - fadeOut * 0.5));
    if (t > 4.2 && t < 5.6) this.effects.smokeAt(s.x, s.z, 14, dt);
    this.render.rig.zoom = 0.85;
    if (t >= 6.2) this.finishEnding();
  }

  private finishEnding(): void {
    if (this.endingT < 0 && this.menus.current === 'ending') return;
    this.endingT = -1;
    this.creatureView.ending = { ...this.endingSpot, opacity: 0, alert: 0 };
    this.audio.ending();
    this.showEndingScreen();
  }

  private showEndingScreen(): void {
    this.menus.showEnding(
      () => void this.transition(0),
      () => this.menus.showRecords(this.save.data.records, () => this.showEndingScreen()),
      () => this.showShiftsFrom('end'),
    );
  }

  // ------------------------------------------------------------------ presentation

  private present(dt: number): void {
    const w = this.world;
    const s = this.save.data.settings;
    const ps = { reducedMotion: s.reducedMotion, gentle: s.scare === 'gentle' };
    const simDt = this.state === 'playing' && !this.pause.paused ? dt : 0;

    if (this.captureTimer >= 0) {
      this.captureTimer -= dt;
      if (this.captureTimer < 0 && this.pendingCapture) {
        const pc = this.pendingCapture;
        this.pendingCapture = null;
        this.menus.showCapture(pc, () => void this.transition(this.shift, this.seed), () => this.showShiftsFrom('end'));
      }
    }
    if (this.completeTimer >= 0) {
      this.completeTimer -= dt;
      if (this.completeTimer < 0 && this.lastResult) {
        this.lastResult.newRecords = this.runNewRecords.map((id) => getRecord(id)!).filter(Boolean);
        this.showResults(this.lastResult);
      }
    }
    this.updateEnding(dt);

    this.playerView.update(simDt || (this.state === 'ending' ? dt : 0), w, ps);
    this.creatureView.update(simDt || (this.state === 'ending' || this.state === 'captured' ? dt : 0), w.creature, ps);
    const cr = w.creature;
    if (simDt > 0 && (cr.state === 'emerging' || cr.state === 'dissolving' || (cr.state === 'staged' && cr.t < cr.tuning.emergeTime))) {
      this.effects.smokeAt(cr.x, cr.z, 22, dt);
    }
    this.effects.update(dt);

    const target = w.target;
    const preview = target && target.kind === 'switch' && this.state === 'playing' ? w.level.switches[target.id].circuit : -1;
    const moving = w.pSpeed > 0.2 ? Math.min(1, w.pSpeed / PLAYER.speed) : 0;
    const fx = Math.sin(w.facing) * moving;
    const fz = Math.cos(w.facing) * moving;
    if (this.state === 'ending' || this.endingT >= 0) {
      const lx = (this.endingSpot.x + w.px) / 2;
      const lz = (this.endingSpot.z + w.pz) / 2;
      this.render.rig.follow(lx, lz, 0, 0, dt, s.reducedMotion);
    } else this.render.rig.follow(w.px, w.pz, fx, fz, dt, s.reducedMotion);
    this.levelView?.update(dt, { previewCircuit: preview, reducedMotion: s.reducedMotion, debugCollision: this.debugCollision }, this.render.rig.targetX, this.render.rig.targetZ);
    this.updateGuide(dt);
    this.audio.setChasing(simDt > 0 && cr.state === 'chase', dt);
    if (this.state === 'playing' || this.state === 'captured' || this.state === 'complete') this.updateHud(dt);
  }

  private updateGuide(dt: number): void {
    const w = this.world;
    this.guideTimer -= dt;
    if (this.guideTimer > 0) return;
    this.guideTimer = 0.35;
    const alert = w.creature.state === 'chase' || w.creature.state === 'warn';
    if (!this.guideNav || this.state !== 'playing' || alert) {
      this.effects.setGuide(this.guidePts, 0);
      return;
    }
    const lvl = w.level;
    const goals = new Set<number>();
    if (w.exitUnlocked) {
      for (const c of lvl.landingCells) goals.add(c);
    } else for (const f of w.faultsRemaining) goals.add(lvl.fixtures[f].cell);
    const nav = this.guideNav;
    const goal = nav.flood(w.playerCell, (c) => (lvl.walk[c] ? 0 : -1), Infinity, (c) => goals.has(c));
    const len = goal >= 0 ? nav.pathTo(goal, this.guidePath) : 0;
    // Dashes start a little ahead of the caretaker and stop short of the objective.
    let n = 0;
    for (let i = 1; i < len - 1 && n < 30; i++) {
      const c = this.guidePath[i];
      this.guidePts[n * 2] = (c % lvl.w) + 0.5;
      this.guidePts[n * 2 + 1] = Math.floor(c / lvl.w) + 0.5;
      n++;
    }
    this.effects.setGuide(this.guidePts, n);
  }

  private updateHud(dt: number): void {
    const w = this.world;
    const touch = this.touch.visible;
    const pending = [0, 1, 2].map((c) => w.circuits.isPending(c as CircuitId));
    let hint: HudState['hint'] = null;
    const t = w.target;
    if (t && this.state === 'playing') {
      this.render.project(t.x, 1.25, t.z, projOut);
      let text = '';
      let sub = '';
      const key = touch ? '' : '[E] ';
      if (t.kind === 'repair') {
        const f = w.level.fixtures[t.id];
        const c = f.circuit;
        text = `${key}${STR.hint.repair}`;
        sub = `${STR.circuitSymbol[c]} ${STR.circuit[c]} · ${w.circuits.on[c] ? STR.settings.on : STR.settings.off}`;
      } else if (t.kind === 'switch') {
        const c = w.level.switches[t.id].circuit;
        const name = `${STR.circuit[c]} ${STR.circuitSymbol[c]}`;
        const lamps = w.level.fixtures.filter((f) => f.circuit === c).length;
        if (pending[c]) text = `${key}${STR.hint.switchPending(name)}`;
        else text = `${key}${w.circuits.on[c] ? STR.hint.switchOff(name) : STR.hint.switchOn(name)}`;
        sub = !w.circuits.on[c] && w.circuits.used() >= w.circuits.capacity ? STR.toast.powerFull : STR.lamps(lamps);
      } else if (t.kind === 'help') text = `${key}${STR.hint.help}`;
      else text = `${key}${STR.hint.exit}`;
      hint = { x: projOut.x, y: projOut.y, text, sub, progress: w.repairing ? w.repairProgress : 0 };
    }
    let threat: HudState['threat'] = null;
    const cr = w.creature;
    if (this.state === 'playing' && (cr.state === 'warn' || cr.state === 'chase')) {
      this.render.project(w.px, 0.9, w.pz, projOut);
      const px = projOut.x;
      const py = projOut.y;
      this.render.project(cr.x, 0.9, cr.z, projOut);
      const ang = Math.atan2(projOut.y - py, projOut.x - px);
      const r = 62;
      threat = { x: px + Math.cos(ang) * r, y: py + Math.sin(ang) * r, angle: ang, level: cr.state === 'warn' ? 0 : 1 };
    }
    this.hud.update(
      {
        repairs: w.repairs,
        required: REQUIRED_REPAIRS,
        exitOpen: w.exitUnlocked,
        on: w.circuits.on,
        pending,
        used: w.circuits.used(),
        capacity: w.circuits.capacity,
        safe: w.playerProtected,
        hint,
        threat,
      },
      dt,
    );
    this.touch.setKind(this.state === 'playing' && t ? t.kind : null, w.repairing ? w.repairProgress : 0);
    if (w.repairing) this.audio.repairProgress(w.repairProgress);
  }

  // ------------------------------------------------------------------ dev/test helpers

  /** Development/testing: start a run directly (skips menus). */
  devStart(shift: number, seed?: number): void {
    this.menus.hide();
    this.pause.clear();
    this.buildRun(shift, seed);
    this.state = 'ready';
    this.beginPlay();
  }

  get tutorialStep(): number {
    return this.tutorial?.step ?? TSTEP.done;
  }
}
