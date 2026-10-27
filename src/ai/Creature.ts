// The shadow creature: an explicit state machine over the shared, light-aware navigation grid.

import type { CreatureTuning } from '../game/config';
import type { CreatureStateName, SimEvent } from '../game/types';
import { K, ZONE, type LevelData } from '../levels/LevelData';
import { circleOverlaps, resolveCircle, segmentClear } from '../simulation/grid';
import type { ProtectionMask } from '../simulation/protection';
import type { Rng } from '../simulation/rng';
import type { NavGrid } from './nav';

export interface CreatureContext {
  level: LevelData;
  prot: ProtectionMask;
  nav: NavGrid;
  rng: Rng;
  tuning: CreatureTuning;
  playerX: number;
  playerZ: number;
  playerProtected: boolean;
  /** Cells of unrepaired faults; the creature tends to linger near broken lamps. */
  faultCells: readonly number[];
  emit(e: SimEvent): void;
}

type StagedPhase = 'approach' | 'watch' | 'leave';

const ACTIVE_STATES: ReadonlySet<CreatureStateName> = new Set([
  'patrol',
  'investigate',
  'warn',
  'chase',
  'cooldown',
  'staged',
]);

export class Creature {
  x = 0;
  z = 0;
  facing = 0;
  state: CreatureStateName = 'inactive';
  /** Seconds in the current state. */
  t = 0;
  /** Current horizontal speed (for animation). */
  speed = 0;
  captureTimer = 0;
  respawnTimer = 0;
  stagedPhase: StagedPhase = 'approach';
  /** Diagnostics: number of retreats and dissolves this run. */
  retreats = 0;
  dissolves = 0;

  private readonly path = new Int32Array(1024);
  private pathLen = 0;
  private pathIdx = 0;
  private repathTimer = 0;
  private lastSeenX = 0;
  private lastSeenZ = 0;
  private unseenTime = 0;
  private safeTime = 0;
  private targetX = 0;
  private targetZ = 0;
  private idleTime = 0;
  private stuckTime = 0;
  /** After giving up at a light boundary it wanders off and only notices very close players. */
  private disinterest = 0;
  private pocketCheck = 0;
  private trapped = 0;
  private readonly tmp = { x: 0, z: 0 };
  private readonly solidHunting: (c: number) => boolean;
  private readonly solidWalls: (c: number) => boolean;
  private readonly costDark: (c: number) => number;
  private readonly costAny: (c: number) => number;

  constructor(private readonly ctx: CreatureContext) {
    const { level, prot } = ctx;
    this.solidHunting = (c) => !level.walk[c] || prot.mask[c] === 1;
    this.solidWalls = (c) => !level.walk[c];
    this.costDark = (c) => (level.walk[c] && prot.mask[c] === 0 ? 0 : -1);
    this.costAny = (c) => (level.walk[c] ? 0 : -1);
  }

  get tuning(): CreatureTuning {
    return this.ctx.tuning;
  }

  get cell(): number {
    return Math.floor(this.z) * this.ctx.level.w + Math.floor(this.x);
  }

  /** Present and able to act on the world (used for presentation and fairness checks). */
  get present(): boolean {
    return this.state !== 'inactive' && this.state !== 'gone';
  }

  get hostile(): boolean {
    return this.state === 'chase';
  }

  placeAt(cell: number, state: CreatureStateName): void {
    const w = this.ctx.level.w;
    this.x = (cell % w) + 0.5;
    this.z = Math.floor(cell / w) + 0.5;
    this.setState(state);
  }

  /** Start present at a spawn cell (normal shifts). */
  spawnAt(cell: number): void {
    this.placeAt(cell, 'emerging');
    this.ctx.emit({ type: 'creatureEmerge', x: this.x, z: this.z });
  }

  /** Begin the harmless tutorial demonstration from a dark cell the player can see. */
  beginStaged(cell: number): void {
    this.placeAt(cell, 'staged');
    this.stagedPhase = 'approach';
    this.repathTimer = 0;
    this.ctx.emit({ type: 'creatureEmerge', x: this.x, z: this.z });
  }

