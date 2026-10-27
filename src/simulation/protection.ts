// The single protection model used by player safety, creature navigation, previews and floor footprints.

import type { CircuitId } from '../game/types';
import type { LevelData } from '../levels/LevelData';

export interface PowerState {
  on: readonly boolean[];
  pendingOff: readonly number[];
}

export class ProtectionMask {
  /** 1 = protected (a creature may not hunt here). */
  readonly mask: Uint8Array;
  /** 1 = protected only by circuits in their switch-off warning (visual warning layer). */
  readonly fading: Uint8Array;
  /** Bumped whenever the mask changes, so consumers can cache. */
  version = 0;

  constructor(private readonly level: LevelData) {
    this.mask = new Uint8Array(level.w * level.h);
    this.fading = new Uint8Array(level.w * level.h);
  }

  compute(power: PowerState, broken: Uint8Array, tenantCoverage: Int32Array | null): void {
    const { mask, fading, level } = this;
    mask.set(level.emergency);
    fading.fill(0);
    if (tenantCoverage) for (const c of tenantCoverage) mask[c] = 1;
    // Steady circuits first so a fading circuit only marks cells it alone protects.
    for (const f of level.fixtures) {
      if (broken[f.id] || !power.on[f.circuit] || power.pendingOff[f.circuit] > 0) continue;
      for (const c of f.coverage) mask[c] = 1;
    }
    for (const f of level.fixtures) {
      if (broken[f.id] || !power.on[f.circuit] || power.pendingOff[f.circuit] <= 0) continue;
      for (const c of f.coverage) {
        if (!mask[c]) {
          mask[c] = 1;
          fading[c] = 1;
        }
      }
    }
    this.version++;
  }

  isProtected(cell: number): boolean {
    return cell >= 0 && this.mask[cell] === 1;
  }
}

/** Compute a protection mask into `out` without a ProtectionMask instance (used by validation). */
export function computeMaskInto(
  level: LevelData,
  on: readonly boolean[],
  broken: Uint8Array,
  tenantCoverage: Int32Array | null,
  out: Uint8Array,
): Uint8Array {
  out.set(level.emergency);
  if (tenantCoverage) for (const c of tenantCoverage) out[c] = 1;
  for (const f of level.fixtures) {
    if (broken[f.id] || !on[f.circuit]) continue;
    for (const c of f.coverage) out[c] = 1;
  }
  return out;
}

/** Explain why a cell is dark: which circuit would have lit it, or whether its lamp was broken. */
export function darknessCause(
  level: LevelData,
  cell: number,
  on: readonly boolean[],
  broken: Uint8Array,
): { cause: 'circuitOff' | 'broken' | 'unlit'; circuit: CircuitId | -1 } {
  let brokenCircuit: CircuitId | -1 = -1;
  let offCircuit: CircuitId | -1 = -1;
  for (const f of level.fixtures) {
    if (!f.coverage.includes(cell)) continue;
    if (broken[f.id]) {
      if (brokenCircuit < 0) brokenCircuit = f.circuit;
    } else if (!on[f.circuit] && offCircuit < 0) offCircuit = f.circuit;
  }
  if (offCircuit >= 0) return { cause: 'circuitOff', circuit: offCircuit };
  if (brokenCircuit >= 0) return { cause: 'broken', circuit: brokenCircuit };
  return { cause: 'unlit', circuit: -1 };
}
