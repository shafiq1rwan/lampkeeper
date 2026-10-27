// Parses an authored template into simulation-ready grid data.

import { LIGHT } from '../game/config';
import type { CircuitId } from '../game/types';
import { segmentClear } from '../simulation/grid';
import { getTemplate, type FloorTemplate } from './templates';

export const K = {
  Void: 0,
  Wall: 1,
  Corridor: 2,
  Room: 3,
  DoorClosed: 4,
  Doorway: 5,
  Exit: 6,
  Furniture: 7,
} as const;

export const ZONE = { None: 0, Nook: 1, Landing: 2 } as const;

export type PropType = 'sofa' | 'bed' | 'bookshelf' | 'table' | 'cabinet' | 'plant';

const FURNITURE: Record<string, PropType> = {
  q: 'sofa',
  r: 'bed',
  k: 'bookshelf',
  w: 'table',
  v: 'cabinet',
  p: 'plant',
};

export interface Mount {
  /** Direction from the cell towards the wall the object is mounted on (0,0 = free standing). */
  dx: number;
  dz: number;
}

export interface Fixture {
  id: number;
  circuit: CircuitId;
  cx: number;
  cz: number;
  cell: number;
  room: boolean;
  /** Fixture sits inside the permanently lit nook. */
  nook: boolean;
  mount: Mount;
  /** Cells this fixture protects when powered and working (respects walls). */
  coverage: Int32Array;
}

export interface SwitchDef {
  id: number;
  circuit: CircuitId;
  cx: number;
  cz: number;
  cell: number;
  panel: number;
  mount: Mount;
}

export interface Panel {
  id: number;
  cells: number[];
  inNook: boolean;
}

export interface TenantSpot {
  id: number;
  porchCell: number;
  doorCell: number;
  label: string;
  coverage: Int32Array;
}

export interface Door {
  id: number;
  cells: number[];
  open: boolean;
  label: string;
  /** True when the door sits in a wall running along X (faces ±Z). */
  alongX: boolean;
}

export interface Prop {
  type: PropType;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Direction to the wall its back rests against. */
  back: Mount;
}

export interface LevelData {
  template: FloorTemplate;
  w: number;
  h: number;
  kind: Uint8Array;
  zone: Uint8Array;
  /** 1 = actors can stand here. */
  walk: Uint8Array;
  /** 1 = blocks sight and light. */
  blockSight: Uint8Array;
  /** Permanently protected cells (nook, landing, switch pads). */
  emergency: Uint8Array;
  startX: number;
  startZ: number;
  startCell: number;
  nookCells: number[];
  landingCells: number[];
  exitCells: number[];
  exitX: number;
  exitZ: number;
  fixtures: Fixture[];
  switches: SwitchDef[];
  panels: Panel[];
  spawns: number[];
  tenants: TenantSpot[];
  doors: Door[];
  props: Prop[];
}

const levelCache = new Map<string, LevelData>();

/** Parsed level data is immutable and shared between runs. */
export function loadLevel(templateId: string): LevelData {
  let lvl = levelCache.get(templateId);
  if (!lvl) {
    lvl = parseTemplate(getTemplate(templateId));
    levelCache.set(templateId, lvl);
  }
  return lvl;
}