  /** Called whenever the protection mask changes. Enforces exclusion and retreat. */
  onProtectionChanged(): void {
    this.repathTimer = 0;
    if (this.state === 'emerging' && this.insideProtection()) {
      this.dissolve();
      return;
    }
    if (!ACTIVE_STATES.has(this.state) && this.state !== 'retreat') return;
    if (this.insideProtection()) {
      this.captureTimer = 0;
      if (this.state !== 'retreat') {
        this.retreats++;
        this.ctx.emit({ type: 'creatureRetreat' });
      }
      if (this.state === 'chase' || this.state === 'warn') this.ctx.emit({ type: 'chaseEnd' });
      this.beginRetreat();
    }
  }

  /** Advance one fixed step. Returns true when this step completes a capture. */
  update(dt: number): boolean {
    const c = this.ctx;
    this.t += dt;
    this.speed = 0;
    if (this.disinterest > 0) this.disinterest -= dt;
    if (this.state === 'patrol' || this.state === 'investigate' || this.state === 'cooldown') {
      this.pocketCheck -= dt;
      if (this.pocketCheck <= 0) {
        this.pocketCheck = 1;
        this.trapped = this.pocketSize(this.cell) < c.tuning.pocketMin ? this.trapped + 1 : 0;
        if (this.trapped >= c.tuning.trapTime) {
          this.trapped = 0;
          this.dissolve();
          return false;
        }
      }
    } else this.trapped = 0;
    switch (this.state) {
      case 'inactive':
      case 'capturing':
        return false;
      case 'gone':
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0) {
          const cell = this.chooseSpawn();
          if (cell >= 0) this.spawnAt(cell);
          else this.respawnTimer = 1;
        }
        return false;
      case 'emerging':
        if (this.t >= c.tuning.emergeTime) this.startPatrol();
        return false;
      case 'dissolving':
        if (this.t >= c.tuning.dissolveTime) {
          this.setState('gone');
          this.respawnTimer = c.tuning.respawnDelay;
        }
        return false;
      case 'cooldown':
        if (this.t >= c.tuning.cooldownTime) {
          if (this.disinterest > 0) {
            this.setState('patrol');
            this.pickFarTarget();
          } else this.startPatrol();
        }
        return false;
      case 'patrol':
        if (this.canDetect()) return this.startWarn();
        if (this.idleTime > 0) {
          this.idleTime -= dt;
          if (this.idleTime <= 0) this.pickPatrolTarget();
          return false;
        }
        if (this.followPath(c.tuning.patrolSpeed, dt, false)) this.idleTime = c.rng.range(0.6, 1.6);
        return false;
      case 'investigate':
        if (this.canDetect()) return this.startWarn();
        if (this.pathIdx < this.pathLen) {
          this.followPath(c.tuning.patrolSpeed * 1.25, dt, false);
          this.idleTime = 0;
        } else {
          this.idleTime += dt;
          this.facing += dt * 1.6;
          if (this.idleTime >= c.tuning.investigateLookTime) this.startPatrol();
        }
        return false;
      case 'warn':
        this.face(c.playerX, c.playerZ);
        if (this.t >= c.tuning.warnTime) {
          this.setState('chase');
          this.unseenTime = 0;
          this.safeTime = 0;
          this.captureTimer = 0;
          c.emit({ type: 'chaseStart' });
        }
        return false;
      case 'chase':
        return this.updateChase(dt);
      case 'retreat':
        this.followPath(c.tuning.retreatSpeed, dt, true);
        if (!this.insideProtection() && !circleOverlaps(c.level, this.solidHunting, this.x, this.z, c.tuning.radius)) {
          this.setState('cooldown');
        } else if (this.pathIdx >= this.pathLen && this.t > 0.25) {
          this.beginRetreat();
        }
        return false;
      case 'staged':
        this.updateStaged(dt);
        return false;
    }
  }

  // ---------------------------------------------------------------- states

  private setState(s: CreatureStateName): void {
    this.state = s;
    this.t = 0;
    this.idleTime = 0;
    this.stuckTime = 0;
  }

  private startWarn(): boolean {
    this.setState('warn');
    this.lastSeenX = this.ctx.playerX;
    this.lastSeenZ = this.ctx.playerZ;
    this.ctx.emit({ type: 'creatureWarn' });
    return false;
  }

  private startPatrol(): void {
    this.setState('patrol');
    this.pickPatrolTarget();
  }

  private dissolve(): void {
    this.setState('dissolving');
    this.captureTimer = 0;
    this.pathLen = 0;
    this.dissolves++;
    this.ctx.emit({ type: 'creatureDissolve' });
  }

  /** Repair noise: walk to the nearest dark cell beside the sound. No lasting knowledge. */
  hearNoise(x: number, z: number): void {
    if (this.state !== 'patrol' && this.state !== 'cooldown') return;
    const dx = x - this.x;
    const dz = z - this.z;
    if (dx * dx + dz * dz > this.ctx.tuning.hearingRange ** 2) return;
    this.setState('investigate');
    this.goNear(x, z);
    this.ctx.emit({ type: 'creatureInvestigate', x: this.targetX, z: this.targetZ });
  }

  private updateChase(dt: number): boolean {
    const c = this.ctx;
    const dx = c.playerX - this.x;
    const dz = c.playerZ - this.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const los = segmentClear(c.level, c.level.blockSight, this.x, this.z, c.playerX, c.playerZ);
    const sees = los && dist <= c.tuning.detectRange + 3;
    if (sees && !c.playerProtected) {
      this.lastSeenX = c.playerX;
      this.lastSeenZ = c.playerZ;
      this.unseenTime = 0;
    } else {
      this.unseenTime += dt;
    }
    this.safeTime = c.playerProtected ? this.safeTime + dt : 0;

    if (this.safeTime >= c.tuning.lurkTime) {
      c.emit({ type: 'chaseEnd' });
      this.setState('cooldown');
      this.disinterest = c.tuning.disinterestTime;
      return false;
    }
    if (!c.playerProtected && this.unseenTime >= c.tuning.loseSightTime) {
      c.emit({ type: 'chaseEnd' });
      this.setState('investigate');
      this.goNear(this.lastSeenX, this.lastSeenZ);
      return false;
    }

    if (sees && !c.playerProtected && dist < 2.5) {
      this.moveToward(c.playerX, c.playerZ, c.tuning.chaseSpeed, dt, false);
    } else {
      this.repathTimer -= dt;
      if (this.repathTimer <= 0) {
        this.repathTimer = c.tuning.repathInterval;
        const tx = this.unseenTime > 0 ? this.lastSeenX : c.playerX;
        const tz = this.unseenTime > 0 ? this.lastSeenZ : c.playerZ;
        this.goNear(tx, tz);
      }
      this.followPath(c.tuning.chaseSpeed, dt, false);
    }

    // Capture: close contact, line of sight, unprotected player, sustained for a short reaction window.
    if (!c.playerProtected && los && dist <= c.tuning.captureRange) {
      this.captureTimer += dt;
      if (this.captureTimer >= c.tuning.captureGrace) {
        this.setState('capturing');
        return true;
      }
    } else {
      this.captureTimer = Math.max(0, this.captureTimer - dt * 2);
    }
    return false;
  }

  private updateStaged(dt: number): void {
    const c = this.ctx;
    if (this.t < c.tuning.emergeTime) return;
    const dx = c.playerX - this.x;
    const dz = c.playerZ - this.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (this.stagedPhase === 'approach') {
      this.repathTimer -= dt;
      if (this.repathTimer <= 0) {
        this.repathTimer = 0.5;
        this.goNear(c.playerX, c.playerZ);
      }
      const arrived = this.followPath(c.tuning.patrolSpeed * 1.1, dt, false);
      if (arrived || dist < 2.2 || this.t > c.tuning.emergeTime + 8) {
        this.stagedPhase = 'watch';
        this.t = c.tuning.emergeTime;
        c.emit({ type: 'stagedArrived' });
      }
    } else if (this.stagedPhase === 'watch') {
      this.face(c.playerX, c.playerZ);
      if (this.t >= c.tuning.emergeTime + 3.2) {
        this.stagedPhase = 'leave';
        this.t = c.tuning.emergeTime;
        this.pickFarTarget();
      }
    } else {
      const arrived = this.followPath(c.tuning.patrolSpeed, dt, false);
      if (arrived || this.t > c.tuning.emergeTime + 2.5) {
        c.emit({ type: 'stagedDone' });
        this.dissolve();
      }
    }
  }

  // ---------------------------------------------------------------- perception

  private canDetect(): boolean {
    const c = this.ctx;
    if (c.playerProtected) return false;
    const dx = c.playerX - this.x;
    const dz = c.playerZ - this.z;
    const range = this.disinterest > 0 ? 2.2 : c.tuning.detectRange;
    if (dx * dx + dz * dz > range * range) return false;
    return segmentClear(c.level, c.level.blockSight, this.x, this.z, c.playerX, c.playerZ);
  }

  /** Count reachable dark cells from `cell`, stopping once the count reaches pocketMin. */
  private pocketSize(cell: number): number {
    const c = this.ctx;
    const limit = c.tuning.pocketMin;
    let count = 0;
    c.nav.flood(cell, this.costDark, Infinity, () => ++count >= limit);
    return count;
  }

  insideProtection(): boolean {
    return this.ctx.prot.isProtected(this.cell);
  }

  // ---------------------------------------------------------------- navigation

  private beginRetreat(): void {
    const c = this.ctx;
    this.setState('retreat');
    const goal = c.nav.flood(this.cell, this.costAny, 60, (cell) => c.prot.mask[cell] === 0 && c.level.walk[cell] === 1);
    if (goal < 0) {
      this.dissolve();
      return;
    }
    this.pathLen = c.nav.pathTo(goal, this.path);
    this.pathIdx = 0;
  }

  /** Path to the reachable dark cell closest to (x, z). */
  private goNear(x: number, z: number): void {
    const c = this.ctx;
    const { level, nav } = c;
    nav.flood(this.cell, this.costDark, 80);
    let best = -1;
    let bestScore = Infinity;
    const r = 6;
    const x0 = Math.max(0, Math.floor(x) - r);
    const x1 = Math.min(level.w - 1, Math.floor(x) + r);
    const z0 = Math.max(0, Math.floor(z) - r);
    const z1 = Math.min(level.h - 1, Math.floor(z) + r);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const cell = cz * level.w + cx;
        if (!nav.reached(cell)) continue;
        const ddx = cx + 0.5 - x;
        const ddz = cz + 0.5 - z;
        const score = ddx * ddx + ddz * ddz + nav.dist[cell] * 0.01;
        if (score < bestScore) {
          bestScore = score;
          best = cell;
        }
      }
    }
    if (best < 0) best = this.cell;
    this.targetX = (best % level.w) + 0.5;
    this.targetZ = Math.floor(best / level.w) + 0.5;
    this.pathLen = nav.pathTo(best, this.path);
    this.pathIdx = 0;
  }

  private pickPatrolTarget(): void {
    const c = this.ctx;
    const { level, nav, rng } = c;
    nav.flood(this.cell, this.costDark, 40);
    // Sometimes drift towards a broken lamp, otherwise any reachable dark cell a few steps away.
    if (c.faultCells.length > 0 && rng.next() < 0.3) {
      const f = rng.pick(c.faultCells);
      const fx = (f % level.w) + 0.5;
      const fz = Math.floor(f / level.w) + 0.5;
      if (Math.hypot(fx - c.playerX, fz - c.playerZ) > 6) {
        this.goNear(fx, fz);
        if (this.pathLen > 2) return;
      }
      nav.flood(this.cell, this.costDark, 40);
    }
    let count = 0;
    const n = level.w * level.h;
    for (let i = 0; i < n; i++) if (nav.dist[i] >= 4 && nav.dist[i] !== Infinity) count++;
    if (count === 0) {
      this.pathLen = 0;
      this.pathIdx = 0;
      this.idleTime = 1.5;
      return;
    }
    let k = rng.int(count);
    for (let i = 0; i < n; i++) {
      if (nav.dist[i] >= 4 && nav.dist[i] !== Infinity && k-- === 0) {
        this.pathLen = nav.pathTo(i, this.path);
        this.pathIdx = 0;
        return;
      }
    }
  }

  private pickFarTarget(): void {
    const c = this.ctx;
    c.nav.flood(this.cell, this.costDark, 30);
    let best = -1;
    let bestD = -1;
    const n = c.level.w * c.level.h;
    for (let i = 0; i < n; i++) {
      const d = c.nav.dist[i];
      if (d === Infinity) continue;
      const dx = (i % c.level.w) + 0.5 - c.playerX;
      const dz = Math.floor(i / c.level.w) + 0.5 - c.playerZ;
      const score = dx * dx + dz * dz - d * 0.5;
      if (score > bestD) {
        bestD = score;
        best = i;
      }
    }
    this.pathLen = best >= 0 ? c.nav.pathTo(best, this.path) : 0;
    this.pathIdx = 0;
  }

  /** Follow the current path. Returns true once the path is finished. */
  private followPath(speed: number, dt: number, ignoreProtection: boolean): boolean {
    const w = this.ctx.level.w;
    while (this.pathIdx < this.pathLen) {
      const cell = this.path[this.pathIdx];
      const tx = (cell % w) + 0.5;
      const tz = Math.floor(cell / w) + 0.5;
      const dx = tx - this.x;
      const dz = tz - this.z;
      if (dx * dx + dz * dz < 0.12 * 0.12) {
        this.pathIdx++;
        continue;
      }
      if (!ignoreProtection && this.ctx.prot.mask[cell] === 1) {
        // Path became lit: stop at the boundary and replan.
        this.pathLen = this.pathIdx;
        this.repathTimer = 0;
        return true;
      }
      const bx = this.x;
      const bz = this.z;
      this.moveToward(tx, tz, speed, dt, ignoreProtection);
      if (Math.abs(this.x - bx) + Math.abs(this.z - bz) < speed * dt * 0.1) {
        this.stuckTime += dt;
        if (this.stuckTime > 0.8) {
          this.stuckTime = 0;
          this.pathIdx = this.pathLen;
          return true;
        }
      } else this.stuckTime = 0;
      return false;
    }
    return true;
  }

  private moveToward(tx: number, tz: number, speed: number, dt: number, ignoreProtection: boolean): void {
    const dx = tx - this.x;
    const dz = tz - this.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1e-4) return;
    const step = Math.min(d, speed * dt);
    const nx = this.x + (dx / d) * step;
    const nz = this.z + (dz / d) * step;
    resolveCircle(
      this.ctx.level,
      ignoreProtection ? this.solidWalls : this.solidHunting,
      nx,
      nz,
      this.ctx.tuning.radius,
      this.tmp,
    );
    const mx = this.tmp.x - this.x;
    const mz = this.tmp.z - this.z;
    this.x = this.tmp.x;
    this.z = this.tmp.z;
    this.speed = Math.sqrt(mx * mx + mz * mz) / dt;
    this.facing = Math.atan2(dx, dz);
  }

  private face(x: number, z: number): void {
    this.facing = Math.atan2(x - this.x, z - this.z);
  }

  // ---------------------------------------------------------------- spawning

  /**
   * Choose a telegraphed spawn cell: dark, out of the player's sight, beyond the safety buffer,
   * never in the nook or landing. Authored candidates first, then any qualifying dark floor.
   */
  chooseSpawn(): number {
    const c = this.ctx;
    const { level } = c;
    const ok = (cell: number): boolean => {
      if (!level.walk[cell] || c.prot.mask[cell] || level.zone[cell] !== ZONE.None) return false;
      const x = (cell % level.w) + 0.5;
      const z = Math.floor(cell / level.w) + 0.5;
      const dx = x - c.playerX;
      const dz = z - c.playerZ;
      if (dx * dx + dz * dz < c.tuning.spawnMinDistance ** 2) return false;
      if (segmentClear(level, level.blockSight, x, z, c.playerX, c.playerZ)) return false;
      return this.pocketSize(cell) >= c.tuning.pocketMin;
    };
    const authored = level.spawns.filter(ok);
    if (authored.length > 0) return c.rng.pick(authored);
    const any: number[] = [];
    for (let i = 0; i < level.w * level.h; i++) if (level.kind[i] === K.Room && ok(i)) any.push(i);
    return any.length > 0 ? c.rng.pick(any) : -1;
  }
}
