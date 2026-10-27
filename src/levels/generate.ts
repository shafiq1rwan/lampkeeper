// Seeded run generation with structural and power-aware validation, plus an authored fallback.

import { NavGrid } from '../ai/nav';
import { CREATURE_DEFAULT, VALIDATION } from '../game/config';
import { CIRCUIT_COUNT } from '../game/types';
import { computeMaskInto } from '../simulation/protection';
import { segmentClear } from '../simulation/grid';
import { deriveSeed, Rng } from '../simulation/rng';
import { loadLevel, type LevelData } from './LevelData';
import type { RunSetup } from './setup';
import { tuningFor, type ShiftDef } from './shifts';

export interface ValidationResult {
  ok: boolean;
  reasons: string[];
  /** A witnessed repair order and power plan (for diagnostics and tests). */
  plan: string[];
}

/** Build the run for a shift and seed. Deterministic: same inputs ⇒ same setup. */
export function generateRun(def: ShiftDef, seed: number): RunSetup {
  for (let attempt = 0; attempt < VALIDATION.attempts; attempt++) {
    const setup = rollSetup(def, seed, attempt);
    if (!setup) continue;
    if (validateSetup(setup, def).ok) return setup;
  }
  return fallbackSetup(def, seed);
}

export function fallbackSetup(def: ShiftDef, seed: number): RunSetup {
  const fb = def.fallback;
  const level = loadLevel(fb.templateId);
  // Prefer the authored spawn, but never accept one that fails the clearance rules.
  const valid = spawnCandidates(level, def.initialCircuits, fb.faults, fb.tenant);
  const preferred = level.spawns[fb.spawnIndex];
  const spawn = valid.includes(preferred) ? preferred : (valid[0] ?? preferred ?? level.spawns[0]);
  return baseSetup(def, seed, {
    templateId: fb.templateId,
    faults: fb.faults.slice(),
    tenant: fb.tenant,
    creatureSpawn: def.tutorial ? -1 : spawn,
    usedFallback: true,
    attempts: VALIDATION.attempts,
  });
}

function baseSetup(
  def: ShiftDef,
  seed: number,
  p: Pick<RunSetup, 'templateId' | 'faults' | 'tenant' | 'creatureSpawn' | 'usedFallback' | 'attempts'>,
): RunSetup {
  return {
    shift: def.id,
    seed,
    ...p,
    creatureSeed: deriveSeed(seed, 'creature'),
    initialCircuits: def.initialCircuits.slice(),
    capacity: def.capacity,
    tuning: tuningFor(def),
    tutorial: def.tutorial,
    tenantRecord: p.tenant >= 0 ? def.tenantRecord : -1,
    repairRecords: { ...def.repairRecords },
    ending: def.ending,
    parTime: def.parTime,
  };
}

function rollSetup(def: ShiftDef, seed: number, attempt: number): RunSetup | null {
  const stream = (name: string): Rng => new Rng(deriveSeed(seed, `${name}#${attempt}`));
  const templateId = stream('template').pick(def.templates);
  const level = loadLevel(templateId);

  const faults = pickFaults(level, def, stream('faults'));
  if (!faults) return null;

  let tenant = -1;
  const tr = stream('tenant');
  const wantTenant = def.tenant === 'always' || (typeof def.tenant === 'number' && tr.next() < def.tenant);
  if (wantTenant && level.tenants.length > 0) tenant = tr.int(level.tenants.length);

  let creatureSpawn = -1;
  if (!def.tutorial) {
    const candidates = spawnCandidates(level, def.initialCircuits, faults, tenant);
    if (candidates.length === 0) return null;
    creatureSpawn = stream('spawn').pick(candidates);
  }
  return baseSetup(def, seed, { templateId, faults, tenant, creatureSpawn, usedFallback: false, attempts: attempt + 1 });
}

function pickFaults(level: LevelData, def: ShiftDef, rng: Rng): number[] | null {
  const rule = def.faultRule;
  const faults: number[] = [];
  if (rule.tutorialFirst) {
    const nook = level.fixtures.find((f) => f.nook);
    if (!nook) return null;
    faults.push(nook.id);
  }
  const pool = rng.shuffle(level.fixtures.filter((f) => !f.nook).map((f) => f.id));
  for (const id of pool) {
    if (faults.length >= 3) break;
    const f = level.fixtures[id];
    const spaced = faults.every((o) => {
      const g = level.fixtures[o];
      return Math.hypot(g.cx - f.cx, g.cz - f.cz) >= VALIDATION.faultSpacing;
    });
    if (spaced) faults.push(id);
  }
  if (faults.length < 3) return null;
  if (!faultRulesHold(level, def, faults)) return null;
  return faults;
}