export function parseTemplate(t: FloorTemplate): LevelData {
  const h = t.map.length;
  const w = t.map[0].length;
  for (const row of t.map) {
    if (row.length !== w) throw new Error(`Template ${t.id}: ragged row "${row}"`);
  }
  const n = w * h;
  const ch = (x: number, z: number): string =>
    x < 0 || z < 0 || x >= w || z >= h ? '#' : t.map[z][x];
  const kind = new Uint8Array(n);
  const zone = new Uint8Array(n);
  const walk = new Uint8Array(n);
  const blockSight = new Uint8Array(n);
  const emergency = new Uint8Array(n);

  const isRoomish = (c: string): boolean => c === '_' || c in FURNITURE;
  const inferRoom = (x: number, z: number): boolean =>
    isRoomish(ch(x + 1, z)) || isRoomish(ch(x - 1, z)) || isRoomish(ch(x, z + 1)) || isRoomish(ch(x, z - 1));

  let startX = 1.5;
  let startZ = 1.5;
  const nookCells: number[] = [];
  const landingCells: number[] = [];
  const exitCells: number[] = [];
  const spawns: number[] = [];
  const porchCells: number[] = [];
  const rawFixtures: { x: number; z: number; circuit: CircuitId; nook: boolean }[] = [];
  const rawSwitches: { x: number; z: number; circuit: CircuitId }[] = [];

  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const c = t.map[z][x];
      const i = z * w + x;
      let k: number = K.Corridor;
      switch (c) {
        case '#':
        case ' ':
          k = K.Wall;
          break;
        case '.':
          k = K.Corridor;
          break;
        case '_':
          k = K.Room;
          break;
        case 'N':
        case 'P':
        case 'n':
          k = K.Corridor;
          zone[i] = ZONE.Nook;
          nookCells.push(i);
          if (c === 'P') {
            startX = x + 0.5;
            startZ = z + 0.5;
          }
          if (c === 'n') rawFixtures.push({ x, z, circuit: 0, nook: true });
          break;
        case 'L':
          k = K.Corridor;
          zone[i] = ZONE.Landing;
          landingCells.push(i);
          break;
        case 'E':
          k = K.Exit;
          exitCells.push(i);
          break;
        case 'o':
          k = K.Doorway;
          break;
        case 'd':
          k = K.DoorClosed;
          break;
        case 'a':
        case 'b':
        case 'c':
          k = inferRoom(x, z) ? K.Room : K.Corridor;
          rawFixtures.push({ x, z, circuit: (c.charCodeAt(0) - 97) as CircuitId, nook: false });
          break;
        case '1':
        case '2':
        case '3':
          k = K.Corridor;
          rawSwitches.push({ x, z, circuit: (c.charCodeAt(0) - 49) as CircuitId });
          break;
        case 'S':
          k = inferRoom(x, z) ? K.Room : K.Corridor;
          spawns.push(i);
          break;
        case 't':
          k = K.Corridor;
          porchCells.push(i);
          break;
        default:
          if (c in FURNITURE) k = K.Furniture;
          else throw new Error(`Template ${t.id}: unknown cell "${c}" at ${x},${z}`);
      }
      kind[i] = k;
      walk[i] = k === K.Corridor || k === K.Room || k === K.Doorway ? 1 : 0;
      blockSight[i] = k === K.Wall || k === K.DoorClosed || k === K.Exit ? 1 : 0;
    }
  }

  const shape = { w, h };
  const mountFor = (x: number, z: number): Mount => {
    // Prefer the wall facing the camera (north), then sides, then south.
    const order: Mount[] = [
      { dx: 0, dz: -1 },
      { dx: -1, dz: 0 },
      { dx: 1, dz: 0 },
      { dx: 0, dz: 1 },
    ];
    for (const m of order) {
      const k = kind[(z + m.dz) * w + (x + m.dx)];
      if (k === K.Wall) return m;
    }
    return { dx: 0, dz: 0 };
  };

  const coverageFrom = (x: number, z: number, radius: number): Int32Array => {
    const cells: number[] = [];
    const ox = x + 0.5;
    const oz = z + 0.5;
    const r = Math.ceil(radius);
    for (let cz = z - r; cz <= z + r; cz++) {
      for (let cx = x - r; cx <= x + r; cx++) {
        if (cx < 0 || cz < 0 || cx >= w || cz >= h) continue;
        const i = cz * w + cx;
        if (!walk[i]) continue;
        const dx = cx + 0.5 - ox;
        const dz = cz + 0.5 - oz;
        if (dx * dx + dz * dz > radius * radius) continue;
        if (!segmentClear(shape, blockSight, ox, oz, cx + 0.5, cz + 0.5)) continue;
        cells.push(i);
      }
    }
    return Int32Array.from(cells);
  };

  const fixtures: Fixture[] = rawFixtures
    .sort((a, b) => a.z - b.z || a.x - b.x)
    .map((f, id) => {
      const room = kind[f.z * w + f.x] === K.Room;
      return {
        id,
        circuit: f.circuit,
        cx: f.x,
        cz: f.z,
        cell: f.z * w + f.x,
        room,
        nook: f.nook,
        mount: mountFor(f.x, f.z),
        coverage: coverageFrom(f.x, f.z, room ? LIGHT.roomRadius : LIGHT.corridorRadius),
      };
    });

  // Group switches into panels (8-connected clusters).
  const switchCells = new Map<number, number>();
  rawSwitches.forEach((s, idx) => switchCells.set(s.z * w + s.x, idx));
  const panelOf = new Array<number>(rawSwitches.length).fill(-1);
  const panels: Panel[] = [];
  rawSwitches.forEach((_s, idx) => {
    if (panelOf[idx] >= 0) return;
    const id = panels.length;
    const queue = [idx];
    panelOf[idx] = id;
    const cells: number[] = [];
    while (queue.length) {
      const cur = rawSwitches[queue.pop()!];
      cells.push(cur.z * w + cur.x);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const j = switchCells.get((cur.z + dz) * w + (cur.x + dx));
          if (j !== undefined && panelOf[j] < 0) {
            panelOf[j] = id;
            queue.push(j);
          }
        }
    }
    const inNook = cells.some((c) => {
      const x = c % w;
      const z = Math.floor(c / w);
      return [c - 1, c + 1, c - w, c + w].some(
        (nb) => nb >= 0 && nb < n && zone[nb] === ZONE.Nook && Math.abs((nb % w) - x) + Math.abs(Math.floor(nb / w) - z) === 1,
      );
    });
    panels.push({ id, cells, inNook });
  });

  const switches: SwitchDef[] = rawSwitches
    .map((s, idx) => ({ ...s, idx }))
    .sort((a, b) => a.circuit - b.circuit || panelOf[a.idx] - panelOf[b.idx])
    .map((s, id) => ({
      id,
      circuit: s.circuit,
      cx: s.x,
      cz: s.z,
      cell: s.z * w + s.x,
      panel: panelOf[s.idx],
      mount: mountFor(s.x, s.z),
    }));

  for (const p of panels) {
    if (p.inNook) {
      for (const c of p.cells) {
        zone[c] = ZONE.Nook;
        nookCells.push(c);
      }
    }
  }

  // Emergency lighting: nook, exit landing, and small pads at every breaker panel.
  for (const c of nookCells) emergency[c] = 1;
  for (const c of landingCells) emergency[c] = 1;
  for (const s of switches) {
    for (const c of coverageFrom(s.cx, s.cz, LIGHT.switchPadRadius)) emergency[c] = 1;
  }

  // Doors: group contiguous door cells, label in reading order.
  const doorSeen = new Uint8Array(n);
  const doors: Door[] = [];
  for (let i = 0; i < n; i++) {
    if (doorSeen[i] || (kind[i] !== K.Doorway && kind[i] !== K.DoorClosed)) continue;
    const cells = [i];
    doorSeen[i] = 1;
    for (let j = 0; j < cells.length; j++) {
      const c = cells[j];
      for (const nb of [c + 1, c - 1, c + w, c - w]) {
        if (nb >= 0 && nb < n && !doorSeen[nb] && kind[nb] === kind[i]) {
          doorSeen[nb] = 1;
          cells.push(nb);
        }
      }
    }
    const x = i % w;
    const z = Math.floor(i / w);
    const alongX = kind[z * w + x - 1] === K.Wall || kind[z * w + x + 1] === K.Wall;
    doors.push({ id: doors.length, cells, open: kind[i] === K.Doorway, label: t.doorLabels[doors.length] ?? '', alongX });
  }

  const tenants: TenantSpot[] = porchCells.map((porch, id) => {
    const x = porch % w;
    const z = Math.floor(porch / w);
    const doorCell = [porch - w, porch + 1, porch - 1, porch + w].find((c) => kind[c] === K.DoorClosed) ?? -1;
    if (doorCell < 0) throw new Error(`Template ${t.id}: porch at ${x},${z} has no closed door`);
    const door = doors.find((d) => d.cells.includes(doorCell));
    return { id, porchCell: porch, doorCell, label: door?.label ?? '', coverage: coverageFrom(x, z, LIGHT.porchRadius) };
  });

  // Furniture props: contiguous same-type cells.
  const propSeen = new Uint8Array(n);
  const props: Prop[] = [];
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const c = t.map[z][x];
      const type = FURNITURE[c];
      if (!type || propSeen[z * w + x]) continue;
      let x1 = x;
      while (ch(x1 + 1, z) === c && !propSeen[z * w + x1 + 1]) x1++;
      let z1 = z;
      const rowMatches = (zz: number): boolean => {
        for (let xx = x; xx <= x1; xx++) if (ch(xx, zz) !== c || propSeen[zz * w + xx]) return false;
        return true;
      };
      while (rowMatches(z1 + 1)) z1++;
      for (let zz = z; zz <= z1; zz++) for (let xx = x; xx <= x1; xx++) propSeen[zz * w + xx] = 1;
      props.push({ type, x0: x, z0: z, x1, z1, back: propBack(kind, w, x, z, x1, z1) });
    }
  }

  const exitX = exitCells.reduce((s, c) => s + (c % w) + 0.5, 0) / Math.max(1, exitCells.length);
  const exitZ = exitCells.reduce((s, c) => s + Math.floor(c / w) + 0.5, 0) / Math.max(1, exitCells.length);

  return {
    template: t,
    w,
    h,
    kind,
    zone,
    walk,
    blockSight,
    emergency,
    startX,
    startZ,
    startCell: Math.floor(startZ) * w + Math.floor(startX),
    nookCells,
    landingCells,
    exitCells,
    exitX,
    exitZ,
    fixtures,
    switches,
    panels,
    spawns,
    tenants,
    doors,
    props,
  };
}

function propBack(kind: Uint8Array, w: number, x0: number, z0: number, x1: number, z1: number): Mount {
  const wallRun = (xs: number, zs: number, xe: number, ze: number): number => {
    let count = 0;
    for (let z = zs; z <= ze; z++) for (let x = xs; x <= xe; x++) if (kind[z * w + x] === K.Wall) count++;
    return count;
  };
  const candidates: [Mount, number][] = [
    [{ dx: 0, dz: -1 }, wallRun(x0, z0 - 1, x1, z0 - 1)],
    [{ dx: -1, dz: 0 }, wallRun(x0 - 1, z0, x0 - 1, z1)],
    [{ dx: 1, dz: 0 }, wallRun(x1 + 1, z0, x1 + 1, z1)],
    [{ dx: 0, dz: 1 }, wallRun(x0, z1 + 1, x1, z1 + 1)],
  ];
  candidates.sort((a, b) => b[1] - a[1]);
  return candidates[0][1] > 0 ? candidates[0][0] : { dx: 0, dz: -1 };
}
