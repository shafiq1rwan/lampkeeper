// Development/test autopilot that plays the real simulation using only legal inputs.
// Used by automated playthrough tests and browser smoke checks; never bundled in release play.

import { NavGrid } from '../ai/nav';
import { CIRCUIT_COUNT, type CircuitId, type SimInput } from '../game/types';
import { computeMaskInto } from '../simulation/protection';
import type { World } from '../simulation/World';

interface Objective {
  kind: 'repair' | 'help' | 'exit';
  id: number;
  cell: number;
}

export class Bot {
  /** What the bot is doing (for logs). */
  status = '';
  helpTenant = true;
  private readonly nav: NavGrid;
  private readonly path = new Int32Array(2048);
  private pathLen = 0;
  private pathIdx = 0;
  private pathGoal = -1;
  private replan = 0;
  private desiredCfg = -1;
  private planFor = '';
  private pressHeld = false;
  private waitTime = 0;
  private readonly input: SimInput = { moveX: 0, moveZ: 0, action: false };

  constructor(readonly world: World) {
    this.nav = new NavGrid(world.level.w, world.level.h);
  }

  decide(dt: number): SimInput {
    const w = this.world;
    const inp = this.input;
    inp.moveX = 0;
    inp.moveZ = 0;
    inp.action = false;
    if (!w.active) return inp;
    const cr = w.creature;
    const cd = Math.hypot(cr.x - w.px, cr.z - w.pz);
    const alert = cr.present && (cr.state === 'warn' || cr.state === 'chase');

    if (alert && !w.playerProtected) {
      this.status = 'flee';
      this.flee();
      return inp;
    }
    if (w.playerProtected && alert) {
      this.status = 'hold in light';
      this.flee();
      return inp;
    }
    if (w.playerProtected && cr.present && cd < 4.5 && cr.state !== 'retreat' && cr.state !== 'dissolving') {
      this.status = 'wait in light';
      this.waitTime += dt;
      if (this.waitTime < 12) return inp;
    } else this.waitTime = 0;

    const obj = this.nextObjective();
    if (!obj) return inp;
    const key = `${obj.kind}:${obj.id}:${w.repairs}`;
    if (key !== this.planFor) {
      this.planFor = key;
      this.desiredCfg = this.choosePower(obj.cell);
    }

    // Power changes first, at the nearest breaker panel.
    const cur = this.currentCfg();
    if (this.desiredCfg >= 0 && cur !== this.desiredCfg) {
      const need = this.nextToggle(cur);
      if (need >= 0) {
        const sw = this.nearestSwitch(need);
        this.status = `switch ${'ABC'[need]}`;
        if (w.target && w.target.kind === 'switch' && w.level.switches[w.target.id].circuit === need) {
          this.press(inp);
        } else {
          this.goTo(sw, dt, false);
        }
        return inp;
      }
      // Waiting for a pending switch-off to finish.
      this.status = 'wait for power';
      return inp;
    }

    this.status = `${obj.kind} ${obj.id}`;
    const t = w.target;
    if (t && t.kind === obj.kind && t.id === obj.id) {
      if (obj.kind === 'repair') inp.action = true;
      else this.press(inp);
      return inp;
    }
    this.pressHeld = false;
    this.goTo(obj.cell, dt, obj.kind === 'exit');
    return inp;
  }

  private press(inp: SimInput): void {
    // Alternate press/release so each press is a fresh edge.
    this.pressHeld = !this.pressHeld;
    inp.action = this.pressHeld;
  }

  private currentCfg(): number {
    let m = 0;
    for (let c = 0; c < CIRCUIT_COUNT; c++) if (this.world.circuits.on[c] && !this.world.circuits.isPending(c as CircuitId)) m |= 1 << c;
    return m;
  }

  private nextToggle(cur: number): number {
    const b = this.world.circuits;
    for (let c = 0; c < CIRCUIT_COUNT; c++) {
      if (cur & (1 << c) && !(this.desiredCfg & (1 << c))) return c;
    }
    for (let c = 0; c < CIRCUIT_COUNT; c++) {
      if (!(cur & (1 << c)) && this.desiredCfg & (1 << c)) {
        if (b.used() >= b.capacity) return -1;
        return c;
      }
    }
    return -1;
  }

  private nextObjective(): Objective | null {
    const w = this.world;
    const lvl = w.level;
    if (w.faultsRemaining.length > 0) {
      // Nearest remaining fault by walking distance.
      this.nav.flood(w.playerCell, (c) => (lvl.walk[c] ? 0 : -1));
      let best: Objective | null = null;
      let bd = Infinity;
      for (const f of w.faultsRemaining) {
        const cell = lvl.fixtures[f].cell;
        if (this.nav.dist[cell] < bd) {
          bd = this.nav.dist[cell];
          best = { kind: 'repair', id: f, cell };
        }
      }
      return best;
    }
    if (this.helpTenant && w.tenantActive && !w.tenantHelped) {
      return { kind: 'help', id: w.setup.tenant, cell: lvl.tenants[w.setup.tenant].porchCell };
    }
    const landing = lvl.landingCells.find((c) => lvl.exitCells.some((e) => Math.abs(e - c) === 1 || Math.abs(e - c) === lvl.w));
    return { kind: 'exit', id: 0, cell: landing ?? lvl.landingCells[0] };
  }