function faultRulesHold(level: LevelData, def: ShiftDef, faults: number[]): boolean {
  const circuits = new Set(faults.map((f) => level.fixtures[f].circuit));
  const powered = faults.filter((f) => def.initialCircuits[level.fixtures[f].circuit]).length;
  return circuits.size >= def.faultRule.minCircuits && powered >= def.faultRule.poweredBroken;
}

function spawnCandidates(level: LevelData, initial: boolean[], faults: number[], tenant: number): number[] {
  const broken = new Uint8Array(level.fixtures.length);
  for (const f of faults) broken[f] = 1;
  const mask = computeMaskInto(level, initial, broken, tenant >= 0 ? level.tenants[tenant].coverage : null, new Uint8Array(level.w * level.h));
  return level.spawns.filter((c) => spawnOk(level, mask, c));
}

function spawnOk(level: LevelData, mask: Uint8Array, cell: number): boolean {
  if (mask[cell] || !level.walk[cell]) return false;
  const x = (cell % level.w) + 0.5;
  const z = Math.floor(cell / level.w) + 0.5;
  if (Math.hypot(x - level.startX, z - level.startZ) < VALIDATION.spawnClearance) return false;
  if (segmentClear(level, level.blockSight, x, z, level.startX, level.startZ)) return false;
  // Never start the creature trapped in a small dark pocket (it would only dissolve).
  let count = 0;
  const nav = new NavGrid(level.w, level.h);
  nav.flood(cell, (c) => (level.walk[c] && !mask[c] ? 0 : -1), Infinity, () => ++count >= CREATURE_DEFAULT.pocketMin);
  return count >= CREATURE_DEFAULT.pocketMin;
}

// ---------------------------------------------------------------------------- validation

/**
 * Validate a setup structurally and against power states. Beyond a flood fill, it searches for
 * a repair order and per-leg circuit allocation (switches are only changed at reachable breaker
 * panels, never above capacity) in which every required leg crosses at most `maxLegExposure`
 * unlit cells, ending at the emergency-lit exit landing.
 */
export function validateSetup(setup: RunSetup, def: ShiftDef): ValidationResult {
  const reasons: string[] = [];
  const level = loadLevel(setup.templateId);
  const n = level.w * level.h;
  const nav = new NavGrid(level.w, level.h);
  const walkCost = (c: number): number => (level.walk[c] ? 0 : -1);

  // Faults: distinct, eligible, spaced, rule-conforming.
  if (new Set(setup.faults).size !== 3) reasons.push('faults must be three distinct fixtures');
  if (setup.faults.some((f) => f < 0 || f >= level.fixtures.length)) {
    reasons.push('fault id out of range');
    return { ok: false, reasons, plan: [] };
  }
  if (!faultRulesHold(level, def, setup.faults)) reasons.push('fault rules not satisfied');
  if (def.tutorial && !level.fixtures[setup.faults[0]].nook) reasons.push('tutorial first repair must be in the nook');

  // Capacity.
  const initialOn = setup.initialCircuits.filter(Boolean).length;
  if (setup.capacity < 1 || setup.capacity > CIRCUIT_COUNT) reasons.push('capacity out of range');
  if (initialOn > setup.capacity) reasons.push('initial circuits exceed capacity');

  // Connectivity of every required interaction from the start.
  nav.flood(level.startCell, walkCost);
  const reach = (c: number): boolean => nav.reached(c);
  for (const f of setup.faults) if (!reach(level.fixtures[f].cell)) reasons.push(`fault ${f} unreachable`);
  for (const s of level.switches) if (!reach(s.cell)) reasons.push(`switch ${s.id} unreachable`);
  if (!level.landingCells.some(reach)) reasons.push('exit landing unreachable');
  if (setup.tenant >= 0 && !reach(level.tenants[setup.tenant].porchCell)) reasons.push('tenant unreachable');
  for (let c = 0; c < CIRCUIT_COUNT; c++) {
    if (!level.switches.some((s) => s.circuit === c && reach(s.cell))) reasons.push(`no reachable switch for circuit ${c}`);
  }

  // Creature start.
  const broken = new Uint8Array(level.fixtures.length);
  for (const f of setup.faults) broken[f] = 1;
  const tenantCov = setup.tenant >= 0 ? level.tenants[setup.tenant].coverage : null;
  const initialMask = computeMaskInto(level, setup.initialCircuits, broken, tenantCov, new Uint8Array(n));
  if (setup.tutorial) {
    if (setup.creatureSpawn !== -1) reasons.push('tutorial must not start with an active creature');
    if (!initialMask[level.fixtures[setup.faults[0]].cell]) reasons.push('tutorial repair is not protected');
  } else if (setup.creatureSpawn < 0 || !spawnOk(level, initialMask, setup.creatureSpawn)) {
    reasons.push('creature spawn violates clearance');
  } else if (!reach(setup.creatureSpawn)) reasons.push('creature spawn unreachable');

  if (def.ending && level.template.exitLabel !== '104') reasons.push('ending shift must finish at 104');

  if (reasons.length > 0) return { ok: false, reasons, plan: [] };

  const plan = solvePower(level, setup, def.maxLegExposure, nav, tenantCov);
  if (!plan) reasons.push('no repair order and power plan within exposure limit');
  return { ok: reasons.length === 0, reasons, plan: plan ?? [] };
}

