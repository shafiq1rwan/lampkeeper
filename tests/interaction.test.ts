import { describe, expect, it } from 'vitest';
import { INTERACT } from '../src/game/config';
import type { SimInput } from '../src/game/types';
import { segmentClear } from '../src/simulation/grid';
import { World } from '../src/simulation/World';
import { IDLE, makeSetup, run } from './helpers';

const HOLD: SimInput = { moveX: 0, moveZ: 0, action: true };

describe('context targeting', () => {
  it('never targets something through a wall, even when in range', () => {
    const w = new World(makeSetup());
    // A synthetic long-range target inside apartment 102; the corridor is south of its wall (row 5).
    const t = { kind: 'switch' as const, id: 0, x: 13.5, z: 3.5, range: 10, solidCell: -1, order: -1 };
    w.targets.unshift(t);
    w.debugTeleport(13.5, 6.5); // wall cell (13,5) in between
    expect(w.findTarget()).not.toBe(t);
    w.debugTeleport(11.5, 6.5); // in line with the open doorway at (11,5)
    w.target = null;
    t.x = 11.5;
    expect(w.findTarget()).toBe(t);
  });

  it('every highlighted target, from every standable cell, is in range with a clear line', () => {
    for (const templateId of ['east-hall', 'ring', 'long-wing']) {
      const w = new World(makeSetup({ templateId, faults: [1, 2, 6], tenant: 0 }));
      w.exitUnlocked = true;
      const L = w.level;
      for (let i = 0; i < L.w * L.h; i++) {
        if (!L.walk[i]) continue;
        for (const [ox, oz] of [[0.5, 0.5], [0.32, 0.32], [0.68, 0.68]]) {
          w.debugTeleport((i % L.w) + ox, Math.floor(i / L.w) + oz);
          w.target = null;
          const t = w.findTarget();
          if (!t) continue;
          expect(Math.hypot(t.x - w.px, t.z - w.pz)).toBeLessThanOrEqual(t.range + 1e-6);
          expect(segmentClear(L, L.blockSight, w.px, w.pz, t.x, t.z, t.solidCell)).toBe(true);
        }
      }
    }
  });

  it('chooses the nearest eligible target with a stable tie-break', () => {
    const w = new World(makeSetup());
    // Nook breaker: A at (1,7), B at (1,8), C at (1,9). Standing exactly between A and B.
    w.debugTeleport(1.5, 8.0);
    const t1 = w.findTarget();
    const t2 = w.findTarget();
    expect(t1).toBe(t2);
    expect(t1?.kind).toBe('switch');
    expect(w.level.switches[t1!.id].circuit).toBe(0); // tie → lower order wins
    w.debugTeleport(1.5, 8.6);
    w.target = null;
    expect(w.level.switches[w.findTarget()!.id].circuit).toBe(1);
  });

  it('one press operates exactly one switch, with debounce', () => {
    const w = new World(makeSetup({ initialCircuits: [true, false, false] }));
    w.debugTeleport(1.5, 8.5); // at the B switch
    const ev = run(w, 0.5, HOLD); // holding is one press
    expect(ev.filter((e) => e.type === 'circuitOn' || e.type === 'circuitOffPending').length).toBe(1);
    expect(w.circuits.on).toEqual([true, true, false]);
  });

  it('repair needs a ~1.5s hold; releasing cancels with no partial progress', () => {
    const w = new World(makeSetup({ faults: [3, 5, 10] }));
    const f = w.level.fixtures[3];
    w.debugTeleport(f.cx + 0.5, f.cz + 0.5);
    run(w, INTERACT.repairTime * 0.6, HOLD);
    expect(w.repairing).toBe(true);
    const ev = run(w, 0.1, IDLE);
    expect(ev.some((e) => e.type === 'repairCancel')).toBe(true);
    expect(w.repairProgress).toBe(0);
    expect(w.broken[3]).toBe(1);
    const ev2 = run(w, INTERACT.repairTime + 0.1, HOLD);
    expect(ev2.some((e) => e.type === 'repairDone')).toBe(true);
    expect(w.broken[3]).toBe(0);
    expect(w.repairs).toBe(1);
  });

  it('moving out of range cancels a repair', () => {
    const w = new World(makeSetup({ faults: [4, 5, 10] }));
    const f = w.level.fixtures[4];
    w.debugTeleport(f.cx + 0.5, f.cz + 0.5);
    run(w, 0.3, HOLD);
    expect(w.repairing).toBe(true);
    const ev = run(w, 2.5, { moveX: 1, moveZ: 0, action: true });
    expect(ev.some((e) => e.type === 'repairCancel')).toBe(true);
    expect(w.broken[4]).toBe(1);
  });

  it('a held action that completed a repair does not start another', () => {
    const w = new World(makeSetup({ faults: [3, 5, 10] }));
    const f = w.level.fixtures[3];
    w.debugTeleport(f.cx + 0.5, f.cz + 0.5);
    const ev = run(w, INTERACT.repairTime * 3, HOLD);
    expect(ev.filter((e) => e.type === 'repairDone').length).toBe(1);
    expect(ev.filter((e) => e.type === 'circuitOn' || e.type === 'circuitOffPending').length).toBe(0);
  });

  it('repairs work while the circuit is off; the exit opens after three repairs regardless of power', () => {
    const w = new World(makeSetup({ faults: [5, 9, 11], initialCircuits: [false, false, false] }));
    expect(w.findTarget()?.kind).not.toBe('exit');
    for (const id of [5, 9, 11]) {
      const f = w.level.fixtures[id];
      w.debugTeleport(f.cx + 0.5, f.cz + 0.5);
      run(w, 0.05, IDLE);
      run(w, INTERACT.repairTime + 0.1, HOLD);
      expect(w.broken[id]).toBe(0);
      expect(w.prot.isProtected(f.cell) && !w.level.emergency[f.cell]).toBe(false); // repaired but unpowered
    }
    expect(w.exitUnlocked).toBe(true);
    const landing = w.level.landingCells[w.level.landingCells.length - 1];
    w.debugTeleport((landing % w.level.w) + 0.5, Math.floor(landing / w.level.w) + 0.5);
    run(w, 0.05, IDLE);
    expect(w.findTarget()?.kind).toBe('exit');
    run(w, 0.1, HOLD);
    expect(w.complete).toBe(true);
  });

  it('helping a tenant is one press at the porch and is recorded once', () => {
    const w = new World(makeSetup({ tenant: 0 }));
    const spot = w.level.tenants[0];
    w.debugTeleport((spot.porchCell % w.level.w) + 0.5, Math.floor(spot.porchCell / w.level.w) + 0.5);
    expect(w.playerProtected).toBe(true); // safe doorway
    const ev = run(w, 0.6, HOLD);
    expect(ev.filter((e) => e.type === 'tenantHelped').length).toBe(1);
    expect(w.tenantHelped).toBe(true);
    run(w, 0.1, IDLE);
    expect(run(w, 0.3, HOLD).filter((e) => e.type === 'tenantHelped').length).toBe(0);
  });
});
