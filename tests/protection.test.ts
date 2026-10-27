import { describe, expect, it } from 'vitest';
import { LIGHT } from '../src/game/config';
import { K, loadLevel } from '../src/levels/LevelData';
import { TEMPLATES } from '../src/levels/templates';
import { segmentClear } from '../src/simulation/grid';
import { computeMaskInto, darknessCause } from '../src/simulation/protection';
import { World } from '../src/simulation/World';
import { makeSetup } from './helpers';

describe('wall-respecting protection', () => {
  for (const t of TEMPLATES) {
    it(`${t.id}: lamps never protect through walls even when the radius overlaps`, () => {
      const L = loadLevel(t.id);
      let blockedInRadius = 0;
      for (const f of L.fixtures) {
        const r = f.room ? LIGHT.roomRadius : LIGHT.corridorRadius;
        const cov = new Set(f.coverage);
        for (let i = 0; i < L.w * L.h; i++) {
          if (!L.walk[i]) continue;
          const x = (i % L.w) + 0.5;
          const z = Math.floor(i / L.w) + 0.5;
          if (Math.hypot(x - (f.cx + 0.5), z - (f.cz + 0.5)) > r) continue;
          const clear = segmentClear(L, L.blockSight, f.cx + 0.5, f.cz + 0.5, x, z);
          if (!clear) {
            blockedInRadius++;
            expect(cov.has(i)).toBe(false);
          } else expect(cov.has(i)).toBe(true);
        }
      }
      // The template genuinely has radius-overlaps-wall cases, so the check is meaningful.
      expect(blockedInRadius).toBeGreaterThan(10);
    });
  }

  it('a specific lamp does not light the room behind its wall', () => {
    const L = loadLevel('east-hall');
    // Corridor lamp A at (7,6) sits under the wall of apartment 101/102 (row 5).
    const lamp = L.fixtures.find((f) => f.cx === 7 && f.cz === 6)!;
    const behind = 4 * L.w + 7; // (7,4) is inside apartment 102 beyond the wall, 2 cells away
    expect(L.kind[5 * L.w + 7]).toBe(K.Wall);
    expect(lamp.coverage.includes(behind)).toBe(false);
  });

  it('broken and unpowered fixtures are distinguishable and both leave darkness', () => {
    const w = new World(makeSetup({ faults: [4, 5, 10], initialCircuits: [true, false, false] }));
    const brokenLamp = w.level.fixtures[4]; // A, powered but broken
    const offLamp = w.level.fixtures[7]; // B, working but unpowered
    const onlyBroken = brokenLamp.coverage.find((c) => !w.level.emergency[c] && !w.level.fixtures.some((f) => f.id !== 4 && w.circuits.on[f.circuit] && !w.broken[f.id] && f.coverage.includes(c)))!;
    expect(w.prot.isProtected(onlyBroken)).toBe(false);
    expect(darknessCause(w.level, onlyBroken, w.circuits.on, w.broken).cause).toBe('broken');
    const onlyOff = offLamp.coverage.find((c) => !w.level.emergency[c])!;
    expect(w.prot.isProtected(onlyOff)).toBe(false);
    expect(darknessCause(w.level, onlyOff, w.circuits.on, w.broken)).toEqual({ cause: 'circuitOff', circuit: 1 });
  });

  it('a repaired fixture becomes safe only when its circuit is powered', () => {
    const w = new World(makeSetup({ faults: [5, 4, 10], initialCircuits: [true, false, false] }));
    const lamp = w.level.fixtures[5]; // B corridor lamp
    const cell = lamp.cell;
    w.broken[5] = 0; // as if repaired while circuit B is off
    w.toggleCircuit(1);
    expect(w.prot.isProtected(cell)).toBe(true);
    const w2 = new World(makeSetup({ faults: [5, 4, 10], initialCircuits: [true, true, false] }));
    expect(w2.prot.isProtected(cell)).toBe(false); // powered but still broken
  });

  it('emergency lighting (nook, landing, panels) is always protected regardless of circuits', () => {
    for (const t of TEMPLATES) {
      const L = loadLevel(t.id);
      const mask = computeMaskInto(L, [false, false, false], new Uint8Array(L.fixtures.length).fill(1), null, new Uint8Array(L.w * L.h));
      for (const c of L.nookCells) expect(mask[c]).toBe(1);
      for (const c of L.landingCells) expect(mask[c]).toBe(1);
      for (const s of L.switches) expect(mask[s.cell]).toBe(1);
    }
  });

  it('player safety reads the same mask the footprint and creature use', () => {
    const w = new World(makeSetup());
    for (let i = 0; i < w.level.w * w.level.h; i++) {
      if (!w.level.walk[i]) continue;
      w.debugTeleport((i % w.level.w) + 0.5, Math.floor(i / w.level.w) + 0.5);
      expect(w.playerProtected).toBe(w.prot.mask[i] === 1);
    }
  });
});
