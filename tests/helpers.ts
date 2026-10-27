import { CREATURE_DEFAULT } from '../src/game/config';
import type { SimEvent, SimInput } from '../src/game/types';
import { loadLevel } from '../src/levels/LevelData';
import type { RunSetup } from '../src/levels/setup';
import { World } from '../src/simulation/World';

export const IDLE: SimInput = { moveX: 0, moveZ: 0, action: false };

/** A hand-built setup on a template, for focused rule tests. */
export function makeSetup(over: Partial<RunSetup> = {}): RunSetup {
  return {
    shift: 0,
    seed: 1,
    templateId: 'east-hall',
    faults: [3, 5, 10],
    tenant: -1,
    creatureSpawn: -1,
    creatureSeed: 7,
    initialCircuits: [true, false, false],
    capacity: 2,
    tuning: { ...CREATURE_DEFAULT },
    tutorial: false,
    tenantRecord: -1,
    repairRecords: {},
    ending: false,
    parTime: 300,
    usedFallback: false,
    attempts: 1,
    ...over,
  };
}

export function cellAt(templateId: string, x: number, z: number): number {
  return z * loadLevel(templateId).w + x;
}

/** Step a world for `seconds`, collecting events. */
export function run(w: World, seconds: number, input: SimInput | ((w: World) => SimInput) = IDLE): SimEvent[] {
  const out: SimEvent[] = [];
  const buf: SimEvent[] = [];
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps && w.active; i++) {
    w.step(1 / 60, typeof input === 'function' ? input(w) : input);
    out.push(...w.drainEvents(buf));
  }
  return out;
}
