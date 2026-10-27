// Grid geometry helpers shared by the simulation, AI, level validation and previews.

export interface GridShape {
  w: number;
  h: number;
}

export function cellOf(g: GridShape, x: number, z: number): number {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  if (cx < 0 || cz < 0 || cx >= g.w || cz >= g.h) return -1;
  return cz * g.w + cx;
}

export function cellX(g: GridShape, cell: number): number {
  return cell % g.w;
}

export function cellZ(g: GridShape, cell: number): number {
  return Math.floor(cell / g.w);
}

/**
 * True when the straight segment between two points crosses no blocking cell.
 * `ignoreCell` lets a target that is itself solid (a door, a wall switch) be tested.
 * Diagonal steps across a corner are blocked if either orthogonal neighbour blocks,
 * so nothing ever sees or lights through the seam between two wall cells.
 */
export function segmentClear(
  g: GridShape,
  block: Uint8Array,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  ignoreCell = -1,
): boolean {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.sqrt(dx * dx + dz * dz);
  const steps = Math.max(1, Math.ceil(len / 0.1));
  let pcx = Math.floor(x0);
  let pcz = Math.floor(z0);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cx = Math.floor(x0 + dx * t);
    const cz = Math.floor(z0 + dz * t);
    if (cx === pcx && cz === pcz) continue;
    if (cx < 0 || cz < 0 || cx >= g.w || cz >= g.h) return false;
    const c = cz * g.w + cx;
    if (c !== ignoreCell && block[c]) return false;
    if (cx !== pcx && cz !== pcz) {
      const a = pcz * g.w + cx;
      const b = cz * g.w + pcx;
      if ((a !== ignoreCell && block[a]) || (b !== ignoreCell && block[b])) return false;
    }
    pcx = cx;
    pcz = cz;
  }
  return true;
}

const pushOut = { x: 0, z: 0 };

/**
 * Resolve a circle against solid cells by pushing it out along the shortest axis-aware
 * direction. Repeated small passes give natural sliding along walls without snagging.
 * Returns true when any correction was applied. Writes the result into `out`.
 */
export function resolveCircle(
  g: GridShape,
  solid: (cell: number) => boolean,
  x: number,
  z: number,
  r: number,
  out: { x: number; z: number },
): boolean {
  let px = x;
  let pz = z;
  let hit = false;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    const minX = Math.floor(px - r);
    const maxX = Math.floor(px + r);
    const minZ = Math.floor(pz - r);
    const maxZ = Math.floor(pz + r);
    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const outside = cx < 0 || cz < 0 || cx >= g.w || cz >= g.h;
        if (!outside && !solid(cz * g.w + cx)) continue;
        if (circleBoxPush(px, pz, r, cx, cz)) {
          px += pushOut.x;
          pz += pushOut.z;
          moved = true;
          hit = true;
        }
      }
    }
    if (!moved) break;
  }
  out.x = px;
  out.z = pz;
  return hit;
}

function circleBoxPush(px: number, pz: number, r: number, cx: number, cz: number): boolean {
  const nx = px < cx ? cx : px > cx + 1 ? cx + 1 : px;
  const nz = pz < cz ? cz : pz > cz + 1 ? cz + 1 : pz;
  const dx = px - nx;
  const dz = pz - nz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r - 1e-9) return false;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    const k = (r - d) / d;
    pushOut.x = dx * k;
    pushOut.z = dz * k;
    return true;
  }
  // Centre inside the box: push out along the nearest face.
  const left = px - cx;
  const right = cx + 1 - px;
  const top = pz - cz;
  const bottom = cz + 1 - pz;
  const m = Math.min(left, right, top, bottom);
  pushOut.x = 0;
  pushOut.z = 0;
  if (m === left) pushOut.x = -(left + r);
  else if (m === right) pushOut.x = right + r;
  else if (m === top) pushOut.z = -(top + r);
  else pushOut.z = bottom + r;
  return true;
}

/** True when a circle overlaps any cell for which `solid` returns true. */
export function circleOverlaps(
  g: GridShape,
  solid: (cell: number) => boolean,
  x: number,
  z: number,
  r: number,
): boolean {
  const minX = Math.floor(x - r);
  const maxX = Math.floor(x + r);
  const minZ = Math.floor(z - r);
  const maxZ = Math.floor(z + r);
  for (let cz = minZ; cz <= maxZ; cz++) {
    for (let cx = minX; cx <= maxX; cx++) {
      if (cx < 0 || cz < 0 || cx >= g.w || cz >= g.h) continue;
      if (!solid(cz * g.w + cx)) continue;
      const nx = x < cx ? cx : x > cx + 1 ? cx + 1 : x;
      const nz = z < cz ? cz : z > cz + 1 ? cz + 1 : z;
      const dx = x - nx;
      const dz = z - nz;
      if (dx * dx + dz * dz < r * r - 1e-6) return true;
    }
  }
  return false;
}
