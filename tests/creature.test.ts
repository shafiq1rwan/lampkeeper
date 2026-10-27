import { describe, expect, it } from 'vitest';
import { Bot } from '../src/dev/bot';
import { generateRun } from '../src/levels/generate';
import { SHIFTS } from '../src/levels/shifts';
import { segmentClear } from '../src/simulation/grid';
import { World } from '../src/simulation/World';
import { cellAt, makeSetup, run } from './helpers';

const HUNTING = new Set(['patrol', 'investigate', 'warn', 'chase', 'cooldown', 'staged', 'capturing']);

describe('creature exclusion and retreat', () => {
  it('never stands in protected cells while hunting, across full autopilot runs', () => {
    for (const def of SHIFTS) {
      for (const seed of [def.defaultSeed, 21, 22]) {
        const w = new World(generateRun(def, seed));
        if (w.setup.tutorial) w.activateCreature(0);
        const bot = new Bot(w);
        for (let i = 0; i < 60 * 120 && w.active; i++) {
          w.step(1 / 60, bot.decide(1 / 60));
          w.drainEvents([]);
          const c = w.creature;
          if (HUNTING.has(c.state)) expect(w.prot.isProtected(c.cell)).toBe(false);
        }
      }
    }
  });

  it('retreats without attacking when a circuit lights around it, and leaves the light', () => {
    // Creature in the B corridor (dark while B is off); unprotected player right beside it.
    const w = new World(makeSetup({ faults: [3, 9, 11], creatureSpawn: cellAt('east-hall', 18, 7), initialCircuits: [true, false, false] }));
    w.creature.state = 'chase';
    w.creature.captureTimer = 0.2;
    w.debugTeleport(19.5, 6.5);
    w.toggleCircuit(1); // B on: lamps at (17,6) and (22,7) now protect the creature's cell
    expect(w.creature.state).toBe('retreat');
    expect(w.creature.captureTimer).toBe(0);
    let steps = 0;
    const ev: string[] = [];
    const state = (): string => w.creature.state;
    while (state() === 'retreat' && steps++ < 600) {
      w.step(1 / 60, { moveX: 0, moveZ: 0, action: false });
      for (const e of w.drainEvents([])) ev.push(e.type);
    }
    expect(ev).not.toContain('capture');
    expect(w.creature.state).toBe('cooldown');
    expect(w.prot.isProtected(w.creature.cell)).toBe(false);
  });

  it('dissolves harmlessly when no dark route remains, then returns telegraphed and away from the player', () => {
    const w = new World(makeSetup({ faults: [3, 9, 11], creatureSpawn: cellAt('east-hall', 12, 7), initialCircuits: [true, false, false] }));
    w.creature.state = 'chase';
    // Every floor cell protected: there is nowhere dark to retreat to.
    for (let i = 0; i < w.level.w * w.level.h; i++) if (w.level.walk[i]) w.prot.mask[i] = 1;
    w.creature.onProtectionChanged();
    expect(w.creature.state).toBe('dissolving');
    // Restore the real mask and wait for the return.
    w.toggleCircuit(1);
    const ev = run(w, w.setup.tuning.dissolveTime + w.setup.tuning.respawnDelay + 3);
    expect(ev.some((e) => e.type === 'capture')).toBe(false);
    const emerge = ev.find((e) => e.type === 'creatureEmerge');
    expect(emerge).toBeDefined();
    if (emerge && emerge.type === 'creatureEmerge') {
      expect(Math.hypot(emerge.x - w.px, emerge.z - w.pz)).toBeGreaterThanOrEqual(w.setup.tuning.spawnMinDistance);
      expect(segmentClear(w.level, w.level.blockSight, emerge.x, emerge.z, w.px, w.pz)).toBe(false);
      expect(w.prot.isProtected(w.creature.cell)).toBe(false);
    }
  });

  it('cannot catch a player through a wall', () => {
    // Player in apartment 105 (6..13, 9..14); creature in the corridor directly north of the wall.
    const w = new World(makeSetup({ faults: [3, 9, 11], creatureSpawn: cellAt('east-hall', 12, 7), initialCircuits: [false, false, false] }));
    w.debugTeleport(12.5, 9.5);
    expect(w.playerProtected).toBe(false);
    w.creature.state = 'chase';
    expect(segmentClear(w.level, w.level.blockSight, w.creature.x, w.creature.z, w.px, w.pz)).toBe(false);
    // Freeze the creature in place by stepping it only through capture checks: run briefly.
    let caughtThroughWall = false;
    for (let i = 0; i < 30; i++) {
      w.step(1 / 60, { moveX: 0, moveZ: 0, action: false });
      const los = segmentClear(w.level, w.level.blockSight, w.creature.x, w.creature.z, w.px, w.pz);
      if (w.captured && !los) caughtThroughWall = true;
    }
    expect(caughtThroughWall).toBe(false);
  });

  it('never catches a protected player, even with the creature at the light boundary', () => {
    const w = new World(makeSetup({ faults: [3, 9, 11], creatureSpawn: cellAt('east-hall', 16, 7), initialCircuits: [true, false, false] }));
    // Player stands just inside A's protection at (14,7); creature hunts from the dark.
    w.debugTeleport(14.6, 7.5);
    expect(w.playerProtected).toBe(true);
    w.creature.state = 'chase';
    const ev = run(w, 8);
    expect(ev.some((e) => e.type === 'capture')).toBe(false);
    expect(w.prot.isProtected(w.creature.cell)).toBe(false);
  });

  it('requires a short sustained contact (reaction window), not a single frame', () => {
    const w = new World(makeSetup({ faults: [3, 9, 11], creatureSpawn: cellAt('east-hall', 18, 7), initialCircuits: [false, false, false] }));
    w.debugTeleport(18.9, 7.5);
    w.creature.state = 'chase';
    let firstContact = -1;
    let capturedAt = -1;
    for (let i = 0; i < 120 && w.active; i++) {
      w.step(1 / 60, { moveX: 0, moveZ: 0, action: false });
      const d = Math.hypot(w.creature.x - w.px, w.creature.z - w.pz);
      if (firstContact < 0 && d <= w.setup.tuning.captureRange) firstContact = i;
    }
    capturedAt = w.captured ? 1 : -1;
    expect(firstContact).toBeGreaterThanOrEqual(0);
    expect(capturedAt).toBe(1);
    // Capture time must be at least captureGrace after first contact.
    const w2 = new World(makeSetup({ faults: [3, 9, 11], creatureSpawn: cellAt('east-hall', 18, 7), initialCircuits: [false, false, false] }));
    w2.debugTeleport(18.9, 7.5);
    w2.creature.state = 'chase';
    const graceSteps = Math.floor(w2.setup.tuning.captureGrace * 60) - 1;
    for (let i = 0; i < firstContact + graceSteps; i++) w2.step(1 / 60, { moveX: 0, moveZ: 0, action: false });
    expect(w2.captured).toBe(false);
  });

  it('warns for ~0.8s before a new chase', () => {
    const w = new World(makeSetup({ faults: [3, 9, 11], creatureSpawn: cellAt('east-hall', 20, 7), initialCircuits: [false, false, false] }));
    w.creature.state = 'patrol';
    w.debugTeleport(17.5, 7.5);
    let warnAt = -1;
    let chaseAt = -1;
    for (let i = 0; i < 300 && w.active; i++) {
      w.step(1 / 60, { moveX: 0, moveZ: 0, action: false });
      for (const e of w.drainEvents([])) {
        if (e.type === 'creatureWarn' && warnAt < 0) warnAt = i;
        if (e.type === 'chaseStart' && chaseAt < 0) chaseAt = i;
      }
    }
    expect(warnAt).toBeGreaterThanOrEqual(0);
    expect((chaseAt - warnAt) / 60).toBeCloseTo(w.setup.tuning.warnTime, 1);
  });

  it('the tutorial demonstration is harmless and stops at the light', () => {
    const w = new World(generateRun(SHIFTS[0], SHIFTS[0].defaultSeed));
    expect(w.creature.state).toBe('inactive');
    expect(w.startStagedDemo()).toBe(true);
    let minD = Infinity;
    const ev = run(w, 14, (ww) => {
      minD = Math.min(minD, Math.hypot(ww.creature.x - ww.px, ww.creature.z - ww.pz));
      return { moveX: 0, moveZ: 0, action: false };
    });
    expect(ev.some((e) => e.type === 'capture')).toBe(false);
    expect(ev.some((e) => e.type === 'stagedArrived')).toBe(true);
    expect(ev.some((e) => e.type === 'stagedDone')).toBe(true);
    expect(minD).toBeGreaterThan(1.5);
  });

  it('bounds navigation work (no full search every frame)', () => {
    const w = new World(generateRun(SHIFTS[1], SHIFTS[1].defaultSeed));
    w.creature.state = 'chase';
    w.debugTeleport(w.level.startX, w.level.startZ);
    const before = w.nav.floods;
    run(w, 10);
    // ≈ one replan per repath interval plus occasional pocket checks; far fewer than 600 frames.
    expect(w.nav.floods - before).toBeLessThan(150);
  });
});
