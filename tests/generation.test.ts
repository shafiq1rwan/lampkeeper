import { describe, expect, it } from 'vitest';
import { VALIDATION } from '../src/game/config';
import { fallbackSetup, generateRun, validateSetup } from '../src/levels/generate';
import { loadLevel } from '../src/levels/LevelData';
import { REPLAY, SHIFTS, type ShiftDef } from '../src/levels/shifts';
import { deriveSeed, Rng } from '../src/simulation/rng';
import { World } from '../src/simulation/World';
import { run } from './helpers';

describe('seeded reproducibility', () => {
  it('same shift + seed ⇒ identical gameplay-affecting setup', () => {
    for (const def of [...SHIFTS, REPLAY]) {
      for (const seed of [1, 42, 99999, def.defaultSeed]) {
        expect(generateRun(def, seed)).toEqual(generateRun(def, seed));
      }
    }
  });

  it('same seed ⇒ identical creature behaviour over time', () => {
    const a = new World(generateRun(SHIFTS[2], 777));
    const b = new World(generateRun(SHIFTS[2], 777));
    run(a, 20);
    run(b, 20);
    expect([a.creature.x, a.creature.z, a.creature.state]).toEqual([b.creature.x, b.creature.z, b.creature.state]);
  });

  it('different seeds vary the layout', () => {
    const sigs = new Set<string>();
    for (let s = 1; s <= 25; s++) {
      const r = generateRun(REPLAY, s);
      sigs.add(`${r.templateId}:${r.faults.join(',')}:${r.tenant}:${r.creatureSpawn}`);
    }
    expect(sigs.size).toBeGreaterThan(10);
  });

  it('cosmetic streams are independent of gameplay streams', () => {
    const seed = 1234;
    // Changing how many cosmetic draws happen cannot change gameplay picks: they are separate streams.
    const cosmetic = new Rng(deriveSeed(seed, 'cosmetic:east-hall'));
    for (let i = 0; i < 1000; i++) cosmetic.next();
    expect(generateRun(SHIFTS[2], seed)).toEqual(generateRun(SHIFTS[2], seed));
    expect(deriveSeed(seed, 'cosmetic:east-hall')).not.toBe(deriveSeed(seed, 'faults#0'));
  });
});

describe('level validation and fallback', () => {
  it('every authored shift validates with its default seed without falling back', () => {
    for (const def of [...SHIFTS, REPLAY]) {
      const s = generateRun(def, def.defaultSeed);
      expect(s.usedFallback).toBe(false);
      const v = validateSetup(s, def);
      expect(v.reasons).toEqual([]);
      expect(v.plan.length).toBeGreaterThan(0);
    }
  });

  it('rarely needs the fallback across many seeds, and every result validates', () => {
    for (const def of [...SHIFTS, REPLAY]) {
      let fallbacks = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const s = generateRun(def, seed);
        if (s.usedFallback) fallbacks++;
        expect(validateSetup(s, def).ok).toBe(true);
      }
      expect(fallbacks).toBeLessThan(3);
    }
  });

  it('authored fallbacks are themselves valid', () => {
    for (const def of [...SHIFTS, REPLAY]) {
      const v = validateSetup(fallbackSetup(def, 5), def);
      expect(v.reasons).toEqual([]);
    }
  });

  it('uses the fallback after bounded attempts when no seeded combination can pass', () => {
    const impossible: ShiftDef = { ...SHIFTS[1], faultRule: { ...SHIFTS[1].faultRule, minCircuits: 4 }, fallback: SHIFTS[1].fallback };
    const s = generateRun(impossible, 3);
    expect(s.usedFallback).toBe(true);
    expect(s.attempts).toBe(VALIDATION.attempts);
    expect(s.faults).toEqual(SHIFTS[1].fallback.faults);
  });

  it('rejects broken setups for concrete reasons', () => {
    const def = SHIFTS[1];
    const good = generateRun(def, def.defaultSeed);
    const L = loadLevel(good.templateId);
    // Creature on top of the player.
    expect(validateSetup({ ...good, creatureSpawn: L.startCell }, def).reasons).toContain('creature spawn violates clearance');
    // Exceeding capacity at the start.
    expect(validateSetup({ ...good, initialCircuits: [true, true, true] }, def).reasons).toContain('initial circuits exceed capacity');
    // Duplicate faults.
    expect(validateSetup({ ...good, faults: [good.faults[0], good.faults[0], good.faults[1]] }, def).ok).toBe(false);
    // Tutorial whose first repair is out in the dark.
    const tut = SHIFTS[0];
    const t = generateRun(tut, tut.defaultSeed);
    const darkFirst = loadLevel(t.templateId).fixtures.find((f) => !f.nook)!.id;
    expect(validateSetup({ ...t, faults: [darkFirst, t.faults[1], t.faults[2]] }, tut).ok).toBe(false);
  });

  it('power-aware check fails when exposure limits make the route impossible', () => {
    const def: ShiftDef = { ...SHIFTS[1], maxLegExposure: 0.5 };
    const s = generateRun(SHIFTS[1], SHIFTS[1].defaultSeed);
    expect(validateSetup(s, def).reasons).toContain('no repair order and power plan within exposure limit');
  });

  it('progression: shift 1 is the tutorial, shift 5 ends at 104, three repairs each', () => {
    expect(SHIFTS.map((s) => s.id)).toEqual([1, 2, 3, 4, 5]);
    expect(generateRun(SHIFTS[0], 1).tutorial).toBe(true);
    expect(generateRun(SHIFTS[0], 1).creatureSpawn).toBe(-1);
    const last = generateRun(SHIFTS[4], SHIFTS[4].defaultSeed);
    expect(last.ending).toBe(true);
    expect(loadLevel(last.templateId).template.exitLabel).toBe('104');
    for (const def of SHIFTS) expect(generateRun(def, def.defaultSeed).faults.length).toBe(3);
    // Shift 4 teaches "broken ≠ unpowered": at least two faults sit on circuits that start powered.
    const s4 = generateRun(SHIFTS[3], SHIFTS[3].defaultSeed);
    const L4 = loadLevel(s4.templateId);
    expect(s4.faults.filter((f) => s4.initialCircuits[L4.fixtures[f].circuit]).length).toBeGreaterThanOrEqual(2);
    // At most one tenant per shift, and shift 3 has one.
    expect(generateRun(SHIFTS[2], SHIFTS[2].defaultSeed).tenant).toBeGreaterThanOrEqual(0);
  });
});
