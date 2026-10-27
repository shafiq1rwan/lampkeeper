// Shift 1 onboarding, advanced by player actions. Completed steps are remembered so a retry
// never replays them, and the whole tutorial can be skipped.

import type { SaveStore } from '../platform/storage';
import type { World } from '../simulation/World';
import type { Hud } from '../ui/Hud';
import { STR } from '../ui/strings';
import type { SimEvent } from './types';

export const TSTEP = { move: 0, repair: 1, demo: 2, switch: 3, finish: 4, done: 5 } as const;

export class Tutorial {
  step: number = TSTEP.done;
  private finishTimer = 0;

  constructor(
    private readonly world: World,
    private readonly hud: Hud,
    private readonly save: SaveStore,
    private readonly touch: () => boolean,
  ) {}

  get active(): boolean {
    return this.step < TSTEP.done;
  }

  start(): void {
    if (!this.world.setup.tutorial) {
      this.step = TSTEP.done;
      return;
    }
    const d = this.save.data;
    if (d.tutorialDone) {
      this.step = TSTEP.done;
      this.world.activateCreature(5);
      return;
    }
    // Resume after the demonstration; earlier steps restart because they never completed.
    this.step = d.tutorialStep >= TSTEP.switch ? d.tutorialStep : TSTEP.move;
    if (this.step >= TSTEP.switch) this.world.activateCreature(5);
    this.show();
  }

  private advance(to: number): void {
    if (to <= this.step) return;
    this.step = to;
    if (to > this.save.data.tutorialStep) {
      this.save.data.tutorialStep = to;
      if (to >= TSTEP.done) this.save.data.tutorialDone = true;
      this.save.save();
    }
    this.show();
  }

  private show(): void {
    const t = this.touch();
    switch (this.step) {
      case TSTEP.move:
        this.hud.tutorial(t ? STR.tutorial.moveTouch : STR.tutorial.moveKeys);
        break;
      case TSTEP.repair:
        this.hud.tutorial(t ? STR.tutorial.repairTouch : STR.tutorial.repairKeys);
        break;
      case TSTEP.demo:
        this.hud.tutorial(null);
        break;
      case TSTEP.switch:
        this.hud.tutorial(STR.tutorial.switch);
        break;
      case TSTEP.finish:
        this.hud.tutorial(STR.tutorial.finish, false);
        this.finishTimer = 7;
        break;
      default:
        this.hud.tutorial(null);
    }
  }

  /** Refresh wording after the input device changes (touch ⇄ keyboard). */
  refresh(): void {
    if (this.active) this.show();
  }

  onEvent(e: SimEvent): void {
    if (!this.active) return;
    switch (e.type) {
      case 'firstMove':
        if (this.step === TSTEP.move) this.advance(TSTEP.repair);
        break;
      case 'repairDone':
        if (this.step <= TSTEP.repair) {
          this.advance(TSTEP.demo);
          if (!this.world.startStagedDemo()) this.advance(TSTEP.switch);
        } else if (this.step === TSTEP.finish) this.advance(TSTEP.done);
        break;
      case 'stagedArrived':
        if (this.step === TSTEP.demo) this.hud.tutorial(STR.tutorial.watch);
        break;
      case 'stagedDone':
        if (this.step === TSTEP.demo) {
          this.advance(TSTEP.switch);
          this.world.activateCreature(6);
        }
        break;
      case 'circuitOn':
      case 'circuitOffPending':
      case 'powerFull':
        if (this.step === TSTEP.switch) this.advance(TSTEP.finish);
        break;
      default:
    }
  }

  update(dt: number): void {
    if (this.step === TSTEP.finish) {
      this.finishTimer -= dt;
      if (this.finishTimer <= 0) this.advance(TSTEP.done);
    }
  }

  skip(): void {
    this.step = TSTEP.done;
    this.save.data.tutorialDone = true;
    this.save.data.tutorialStep = TSTEP.done;
    this.save.save();
    this.hud.tutorial(null);
    this.world.activateCreature(4);
  }
}
