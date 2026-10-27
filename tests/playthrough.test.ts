// Complete simulated playthroughs with the autopilot, which uses only legal inputs
// (movement vector + one action) — the same interface keyboard and touch feed.

import { describe, expect, it } from 'vitest';
import { Bot } from '../src/dev/bot';
import type { SimEvent } from '../src/game/types';
import { generateRun } from '../src/levels/generate';
import { REPLAY, SHIFTS } from '../src/levels/shifts';
import { SaveStore } from '../src/platform/storage';
import { World } from '../src/simulation/World';

function play(w: World, maxSeconds = 600): { events: SimEvent[]; time: number } {
  const bot = new Bot(w);
  const events: SimEvent[] = [];
  const buf: SimEvent[] = [];
  let demo = false;
  for (let i = 0; i < maxSeconds * 60 && w.active; i++) {
    w.step(1 / 60, bot.decide(1 / 60));
    for (const e of w.drainEvents(buf)) {
      events.push(e);
      // Mirror the tutorial controller: demonstration after the first repair, then normal play.
      if (w.setup.tutorial && e.type === 'repairDone' && !demo) {
        demo = true;
        w.startStagedDemo();
      }
      if (e.type === 'stagedDone') w.activateCreature(6);
    }
  }
  return { events, time: w.time };
}

describe('complete playthroughs', () => {
  it('all five authored shifts are completable and progression reaches the ending and replay', () => {
    const save = new SaveStore(null);
    for (const def of SHIFTS) {
      expect(save.unlockedShift).toBe(def.id);
      const w = new World(generateRun(def, def.defaultSeed));
      const { events } = play(w);
      expect(w.complete).toBe(true);
      expect(w.repairs).toBe(3);
      expect(events.some((e) => e.type === 'capture')).toBe(false);
      save.completeShift(def.id);
    }
    expect(save.data.completed).toEqual([1, 2, 3, 4, 5]);
    expect(save.data.replayUnlocked).toBe(true);
  });

  it('replay seeds are completable', () => {
    let done = 0;
    const seeds = Array.from({ length: 12 }, (_, i) => 1000 + i * 37);
    for (const seed of seeds) {
      const w = new World(generateRun(REPLAY, seed));
      play(w);
      if (w.complete) done++;
    }
    expect(done).toBe(seeds.length);
  });

  it('optional tenants can be helped on the way (shift 3 and 4)', () => {
    for (const def of [SHIFTS[2], SHIFTS[3]]) {
      const w = new World(generateRun(def, def.defaultSeed));
      const { events } = play(w);
      expect(w.complete).toBe(true);
      expect(events.some((e) => e.type === 'tenantHelped')).toBe(true);
    }
  });

  it('the ending shift does not need the tenant or every record', () => {
    const def = SHIFTS[4];
    const w = new World(generateRun(def, def.defaultSeed));
    expect(w.tenantActive).toBe(false);
    play(w);
    expect(w.complete).toBe(true);
  });

  it('a retry builds a clean, identical run', () => {
    const def = SHIFTS[1];
    const a = new World(generateRun(def, 4242));
    play(a, 15);
    const b = new World(generateRun(def, 4242));
    expect(b.repairs).toBe(0);
    expect(b.faultsRemaining).toEqual(generateRun(def, 4242).faults);
    expect([b.px, b.pz]).toEqual([b.level.startX, b.level.startZ]);
    expect(b.circuits.on).toEqual(def.initialCircuits);
  });
});
