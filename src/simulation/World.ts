// Authoritative simulation of one run. Rendering, audio and UI only read from it.

import { Creature, type CreatureContext } from '../ai/Creature';
import { NavGrid } from '../ai/nav';
import { INTERACT, PLAYER } from '../game/config';
import type { CircuitId, InteractKind, SimEvent, SimInput } from '../game/types';
import { K, loadLevel, ZONE, type LevelData } from '../levels/LevelData';
import type { RunSetup } from '../levels/setup';
import { CircuitBoard } from './circuits';
import { resolveCircle, segmentClear } from './grid';
import { darknessCause, ProtectionMask } from './protection';
import { Rng } from './rng';

export const REQUIRED_REPAIRS = 3;

export interface Target {
  kind: InteractKind;
  /** fixture id, switch id, tenant id, or 0 for the exit */
  id: number;
  x: number;
  z: number;
  range: number;
  /** A solid cell the line-of-sight test may end in (door, exit). */
  solidCell: number;
  /** Stable ordering for tie-breaks. */
  order: number;
}

export class World {
  readonly level: LevelData;
  readonly circuits: CircuitBoard;
  readonly prot: ProtectionMask;
  readonly nav: NavGrid;
  readonly creature: Creature;
  readonly broken: Uint8Array;
  readonly targets: Target[] = [];
  readonly faultsRemaining: number[];

  px: number;
  pz: number;
  facing = Math.PI;
  /** Current player speed (for animation and footsteps). */
  pSpeed = 0;
  playerProtected = true;
  repairs = 0;
  exitUnlocked = false;
  complete = false;
  captured = false;
  tenantActive: boolean;
  tenantHelped = false;
  time = 0;
  /** Highlighted interaction target. */
  target: Target | null = null;
  repairing = false;
  repairProgress = 0;
  chases = 0;
  movedDistance = 0;

  private readonly events: SimEvent[] = [];
  private readonly ctx: CreatureContext;
  private readonly tenantCoverage: Int32Array | null;
  private prevAction = false;
  private holdConsumed = false;
  private lastPressTime = -10;
  private stepAccum = 0;
  private moved = false;
  private readonly tmp = { x: 0, z: 0 };
  private readonly solidPlayer: (c: number) => boolean;

  constructor(readonly setup: RunSetup) {
    const level = loadLevel(setup.templateId);
    this.level = level;
    this.circuits = new CircuitBoard(setup.capacity, setup.initialCircuits);
    this.prot = new ProtectionMask(level);
    this.nav = new NavGrid(level.w, level.h);
    this.broken = new Uint8Array(level.fixtures.length);
    for (const f of setup.faults) this.broken[f] = 1;
    this.faultsRemaining = setup.faults.slice();
    this.tenantActive = setup.tenant >= 0;
    this.tenantCoverage = this.tenantActive ? level.tenants[setup.tenant].coverage : null;
    this.px = level.startX;
    this.pz = level.startZ;
    this.solidPlayer = (c) => !level.walk[c];

    const emit = (e: SimEvent): void => {
      this.events.push(e);
    };
    this.ctx = {
      level,
      prot: this.prot,
      nav: this.nav,
      rng: new Rng(setup.creatureSeed),
      tuning: setup.tuning,
      playerX: this.px,
      playerZ: this.pz,
      playerProtected: true,
      faultCells: this.faultsRemaining.map((f) => level.fixtures[f].cell),
      emit,
    };
    this.creature = new Creature(this.ctx);
    this.buildTargets();
    this.prot.compute(this.circuits, this.broken, this.tenantCoverage);
    this.playerProtected = this.prot.isProtected(this.playerCell);
    if (setup.creatureSpawn >= 0) {
      // Begin with a short, harmless settle so the opening is never an ambush.
      this.creature.placeAt(setup.creatureSpawn, 'cooldown');
    }
  }

  get playerCell(): number {
    return Math.floor(this.pz) * this.level.w + Math.floor(this.px);
  }

  get active(): boolean {
    return !this.complete && !this.captured;
  }

  /** Take and clear the events produced since the last call. */
  drainEvents(out: SimEvent[]): SimEvent[] {
    out.length = 0;
    for (const e of this.events) out.push(e);
    this.events.length = 0;
    return out;
  }

  // ------------------------------------------------------------------ step

  step(dt: number, input: SimInput): void {
    if (!this.active) return;
    this.time += dt;

    const changed = this.circuits.update(dt);
    if (changed) {
      for (let c = 0; c < 3; c++) if (changed & (1 << c)) this.events.push({ type: 'circuitOff', circuit: c as CircuitId });
      this.recomputeProtection();
    }

    this.movePlayer(dt, input);
    this.updateSafety();
    this.updateInteraction(dt, input);

    this.ctx.playerX = this.px;
    this.ctx.playerZ = this.pz;
    this.ctx.playerProtected = this.playerProtected;
    const prevState = this.creature.state;
    if (this.creature.update(dt)) this.capturePlayer();
    if (this.creature.state === 'chase' && prevState !== 'chase') this.chases++;
  }

