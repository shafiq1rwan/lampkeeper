// Five authored shift configurations plus replay. These reuse the three floor templates.

import { CREATURE_DEFAULT, POWER, type CreatureTuning } from '../game/config';

export interface FaultRule {
  /** First fault is the nook fixture, repairable in safety (tutorial). */
  tutorialFirst: boolean;
  /** Faults must span at least this many different circuits. */
  minCircuits: number;
  /** At least this many faults sit on circuits that start powered (broken ≠ unpowered). */
  poweredBroken: number;
}

export interface ShiftDef {
  id: number;
  templates: string[];
  defaultSeed: number;
  capacity: number;
  initialCircuits: boolean[];
  tutorial: boolean;
  faultRule: FaultRule;
  /** Tenant appearance: never, always (if the template has a spot), or a seeded chance. */
  tenant: 'none' | 'always' | number;
  /** Record awarded for helping the tenant (-1: decided at run time for replay). */
  tenantRecord: number;
  /** Repair number → record id. */
  repairRecords: Record<number, number>;
  tuning: Partial<CreatureTuning>;
  /** Maximum unlit cells the validator accepts on any required leg of the route. */
  maxLegExposure: number;
  ending: boolean;
  /** Generous time target for the transparent rating. */
  parTime: number;
  /** Conservative authored fallback used if seeded validation fails. */
  fallback: { templateId: string; faults: number[]; tenant: number; spawnIndex: number };
}

export const SHIFTS: ShiftDef[] = [
  {
    id: 1,
    templates: ['east-hall'],
    defaultSeed: 1101,
    capacity: POWER.capacity,
    initialCircuits: [true, false, false],
    tutorial: true,
    faultRule: { tutorialFirst: true, minCircuits: 2, poweredBroken: 1 },
    tenant: 'none',
    tenantRecord: -1,
    repairRecords: { 1: 1 },
    tuning: { chaseSpeed: 2.5, patrolSpeed: 1.25, detectRange: 5.5, respawnDelay: 8 },
    maxLegExposure: 7,
    ending: false,
    parTime: 300,
    fallback: { templateId: 'east-hall', faults: [3, 5, 10], tenant: -1, spawnIndex: 0 },
  },
  {
    id: 2,
    templates: ['ring'],
    defaultSeed: 2202,
    capacity: POWER.capacity,
    initialCircuits: [true, false, false],
    tutorial: false,
    faultRule: { tutorialFirst: false, minCircuits: 3, poweredBroken: 1 },
    tenant: 'none',
    tenantRecord: -1,
    repairRecords: { 2: 3 },
    tuning: { chaseSpeed: 2.7, detectRange: 6 },
    maxLegExposure: 8,
    ending: false,
    parTime: 300,
    fallback: { templateId: 'ring', faults: [4, 12, 10], tenant: -1, spawnIndex: 1 },
  },
  {
    id: 3,
    templates: ['east-hall', 'ring'],
    defaultSeed: 3303,
    capacity: POWER.capacity,
    initialCircuits: [true, false, false],
    tutorial: false,
    faultRule: { tutorialFirst: false, minCircuits: 2, poweredBroken: 1 },
    tenant: 'always',
    tenantRecord: 2,
    repairRecords: {},
    tuning: { chaseSpeed: 2.8 },
    maxLegExposure: 8,
    ending: false,
    parTime: 330,
    fallback: { templateId: 'east-hall', faults: [6, 2, 11], tenant: 1, spawnIndex: 1 },
  },
  {
    id: 4,
    templates: ['ring', 'east-hall'],
    defaultSeed: 4404,
    capacity: POWER.capacity,
    initialCircuits: [true, true, false],
    tutorial: false,
    faultRule: { tutorialFirst: false, minCircuits: 2, poweredBroken: 2 },
    tenant: 'always',
    tenantRecord: 4,
    repairRecords: {},
    tuning: { chaseSpeed: 2.9 },
    maxLegExposure: 8,
    ending: false,
    parTime: 330,
    fallback: { templateId: 'east-hall', faults: [6, 9, 1], tenant: 1, spawnIndex: 2 },
  },
  {
    id: 5,
    templates: ['long-wing'],
    defaultSeed: 5505,
    capacity: POWER.capacity,
    initialCircuits: [true, false, false],
    tutorial: false,
    faultRule: { tutorialFirst: false, minCircuits: 3, poweredBroken: 1 },
    tenant: 'none',
    tenantRecord: -1,
    repairRecords: { 2: 5 },
    tuning: { chaseSpeed: 3.0 },
    maxLegExposure: 9,
    ending: true,
    parTime: 360,
    fallback: { templateId: 'long-wing', faults: [9, 7, 8], tenant: -1, spawnIndex: 1 },
  },
];

/** Replay mode: same systems and validated combinations, fresh seeds. */
export const REPLAY: ShiftDef = {
  id: 0,
  templates: ['east-hall', 'ring', 'long-wing'],
  defaultSeed: 9009,
  capacity: POWER.capacity,
  initialCircuits: [true, false, false],
  tutorial: false,
  faultRule: { tutorialFirst: false, minCircuits: 2, poweredBroken: 1 },
  tenant: 0.5,
  tenantRecord: -1,
  repairRecords: {},
  tuning: { chaseSpeed: 2.95 },
  maxLegExposure: 9,
  ending: false,
  parTime: 330,
  fallback: { templateId: 'ring', faults: [4, 12, 10], tenant: -1, spawnIndex: 1 },
};

export function getShift(id: number): ShiftDef {
  if (id === 0) return REPLAY;
  const s = SHIFTS.find((d) => d.id === id);
  if (!s) throw new Error(`Unknown shift ${id}`);
  return s;
}

export function tuningFor(def: ShiftDef): CreatureTuning {
  return { ...CREATURE_DEFAULT, ...def.tuning };
}