function solvePower(
  level: LevelData,
  setup: RunSetup,
  maxLeg: number,
  nav: NavGrid,
  tenantCov: Int32Array | null,
): string[] | null {
  const n = level.w * level.h;
  const configs: number[] = [];
  for (let m = 0; m < 1 << CIRCUIT_COUNT; m++) {
    let bits = 0;
    for (let c = 0; c < CIRCUIT_COUNT; c++) if (m & (1 << c)) bits++;
    if (bits <= setup.capacity) configs.push(m);
  }
  const panelCells = level.panels.map((p) => p.cells[0]);
  const exitGoal = new Uint8Array(n);
  for (const c of level.landingCells) exitGoal[c] = 1;

  const maskCache = new Map<number, Uint8Array>();
  const maskFor = (cfg: number, repaired: number): Uint8Array => {
    const key = cfg * 16 + repaired;
    let m = maskCache.get(key);
    if (!m) {
      const broken = new Uint8Array(level.fixtures.length);
      setup.faults.forEach((f, i) => {
        if (!(repaired & (1 << i))) broken[f] = 1;
      });
      const on = [0, 1, 2].map((c) => (cfg & (1 << c)) !== 0);
      m = computeMaskInto(level, on, broken, tenantCov, new Uint8Array(n));
      maskCache.set(key, m);
    }
    return m;
  };
  const distCache = new Map<string, Float32Array>();
  const distFrom = (from: number, cfg: number, repaired: number): Float32Array => {
    const key = `${from}|${cfg}|${repaired}`;
    let d = distCache.get(key);
    if (!d) {
      const mask = maskFor(cfg, repaired);
      nav.flood(from, (c) => (level.walk[c] ? (mask[c] ? 0 : 1) : -1), Infinity, undefined, 0.001);
      d = Float32Array.from(nav.dist);
      distCache.set(key, d);
    }
    return d;
  };
  const exposureTo = (d: Float32Array, goal: number): number => d[goal];
  const exposureToExit = (d: Float32Array): number => {
    let best = Infinity;
    for (const c of level.landingCells) best = Math.min(best, d[c]);
    return best;
  };

  const initialCfg = setup.initialCircuits.reduce((m, on, c) => (on ? m | (1 << c) : m), 0);
  const faultCells = setup.faults.map((f) => level.fixtures[f].cell);
  const cfgName = (cfg: number): string => ['A', 'B', 'C'].filter((_, c) => cfg & (1 << c)).join('') || 'none';

  // Depth-first search over (position, power config, repaired set).
  const seen = new Set<string>();
  const plan: string[] = [];
  const search = (pos: number, cfg: number, repaired: number): boolean => {
    const key = `${pos}|${cfg}|${repaired}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (repaired === 7) {
      if (exposureToExit(distFrom(pos, cfg, repaired)) <= maxLeg) {
        plan.push(`exit with ${cfgName(cfg)}`);
        return true;
      }
      for (const p of panelCells) {
        if (exposureTo(distFrom(pos, cfg, repaired), p) > maxLeg) continue;
        for (const next of configs) {
          if (exposureToExit(distFrom(p, next, repaired)) <= maxLeg) {
            plan.push(`panel ${p} → ${cfgName(next)}`, `exit with ${cfgName(next)}`);
            return true;
          }
        }
      }
      return false;
    }
    const here = distFrom(pos, cfg, repaired);
    for (let i = 0; i < 3; i++) {
      if (repaired & (1 << i)) continue;
      if (exposureTo(here, faultCells[i]) <= maxLeg) {
        plan.push(`repair ${setup.faults[i]} with ${cfgName(cfg)}`);
        if (search(faultCells[i], cfg, repaired | (1 << i))) return true;
        plan.pop();
      }
    }
    for (const p of panelCells) {
      if (exposureTo(here, p) > maxLeg) continue;
      for (const next of configs) {
        if (next === cfg) continue;
        const fromPanel = distFrom(p, next, repaired);
        for (let i = 0; i < 3; i++) {
          if (repaired & (1 << i)) continue;
          if (exposureTo(fromPanel, faultCells[i]) <= maxLeg) {
            plan.push(`panel ${p} → ${cfgName(next)}`, `repair ${setup.faults[i]} with ${cfgName(next)}`);
            if (search(faultCells[i], next, repaired | (1 << i))) return true;
            plan.pop();
            plan.pop();
          }
        }
      }
    }
    return false;
  };
  return search(level.startCell, initialCfg, 0) ? plan : null;
}