  private movePlayer(dt: number, input: SimInput): void {
    let mx = input.moveX;
    let mz = input.moveZ;
    const mag = Math.sqrt(mx * mx + mz * mz);
    if (mag > 1) {
      mx /= mag;
      mz /= mag;
    }
    if (mag < 0.08) {
      this.pSpeed = 0;
      return;
    }
    const speed = PLAYER.speed * (this.repairing ? PLAYER.repairMoveFactor : 1);
    const nx = this.px + mx * speed * dt;
    const nz = this.pz + mz * speed * dt;
    resolveCircle(this.level, this.solidPlayer, nx, nz, PLAYER.radius, this.tmp);
    const dx = this.tmp.x - this.px;
    const dz = this.tmp.z - this.pz;
    const d = Math.sqrt(dx * dx + dz * dz);
    this.px = this.tmp.x;
    this.pz = this.tmp.z;
    this.pSpeed = d / dt;
    if (!this.repairing) this.facing = Math.atan2(mx, mz);
    this.movedDistance += d;
    if (!this.moved && this.movedDistance > 0.5) {
      this.moved = true;
      this.events.push({ type: 'firstMove' });
    }
    this.stepAccum += d;
    if (this.stepAccum >= PLAYER.stepDistance) {
      this.stepAccum = 0;
      this.events.push({ type: 'footstep' });
    }
  }

  private updateSafety(): void {
    const safe = this.prot.isProtected(this.playerCell);
    if (safe !== this.playerProtected) {
      this.playerProtected = safe;
      this.events.push({ type: safe ? 'safeEnter' : 'safeExit' });
    }
  }

  // ------------------------------------------------------------ interaction

  private buildTargets(): void {
    const { level, setup } = this;
    const w = level.w;
    let order = 0;
    for (const f of setup.faults) {
      const fx = level.fixtures[f];
      this.targets.push({ kind: 'repair', id: f, x: fx.cx + 0.5, z: fx.cz + 0.5, range: INTERACT.repairRange, solidCell: -1, order: order++ });
    }
    for (const s of level.switches) {
      this.targets.push({ kind: 'switch', id: s.id, x: s.cx + 0.5, z: s.cz + 0.5, range: INTERACT.switchRange, solidCell: -1, order: order++ });
    }
    if (setup.tenant >= 0) {
      const t = level.tenants[setup.tenant];
      const x = (t.porchCell % w) + 0.5;
      const z = Math.floor(t.porchCell / w) + 0.5;
      const dx = (t.doorCell % w) + 0.5 - x;
      const dz = Math.floor(t.doorCell / w) + 0.5 - z;
      this.targets.push({ kind: 'help', id: t.id, x: x + dx * 0.3, z: z + dz * 0.3, range: INTERACT.helpRange, solidCell: -1, order: order++ });
    }
    // Exit interaction point sits just inside the landing edge of the exit door.
    let ex = level.exitX;
    let ez = level.exitZ;
    const landing = level.landingCells.find((c) => level.exitCells.some((e) => e === c + 1 || e === c - 1 || e === c + w || e === c - w));
    if (landing !== undefined) {
      const lx = (landing % w) + 0.5;
      const lz = Math.floor(landing / w) + 0.5;
      const ddx = Math.sign(lx - ex) * (Math.abs(lx - ex) > 0.6 ? 1 : 0);
      const ddz = Math.sign(lz - ez) * (Math.abs(lz - ez) > 0.6 ? 1 : 0);
      ex += ddx * 0.52;
      ez += ddz * 0.52;
    }
    this.targets.push({ kind: 'exit', id: 0, x: ex, z: ez, range: INTERACT.exitRange, solidCell: level.exitCells[0] ?? -1, order: order++ });
  }

  isEligible(t: Target): boolean {
    switch (t.kind) {
      case 'repair':
        return this.broken[t.id] === 1;
      case 'switch':
        return true;
      case 'help':
        return this.tenantActive && !this.tenantHelped;
      case 'exit':
        return this.exitUnlocked;
    }
  }

  private inReach(t: Target, extra = 0): boolean {
    const dx = t.x - this.px;
    const dz = t.z - this.pz;
    const r = t.range + extra;
    if (dx * dx + dz * dz > r * r) return false;
    return segmentClear(this.level, this.level.blockSight, this.px, this.pz, t.x, t.z, t.solidCell);
  }

  /** Deterministic target choice: eligible, in range, unobstructed, nearest, stable tie-break. */
  findTarget(): Target | null {
    let best: Target | null = null;
    let bestD = Infinity;
    for (const t of this.targets) {
      if (!this.isEligible(t) || !this.inReach(t)) continue;
      const d = Math.hypot(t.x - this.px, t.z - this.pz);
      if (d < bestD - 1e-6 || (Math.abs(d - bestD) <= 1e-6 && best && t.order < best.order)) {
        best = t;
        bestD = d;
      }
    }
    const cur = this.target;
    if (best && cur && best !== cur && this.isEligible(cur) && this.inReach(cur)) {
      const dc = Math.hypot(cur.x - this.px, cur.z - this.pz);
      if (dc <= bestD + INTERACT.hysteresis) return cur;
    }
    return best;
  }

