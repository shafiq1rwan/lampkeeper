// Shared types between simulation, presentation and orchestration.

export type CircuitId = 0 | 1 | 2;
export const CIRCUIT_COUNT = 3;

/** Per-step input in world space, produced by the input layer and converted from camera space by Game. */
export interface SimInput {
  moveX: number;
  moveZ: number;
  /** Action button currently held. */
  action: boolean;
}

export type InteractKind = 'repair' | 'switch' | 'help' | 'exit';

export type CreatureStateName =
  | 'inactive'
  | 'emerging'
  | 'patrol'
  | 'investigate'
  | 'warn'
  | 'chase'
  | 'retreat'
  | 'cooldown'
  | 'dissolving'
  | 'gone'
  | 'staged'
  | 'capturing';

export type CaptureCause = 'circuitOff' | 'broken' | 'unlit';

export type SimEvent =
  | { type: 'firstMove' }
  | { type: 'footstep' }
  | { type: 'repairStart'; fixture: number }
  | { type: 'repairCancel'; fixture: number }
  | { type: 'repairDone'; fixture: number; count: number }
  | { type: 'circuitOn'; circuit: CircuitId }
  | { type: 'circuitOffPending'; circuit: CircuitId }
  | { type: 'circuitOffCancelled'; circuit: CircuitId }
  | { type: 'circuitOff'; circuit: CircuitId }
  | { type: 'powerFull'; circuit: CircuitId }
  | { type: 'protectionChanged' }
  | { type: 'safeEnter' }
  | { type: 'safeExit' }
  | { type: 'creatureEmerge'; x: number; z: number }
  | { type: 'creatureWarn' }
  | { type: 'chaseStart' }
  | { type: 'chaseEnd' }
  | { type: 'creatureRetreat' }
  | { type: 'creatureDissolve' }
  | { type: 'creatureInvestigate'; x: number; z: number }
  | { type: 'stagedArrived' }
  | { type: 'stagedDone' }
  | { type: 'capture'; cause: CaptureCause; circuit: CircuitId | -1; room: boolean }
  | { type: 'exitUnlocked' }
  | { type: 'tenantHelped' }
  | { type: 'shiftComplete' };

export interface Vec2 {
  x: number;
  z: number;
}