  /** Choose the circuit allocation that minimises unlit exposure on the way to `goal`. */
  private choosePower(goal: number): number {
    const w = this.world;
    const lvl = w.level;
    const n = lvl.w * lvl.h;
    const mask = new Uint8Array(n);
    let best = this.currentCfg();
    let bestScore = Infinity;
    for (let cfg = 0; cfg < 1 << CIRCUIT_COUNT; cfg++) {
      let bits = 0;
      for (let c = 0; c < CIRCUIT_COUNT; c++) if (cfg & (1 << c)) bits++;
      if (bits > w.circuits.capacity) continue;
      const on = [0, 1, 2].map((c) => (cfg & (1 << c)) !== 0);
      computeMaskInto(lvl, on, w.broken, null, mask);
      // From the nearest panel (or here, if no change is needed) to the goal.
      const from = cfg === this.currentCfg() ? w.playerCell : this.nearestPanelCell();
      this.nav.flood(from, (c) => (lvl.walk[c] ? (mask[c] ? 0 : 1) : -1), Infinity, undefined, 0.01);
      const score = this.nav.dist[goal] + (cfg === this.currentCfg() ? 0 : 1.5);
      if (score < bestScore) {
        bestScore = score;
        best = cfg;
      }
    }
    return best;
  }

  private nearestPanelCell(): number {
    const w = this.world;
    this.nav.flood(w.playerCell, (c) => (w.level.walk[c] ? 0 : -1));
    let best = w.level.switches[0].cell;
    let bd = Infinity;
    for (const s of w.level.switches) {
      if (this.nav.dist[s.cell] < bd) {
        bd = this.nav.dist[s.cell];
        best = s.cell;
      }
    }
    return best;
  }

  private nearestSwitch(circuit: number): number {
    const w = this.world;
    this.nav.flood(w.playerCell, (c) => (w.level.walk[c] ? 0 : -1));
    let best = -1;
    let bd = Infinity;
    for (const s of w.level.switches) {
      if (s.circuit !== circuit) continue;
      if (this.nav.dist[s.cell] < bd) {
        bd = this.nav.dist[s.cell];
        best = s.cell;
      }
    }
    return best;
  }

  private flee(): void {
    const w = this.world;
    const lvl = w.level;
    const cr = w.creature;
    const goal = this.nav.flood(
      w.playerCell,
      (c) => {
        if (!lvl.walk[c]) return -1;
        const d = Math.hypot((c % lvl.w) + 0.5 - cr.x, Math.floor(c / lvl.w) + 0.5 - cr.z);
        return d < 2.5 ? 6 : 0;
      },
      Infinity,
      (c) => this.deepLight(c),
    );
    if (goal < 0) return;
    this.pathLen = this.nav.pathTo(goal, this.path);
    this.pathIdx = 0;
    this.pathGoal = -2;
    this.steer();
  }

  /** A protected cell whose neighbours are all protected (away from the boundary). */
  private deepLight(c: number): boolean {
    const m = this.world.prot.mask;
    const lw = this.world.level.w;
    const walk = this.world.level.walk;
    if (!m[c]) return false;
    for (const nb of [c - 1, c + 1, c - lw, c + lw]) if (walk[nb] && !m[nb]) return false;
    return true;
  }

  private goTo(cell: number, dt: number, exactCell: boolean): void {
    const w = this.world;
    const lvl = w.level;
    this.replan -= dt;
    if (cell !== this.pathGoal || this.replan <= 0) {
      this.replan = 0.5;
      this.pathGoal = cell;
      this.nav.flood(w.playerCell, (c) => (lvl.walk[c] ? (w.prot.mask[c] ? 0 : 2) : -1));
      this.pathLen = this.nav.pathTo(cell, this.path);
      this.pathIdx = 0;
    }
    if (this.pathLen === 0 || (this.pathIdx >= this.pathLen && !exactCell)) {
      const x = (cell % lvl.w) + 0.5;
      const z = Math.floor(cell / lvl.w) + 0.5;
      this.steerTo(x, z);
      return;
    }
    this.steer();
  }

  private steer(): void {
    const w = this.world;
    const lvl = w.level;
    while (this.pathIdx < this.pathLen) {
      const c = this.path[this.pathIdx];
      const x = (c % lvl.w) + 0.5;
      const z = Math.floor(c / lvl.w) + 0.5;
      if (Math.hypot(x - w.px, z - w.pz) < 0.25) {
        this.pathIdx++;
        continue;
      }
      this.steerTo(x, z);
      return;
    }
  }

  private steerTo(x: number, z: number): void {
    const w = this.world;
    const dx = x - w.px;
    const dz = z - w.pz;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    this.input.moveX = dx / d;
    this.input.moveZ = dz / d;
  }
}
