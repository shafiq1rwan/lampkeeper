import { describe, expect, it } from 'vitest';
import { POWER } from '../src/game/config';
import { CircuitBoard } from '../src/simulation/circuits';
import { World } from '../src/simulation/World';
import { makeSetup, run } from './helpers';

describe('circuit capacity', () => {
  it('never exceeds capacity and never silently disables another circuit', () => {
    const b = new CircuitBoard(2, [true, false, false]);
    expect(b.toggle(1)).toBe('on');
    expect(b.toggle(2)).toBe('full');
    expect(b.on).toEqual([true, true, false]);
    expect(b.used()).toBe(2);
  });

  it('keeps a switching-off circuit counted until its warning finishes', () => {
    const b = new CircuitBoard(2, [true, true, false]);
    expect(b.toggle(0)).toBe('offPending');
    expect(b.toggle(2)).toBe('full');
    expect(b.update(POWER.offWarning * 0.5)).toBe(0);
    expect(b.on[0]).toBe(true);
    expect(b.update(POWER.offWarning * 0.6)).toBe(1);
    expect(b.on[0]).toBe(false);
    expect(b.toggle(2)).toBe('on');
  });

  it('cancels a pending switch-off when operated again', () => {
    const b = new CircuitBoard(2, [true, false, false]);
    b.toggle(0);
    expect(b.toggle(0)).toBe('offCancelled');
    b.update(5);
    expect(b.on[0]).toBe(true);
  });

  it('clamps an initial allocation to capacity', () => {
    const b = new CircuitBoard(2, [true, true, true]);
    expect(b.used()).toBe(2);
  });
});

describe('power through the world', () => {
  it('reports power full and keeps the allocation unchanged', () => {
    const w = new World(makeSetup({ initialCircuits: [true, true, false] }));
    w.toggleCircuit(2);
    const ev = w.drainEvents([]);
    expect(ev.some((e) => e.type === 'powerFull')).toBe(true);
    expect(w.circuits.on).toEqual([true, true, false]);
  });

  it('removes protection only after the ~1s warning', () => {
    const w = new World(makeSetup({ initialCircuits: [true, false, false] }));
    const fixture = w.level.fixtures[4]; // A corridor lamp, working
    const cell = fixture.cell;
    expect(w.prot.isProtected(cell)).toBe(true);
    w.toggleCircuit(0);
    expect(w.prot.isProtected(cell)).toBe(true);
    expect(w.prot.fading[cell]).toBe(1);
    run(w, POWER.offWarning * 0.8);
    expect(w.prot.isProtected(cell)).toBe(true);
    const ev = run(w, POWER.offWarning * 0.4);
    expect(ev.some((e) => e.type === 'circuitOff')).toBe(true);
    expect(w.prot.isProtected(cell)).toBe(false);
  });
});
