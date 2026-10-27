// Minimal voxel/box mesh builder: many coloured boxes → one BufferGeometry (one draw call).

import * as THREE from 'three';

const FACES: { n: [number, number, number]; v: [number, number, number][]; shade: number }[] = [
  { n: [1, 0, 0], v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.9 },
  { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.9 },
  { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.06 },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.6 },
  { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.97 },
  { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.97 },
];

const tmpColor = new THREE.Color();

export class VoxelBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  /** Axis-aligned box from its minimum corner (x, y, z) with size (w, h, d). */
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: number | [number, number, number], skipBottom = true): this {
    if (typeof color === 'number') tmpColor.setHex(color);
    else tmpColor.setRGB(color[0], color[1], color[2]);
    for (let f = 0; f < 6; f++) {
      if (skipBottom && f === 3) continue;
      const face = FACES[f];
      const base = this.pos.length / 3;
      for (const v of face.v) {
        this.pos.push(x + v[0] * w, y + v[1] * h, z + v[2] * d);
        this.nor.push(face.n[0], face.n[1], face.n[2]);
        this.col.push(tmpColor.r * face.shade, tmpColor.g * face.shade, tmpColor.b * face.shade);
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return this;
  }

  /** Box centred on (cx, cz) horizontally, resting on y. */
  centered(cx: number, y: number, cz: number, w: number, h: number, d: number, color: number | [number, number, number]): this {
    return this.box(cx - w / 2, y, cz - d / 2, w, h, d, color);
  }

  /** Flat quad on the XZ plane at height y (for floors). */
  quad(x: number, y: number, z: number, w: number, d: number, color: number): this {
    tmpColor.setHex(color);
    const base = this.pos.length / 3;
    this.pos.push(x, y, z + d, x + w, y, z + d, x + w, y, z, x, y, z);
    for (let i = 0; i < 4; i++) {
      this.nor.push(0, 1, 0);
      this.col.push(tmpColor.r, tmpColor.g, tmpColor.b);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return this;
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Rotate a builder's output around Y by quarter turns about a pivot (for prop orientation). */
export function rotateGeometryY(g: THREE.BufferGeometry, angle: number, pivotX: number, pivotZ: number): THREE.BufferGeometry {
  g.translate(-pivotX, 0, -pivotZ);
  g.rotateY(angle);
  g.translate(pivotX, 0, pivotZ);
  return g;
}
