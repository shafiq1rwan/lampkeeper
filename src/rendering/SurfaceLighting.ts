// Cheap, wall-respecting diffuse bounce for the procedural environment. Reuses the visual
// light field derived from authoritative coverage; never modifies gameplay protection.
import * as THREE from 'three';
import { K, type LevelData } from '../levels/LevelData';
import { LIGHTING } from './theme';

interface Surface {
  color: THREE.BufferAttribute;
  base: Float32Array;
  cells: Int32Array;
}

export class SurfaceLighting {
  private readonly surfaces: Surface[] = [];
  private readonly field: Float32Array;

  constructor(private readonly level: LevelData) {
    this.field = new Float32Array(level.w * level.h);
  }

  register(geometry: THREE.BufferGeometry, transform?: THREE.Matrix4): void {
    const color = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!color) return;
    const pos = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const base = new Float32Array(color.array);
    const cells = new Int32Array(pos.count);
    const point = new THREE.Vector3();
    const { w, h, kind } = this.level;
    for (let i = 0; i < pos.count; i++) {
      point.fromBufferAttribute(pos, i);
      if (transform) point.applyMatrix4(transform);
      const x = Math.max(0, Math.min(w - 1, Math.floor(point.x)));
      const z = Math.max(0, Math.min(h - 1, Math.floor(point.z)));
      cells[i] = z * w + x;
      // Subtle contact occlusion at the base of walls and furniture. It works on low quality
      // too, and is baked once rather than requiring a screen-space AO postprocessing pass.
      let ao = 1;
      if (point.y < 0.07 && normal?.getY(i) > 0.5) {
        let occlusion = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const cx = x + dx, cz = z + dz;
          if (cx < 0 || cz < 0 || cx >= w || cz >= h) continue;
          const k = kind[cz * w + cx];
          if (k !== K.Wall && k !== K.Furniture && k !== K.DoorClosed) continue;
          const ex = Math.max(cx - point.x, 0, point.x - cx - 1);
          const ez = Math.max(cz - point.z, 0, point.z - cz - 1);
          const distance = Math.hypot(ex, ez);
          occlusion = Math.max(occlusion, Math.max(0, 1 - distance / 0.45));
        }
        ao = 1 - occlusion * 0.34;
      }
      for (let c = 0; c < 3; c++) base[i * 3 + c] *= ao;
    }
    this.surfaces.push({ color, base, cells });
  }

  refresh(glow: Uint8Array): void {
    const { level, field } = this;
    const { w, h } = level;
    for (let c = 0; c < field.length; c++) field[c] = glow[c * 4] / 255;
    // Solid furniture and door jambs receive bounce from their adjacent room. Wall cells
    // remain a barrier; don't diffuse the field across them into the next apartment.
    for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
      const c = z * w + x;
      if (level.walk[c]) continue;
      let light = 0;
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
        const n = nz * w + nx;
        if (level.walk[n]) light = Math.max(light, glow[n * 4] / 255);
      }
      field[c] = light;
    }
    for (const surface of this.surfaces) {
      const { color, base, cells } = surface;
      for (let i = 0; i < cells.length; i++) {
        const t = Math.min(1, field[cells[i]] * 1.45);
        for (let c = 0; c < 3; c++) {
          const cool = LIGHTING.surfaceCool[c];
          const warm = LIGHTING.surfaceWarm[c];
          color.array[i * 3 + c] = base[i * 3 + c] * (cool + (warm - cool) * t);
        }
      }
      color.needsUpdate = true;
    }
  }
}
