// Circuit allocation with a hard capacity and a visible switch-off warning.

import { POWER } from '../game/config';
import { CIRCUIT_COUNT, type CircuitId } from '../game/types';

export type ToggleResult = 'on' | 'offPending' | 'offCancelled' | 'full';

export class CircuitBoard {
  readonly capacity: number;
  /** Circuit is drawing power (includes circuits in their switch-off warning). */
  readonly on: boolean[] = [false, false, false];
  /** Seconds remaining before a switched-off circuit actually loses power; 0 = not pending. */
  readonly pendingOff: number[] = [0, 0, 0];

  constructor(capacity = POWER.capacity, initial: readonly boolean[] = [true, false, false]) {
    this.capacity = Math.max(1, Math.min(CIRCUIT_COUNT, capacity));
    let used = 0;
    for (let i = 0; i < CIRCUIT_COUNT; i++) {
      if (initial[i] && used < this.capacity) {
        this.on[i] = true;
        used++;
      }
    }
  }

  used(): number {
    let n = 0;
    for (let i = 0; i < CIRCUIT_COUNT; i++) if (this.on[i]) n++;
    return n;
  }

  isPending(c: CircuitId): boolean {
    return this.pendingOff[c] > 0;
  }

  /**
   * Toggle a circuit. Turning on never exceeds capacity and never silently disables another
   * circuit; a pending switch-off still counts against capacity until it completes.
   */
  toggle(c: CircuitId): ToggleResult {
    if (this.on[c]) {
      if (this.pendingOff[c] > 0) {
        this.pendingOff[c] = 0;
        return 'offCancelled';
      }
      this.pendingOff[c] = POWER.offWarning;
      return 'offPending';
    }
    if (this.used() >= this.capacity) return 'full';
    this.on[c] = true;
    return 'on';
  }

  /** Advance pending switch-offs. Returns a bitmask of circuits that just lost power. */
  update(dt: number): number {
    let changed = 0;
    for (let i = 0; i < CIRCUIT_COUNT; i++) {
      if (this.pendingOff[i] > 0) {
        this.pendingOff[i] -= dt;
        if (this.pendingOff[i] <= 0) {
          this.pendingOff[i] = 0;
          this.on[i] = false;
          changed |= 1 << i;
        }
      }
    }
    return changed;
  }
}
