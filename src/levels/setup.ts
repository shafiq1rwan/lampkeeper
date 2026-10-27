import type { CreatureTuning } from '../game/config';

/** Everything gameplay-affecting about one run. Same setup ⇒ same starting conditions. */
export interface RunSetup {
  /** 1–5 for story shifts, 0 for replay. */
  shift: number;
  seed: number;
  templateId: string;
  /** Fixture ids that start broken and must be repaired. */
  faults: number[];
  /** Tenant spot id, or -1 for none. */
  tenant: number;
  /** Creature start cell; -1 = held back for the tutorial demonstration. */
  creatureSpawn: number;
  creatureSeed: number;
  initialCircuits: boolean[];
  capacity: number;
  tuning: CreatureTuning;
  tutorial: boolean;
  /** Record awarded for helping this run's tenant (-1 none). */
  tenantRecord: number;
  /** Repair-count → record id awarded after that repair. */
  repairRecords: Record<number, number>;
  ending: boolean;
  parTime: number;
  usedFallback: boolean;
  attempts: number;
}