  private updateInteraction(dt: number, input: SimInput): void {
    const pressed = input.action && !this.prevAction;
    this.prevAction = input.action;
    if (!input.action) this.holdConsumed = false;

    if (this.repairing) {
      const t = this.target!;
      if (!input.action || !this.isEligible(t) || !this.inReach(t, INTERACT.holdRangeGrace)) {
        this.repairing = false;
        this.repairProgress = 0;
        this.events.push({ type: 'repairCancel', fixture: t.id });
      } else {
        this.repairProgress += dt / INTERACT.repairTime;
        if (this.repairProgress >= 1) this.completeRepair(t);
        return;
      }
    }

    this.target = this.findTarget();
    const t = this.target;
    if (!t || !input.action || this.holdConsumed) return;
    if (t.kind === 'repair') {
      this.repairing = true;
      this.repairProgress = 0;
      this.events.push({ type: 'repairStart', fixture: t.id });
      return;
    }
    if (!pressed || this.time - this.lastPressTime < INTERACT.pressDebounce) return;
    this.lastPressTime = this.time;
    this.holdConsumed = true;
    if (t.kind === 'switch') this.toggleCircuit(this.level.switches[t.id].circuit);
    else if (t.kind === 'help') {
      this.tenantHelped = true;
      this.events.push({ type: 'tenantHelped' });
    } else if (t.kind === 'exit') {
      this.complete = true;
      this.target = null;
      this.events.push({ type: 'shiftComplete' });
    }
  }

  private completeRepair(t: Target): void {
    this.repairing = false;
    this.repairProgress = 0;
    this.holdConsumed = true;
    this.broken[t.id] = 0;
    const idx = this.faultsRemaining.indexOf(t.id);
    if (idx >= 0) this.faultsRemaining.splice(idx, 1);
    this.ctx.faultCells = this.faultsRemaining.map((f) => this.level.fixtures[f].cell);
    this.repairs++;
    this.recomputeProtection();
    this.events.push({ type: 'repairDone', fixture: t.id, count: this.repairs });
    this.creature.hearNoise(t.x, t.z);
    if (this.repairs >= REQUIRED_REPAIRS && !this.exitUnlocked) {
      this.exitUnlocked = true;
      this.events.push({ type: 'exitUnlocked' });
    }
    this.target = this.findTarget();
  }

  /** Toggle a circuit as if its switch were operated. Public for tests and tooling. */
  toggleCircuit(c: CircuitId): void {
    const r = this.circuits.toggle(c);
    if (r === 'full') {
      this.events.push({ type: 'powerFull', circuit: c });
      return;
    }
    this.recomputeProtection();
    this.events.push({ type: r === 'on' ? 'circuitOn' : r === 'offPending' ? 'circuitOffPending' : 'circuitOffCancelled', circuit: c });
  }

  private recomputeProtection(): void {
    this.prot.compute(this.circuits, this.broken, this.tenantCoverage);
    this.creature.onProtectionChanged();
    this.updateSafety();
    this.ctx.playerProtected = this.playerProtected;
    this.events.push({ type: 'protectionChanged' });
  }

  private capturePlayer(): void {
    this.captured = true;
    this.repairing = false;
    const cell = this.playerCell;
    const why = darknessCause(this.level, cell, this.circuits.on, this.broken);
    this.events.push({ type: 'capture', cause: why.cause, circuit: why.circuit, room: this.level.kind[cell] === K.Room });
  }

  // ------------------------------------------------------------ tutorial

  /** Staged, harmless demonstration: the creature appears in view and stops at the light. */
  startStagedDemo(): boolean {
    if (this.creature.state !== 'inactive') return false;
    const { level } = this;
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < level.w * level.h; i++) {
      if (!level.walk[i] || this.prot.mask[i] || level.zone[i] !== ZONE.None) continue;
      const x = (i % level.w) + 0.5;
      const z = Math.floor(i / level.w) + 0.5;
      const d = Math.hypot(x - this.px, z - this.pz);
      if (d < 5 || d > 11) continue;
      const visible = segmentClear(level, level.blockSight, x, z, this.px, this.pz);
      const corridor = level.kind[i] === K.Corridor;
      const score = (visible ? 10 : 0) + (corridor ? 3 : 0) - Math.abs(d - 7.5);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) {
      this.activateCreature();
      return false;
    }
    this.creature.beginStaged(best);
    return true;
  }

  /** Bring the creature into normal play via a telegraphed spawn (skip-tutorial path). */
  activateCreature(delay = 3): void {
    if (this.creature.state !== 'inactive') return;
    this.creature.state = 'gone';
    this.creature.respawnTimer = delay;
  }

  /** Development/testing helper: place the player directly (never used by normal play). */
  debugTeleport(x: number, z: number): void {
    this.px = x;
    this.pz = z;
    this.updateSafety();
  }
}
