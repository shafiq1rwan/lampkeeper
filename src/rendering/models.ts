// Procedural voxel model builders with semantic parameters. Replace these to change the art
// without touching simulation: every builder only produces geometry from level/prop data.

import * as THREE from 'three';
import type { Prop } from '../levels/LevelData';
import type { Rng } from '../simulation/rng';
import { GEOMETRY, PALETTE } from './theme';
import { VoxelBuilder } from './voxel';

// ------------------------------------------------------------------ shared materials

let shared: SharedMaterials | null = null;

export interface SharedMaterials {
  vertex: THREE.MeshLambertMaterial;
  wall: THREE.MeshLambertMaterial;
  bulb: THREE.MeshBasicMaterial;
  glow: THREE.MeshBasicMaterial;
}

/** Materials reused across runs (never disposed with a level). */
export function materials(): SharedMaterials {
  if (!shared) {
    shared = {
      vertex: new THREE.MeshLambertMaterial({ vertexColors: true }),
      wall: new THREE.MeshLambertMaterial({ vertexColors: true }),
      bulb: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    };
  }
  return shared;
}

// ------------------------------------------------------------------ props (furniture)

/**
 * Build a furniture prop in world space. Props are authored facing "back to -Z"
 * in a local W×D footprint, then rotated so their back rests against the template's wall.
 */
export function buildProp(prop: Prop, rng: Rng): THREE.BufferGeometry {
  const alongX = prop.back.dz !== 0;
  const W = alongX ? prop.x1 - prop.x0 + 1 : prop.z1 - prop.z0 + 1;
  const D = alongX ? prop.z1 - prop.z0 + 1 : prop.x1 - prop.x0 + 1;
  const vb = new VoxelBuilder();
  const hw = W / 2;
  const hd = D / 2;
  switch (prop.type) {
    case 'sofa': {
      const m = 0.08;
      vb.box(-hw + m, 0, -hd + 0.15, W - 2 * m, 0.08, D - 0.3, PALETTE.woodDark);
      vb.box(-hw + m, 0.08, -hd + 0.12, W - 2 * m, 0.27, D * 0.72, PALETTE.sofa);
      vb.box(-hw + m, 0.08, -hd + 0.08, W - 2 * m, 0.62, 0.22, PALETTE.sofa);
      vb.box(-hw + m, 0.08, -hd + 0.12, 0.16, 0.45, D * 0.72, PALETTE.sofa);
      vb.box(hw - m - 0.16, 0.08, -hd + 0.12, 0.16, 0.45, D * 0.72, PALETTE.sofa);
      const n = Math.max(1, Math.round(W));
      for (let i = 0; i < n; i++) {
        const cw = (W - 2 * m - 0.36) / n;
        vb.box(-hw + m + 0.18 + i * cw + 0.03, 0.35, -hd + 0.32, cw - 0.06, 0.10, D * 0.48, PALETTE.sofa);
        vb.box(-hw + m + 0.18 + i * cw + 0.025, 0.42, -hd + 0.10, cw - 0.05, 0.24, 0.19, PALETTE.sofa);
      }
      vb.box(hw - 0.55, 0.44, -hd + 0.27, 0.26, 0.27, 0.13, PALETTE.sofaCushion);
      break;
    }
    case 'bed': {
      vb.box(-hw + 0.06, 0, -hd + 0.06, W - 0.12, 0.25, D - 0.12, PALETTE.wood);
      vb.box(-hw + 0.06, 0, -hd + 0.02, W - 0.12, 0.62, 0.12, PALETTE.woodDark);
      vb.box(-hw + 0.1, 0.25, -hd + 0.14, W - 0.2, 0.14, D - 0.26, PALETTE.pillow);
      vb.box(-hw + 0.08, 0.3, -hd + D * 0.38, W - 0.16, 0.14, D * 0.58, PALETTE.bedSheet);
      vb.box(-hw + 0.08, 0.442, -hd + D * 0.43, W - 0.16, 0.015, 0.14, PALETTE.rug);
      vb.box(-hw + 0.08, 0.442, -hd + D * 0.79, W - 0.16, 0.015, 0.19, PALETTE.sofa);
      const pillows = W >= 1.6 ? 2 : 1;
      for (let i = 0; i < pillows; i++) {
        const pw = (W - 0.4) / pillows;
        vb.box(-hw + 0.2 + i * pw + 0.04, 0.39, -hd + 0.18, pw - 0.08, 0.1, 0.3, PALETTE.pillow);
      }
      break;
    }
    case 'bookshelf': {
      vb.box(-hw + 0.05, 0, -hd + 0.05, W - 0.1, 1.35, 0.08, PALETTE.woodDark);
      vb.box(-hw + 0.04, 0, -hd + 0.05, 0.09, 1.4, 0.44, PALETTE.wood);
      vb.box(hw - 0.13, 0, -hd + 0.05, 0.09, 1.4, 0.44, PALETTE.wood);
      for (let s = 0; s <= 3; s++) vb.box(-hw + 0.04, 0.04 + s * 0.44, -hd + 0.05, W - 0.08, 0.06, 0.44, PALETTE.wood);
      const shelves = 3;
      const colors = [PALETTE.book1, PALETTE.book2, PALETTE.book3, PALETTE.sofa];
      for (let s = 0; s < shelves; s++) {
        let x = -hw + 0.12;
        const y = 0.12 + s * 0.42;
        while (x < hw - 0.2) {
          const bw = 0.06 + rng.next() * 0.07;
          const bh = 0.22 + rng.next() * 0.1;
          vb.box(x, y, -hd + 0.1, bw, bh, 0.38, rng.pick(colors));
          x += bw + 0.015;
        }
      }
      break;
    }
    case 'table': {
      vb.box(-hw + 0.12, 0.44, -hd + 0.18, W - 0.24, 0.08, D - 0.36, PALETTE.wood);
      for (const [lx, lz] of [
        [-hw + 0.18, -hd + 0.22],
        [hw - 0.26, -hd + 0.22],
        [-hw + 0.18, hd - 0.3],
        [hw - 0.26, hd - 0.3],
      ]) {
        vb.box(lx, 0, lz, 0.08, 0.44, 0.08, PALETTE.woodDark);
      }
      vb.box(-0.08, 0.52, -0.08, 0.16, 0.1, 0.16, PALETTE.pot);
      vb.box(-0.12, 0.62, -0.12, 0.24, 0.18, 0.24, PALETTE.plantLeaf);
      break;
    }
    case 'cabinet': {
      vb.box(-hw + 0.08, 0, -hd + 0.06, W - 0.16, 0.78, 0.5, PALETTE.cabinet);
      vb.box(-hw + 0.08, 0.78, -hd + 0.06, W - 0.16, 0.05, 0.5, PALETTE.woodDark);
      const drawers = 2;
      for (let i = 0; i < drawers; i++) {
        vb.box(-hw + 0.16, 0.12 + i * 0.32, -hd + 0.56, W - 0.32, 0.24, 0.02, PALETTE.wood);
        vb.box(-0.09, 0.22 + i * 0.32, -hd + 0.58, 0.18, 0.03, 0.04, PALETTE.book3);
      }
      break;
    }
    case 'plant': {
      vb.box(-0.16, 0, -0.16, 0.32, 0.3, 0.32, PALETTE.pot);
      const leaves = 5 + rng.int(3);
      for (let i = 0; i < leaves; i++) {
        const a = (i / leaves) * Math.PI * 2 + rng.next();
        const r = 0.08 + rng.next() * 0.14;
        const s = 0.14 + rng.next() * 0.1;
        vb.box(Math.cos(a) * r - s / 2, 0.3 + rng.next() * 0.45, Math.sin(a) * r - s / 2, s, s * 1.4, s, rng.next() < 0.5 ? PALETTE.plantLeaf : PALETTE.plantLeafDark);
      }
      vb.box(-0.1, 0.55, -0.1, 0.2, 0.35, 0.2, PALETTE.plantLeaf);
      break;
    }
  }
  const g = vb.build();
  g.rotateY(Math.atan2(-prop.back.dx, -prop.back.dz));
  g.translate((prop.x0 + prop.x1 + 1) / 2, 0, (prop.z0 + prop.z1 + 1) / 2);
  return g;
}

// ------------------------------------------------------------------ wall-mounted objects

/** Unit wall block: base trim, painted body and a dark cap. Scaled per instance. */
export function wallUnitGeometry(): THREE.BufferGeometry {
  return new VoxelBuilder()
    .box(0, 0, 0, 1, 0.045, 1, PALETTE.wallBase)
    .box(0.012, 0.045, 0.012, 0.976, 0.925, 0.976, PALETTE.wall)
    .box(0, 0.045, 0, 1, 0.018, 1, 0x998971)
    .box(0, 0.97, 0, 1, 0.03, 1, PALETTE.wallCap)
    .build();
}

/**
 * Local space for wall-mounted items: origin at the floor-cell centre, local -Z pointing at the
 * wall. The returned group is rotated into place by `mountGroup`.
 */
export function mountGroup(cx: number, cz: number, dx: number, dz: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(cx + 0.5, 0, cz + 0.5);
  g.rotation.y = Math.atan2(-dx, -dz);
  return g;
}

/** Wall sconce bracket (the bulb itself is an instance in a shared bulb mesh). */
export function sconceGeometry(): THREE.BufferGeometry {
  const y = GEOMETRY.fixtureHeight;
  return new VoxelBuilder()
    .box(-0.14, y - 0.12, -0.5, 0.28, 0.3, 0.06, PALETTE.fixtureMetal)
    .box(-0.04, y + 0.02, -0.46, 0.08, 0.06, 0.2, PALETTE.fixtureMetal)
    .box(-0.12, y + 0.12, -0.34, 0.24, 0.05, 0.2, PALETTE.fixtureMetal)
    .build();
}

/** Bulb box in mount-local space. */
export const BULB = { x: -0.09, y: GEOMETRY.fixtureHeight - 0.08, z: -0.33, w: 0.18, h: 0.2, d: 0.18 };

/** Free-standing lamp post for fixtures without an adjacent wall. */
export function lampPostGeometry(): THREE.BufferGeometry {
  return new VoxelBuilder()
    .box(-0.12, 0, -0.12, 0.24, 0.06, 0.24, PALETTE.fixtureMetal)
    .box(-0.04, 0.06, -0.04, 0.08, GEOMETRY.fixtureHeight - 0.1, 0.08, PALETTE.fixtureMetal)
    .build();
}

/** Breaker housing for one switch. */
export function switchHousingGeometry(): THREE.BufferGeometry {
  return new VoxelBuilder()
    .box(-0.3, 0.55, -0.5, 0.6, 0.72, 0.1, PALETTE.panel)
    .box(-0.24, 0.62, -0.41, 0.48, 0.58, 0.02, PALETTE.panelFace)
    // conduit running up the wall
    .box(-0.05, 1.27, -0.49, 0.1, 0.3, 0.06, PALETTE.fixtureMetal)
    .build();
}

export function leverGeometry(): THREE.BufferGeometry {
  // Pivot at origin; handle points up along +Y.
  return new VoxelBuilder().box(-0.05, 0, -0.05, 0.1, 0.24, 0.1, 0xffffff, false).box(-0.09, 0.22, -0.07, 0.18, 0.08, 0.14, 0xffffff, false).build();
}

export function doorLeafGeometry(width: number, open: boolean): THREE.BufferGeometry {
  const vb = new VoxelBuilder();
  const h = GEOMETRY.doorHeight;
  if (open) {
    // Door leaf swung open against the inside wall, plus frame posts.
    vb.box(-0.5, 0, -0.56, 0.08, h + 0.08, 0.12, PALETTE.doorFrame);
    vb.box(width - 0.58, 0, -0.56, 0.08, h + 0.08, 0.12, PALETTE.doorFrame);
  } else {
    vb.box(-0.46, 0, -0.52, width - 0.08, h, 0.06, PALETTE.doorWood);
    for (const y of [0.20, h * 0.52]) {
      vb.box(-0.36, y, -0.453, width - 0.28, h * 0.31, 0.015, 0x95613b);
      vb.box(-0.32, y + 0.04, -0.432, width - 0.36, h * 0.31 - 0.08, 0.008, PALETTE.doorWood);
    }
    vb.box(-0.5, 0, -0.53, 0.06, h + 0.06, 0.08, PALETTE.doorFrame);
    vb.box(width - 0.56, 0, -0.53, 0.06, h + 0.06, 0.08, PALETTE.doorFrame);
    vb.box(-0.5, h, -0.53, width, 0.06, 0.08, PALETTE.doorFrame);
    vb.box(width - 0.74, h * 0.48, -0.47, 0.06, 0.06, 0.06, PALETTE.book3);
  }
  return vb.build();
}

export function exitDoorGeometry(width: number): THREE.BufferGeometry {
  const h = GEOMETRY.doorHeight + 0.1;
  return new VoxelBuilder()
    .box(-0.5, 0, -0.53, width, h + 0.1, 0.06, PALETTE.doorFrame)
    .box(-0.44, 0, -0.48, width / 2 - 0.08, h, 0.05, PALETTE.exitDoor)
    .box(-0.44 + width / 2, 0, -0.48, width / 2 - 0.08, h, 0.05, PALETTE.exitDoor)
    .build();
}

/** Picture frame / clock decor for walls. */
export function decorGeometry(kind: number, rng: Rng): THREE.BufferGeometry {
  const vb = new VoxelBuilder();
  if (kind === 0) {
    vb.box(-0.22, 0.75, -0.5, 0.44, 0.34, 0.04, PALETTE.woodDark);
    vb.box(-0.17, 0.8, -0.47, 0.34, 0.24, 0.02, rng.pick([PALETTE.rug, PALETTE.book1, PALETTE.sofa, PALETTE.book3]));
  } else {
    vb.box(-0.16, 0.85, -0.5, 0.32, 0.32, 0.05, 0xe8e2d2);
    vb.box(-0.02, 1.0, -0.45, 0.04, 0.13, 0.02, 0x222222);
    vb.box(-0.02, 0.99, -0.45, 0.1, 0.03, 0.02, 0x222222);
  }
  return vb.build();
}

// ------------------------------------------------------------------ characters

export interface CharacterRig {
  root: THREE.Group;
  body: THREE.Group;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  head: THREE.Object3D;
}

function part(geom: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geom, mat);
  m.position.set(x, y, z);
  return m;
}

export interface PlayerRig extends CharacterRig {
  lanternGlow: THREE.Mesh;
}

/** The caretaker: mustard work jacket, cap, and a dim inspection lantern in the right hand. */
export function buildPlayer(): PlayerRig {
  const mat = materials().vertex;
  const root = new THREE.Group();
  root.scale.setScalar(1.12);
  const body = new THREE.Group();
  root.add(body);
  const leg = (): THREE.BufferGeometry =>
    new VoxelBuilder().box(-0.07, -0.34, -0.08, 0.14, 0.3, 0.16, PALETTE.playerPants).box(-0.08, -0.4, -0.1, 0.16, 0.08, 0.2, PALETTE.playerBoot, false).build();
  const legL = part(leg(), mat, -0.09, 0.4, 0);
  const legR = part(leg(), mat, 0.09, 0.4, 0);
  const torso = new VoxelBuilder()
    .box(-0.19, 0.38, -0.12, 0.38, 0.36, 0.24, PALETTE.playerJacket)
    .box(-0.19, 0.38, -0.12, 0.38, 0.06, 0.24, PALETTE.playerJacketDark)
    .box(-0.04, 0.46, 0.115, 0.08, 0.24, 0.02, PALETTE.playerJacketDark)
    .box(-0.15, 0.51, 0.123, 0.095, 0.09, 0.022, PALETTE.playerJacketDark)
    .box(0.06, 0.51, 0.123, 0.095, 0.09, 0.022, PALETTE.playerJacketDark)
    .box(-0.015, 0.40, 0.133, 0.03, 0.30, 0.012, 0xe7b54a)
    .build();
  body.add(part(torso, mat, 0, 0, 0));
  const head = new THREE.Group();
  head.position.set(0, 0.74, 0);
  head.add(
    part(
      new VoxelBuilder()
        .box(-0.15, 0, -0.14, 0.3, 0.27, 0.28, PALETTE.playerSkin)
        .box(-0.155, 0.12, -0.15, 0.31, 0.13, 0.06, 0x533e27)
        .box(-0.155, 0.14, -0.15, 0.045, 0.10, 0.27, 0x533e27)
        .box(0.11, 0.14, -0.15, 0.045, 0.10, 0.27, 0x533e27)
        .box(-0.17, 0.22, -0.16, 0.34, 0.1, 0.32, PALETTE.playerCap)
        .box(-0.15, 0.22, 0.12, 0.3, 0.05, 0.14, PALETTE.playerCap)
        .box(-0.09, 0.1, 0.14, 0.05, 0.05, 0.01, 0x2a1d14)
        .box(0.04, 0.1, 0.14, 0.05, 0.05, 0.01, 0x2a1d14)
        .build(),
      mat,
      0,
      0,
      0,
    ),
  );
  body.add(head);
  const arm = (): THREE.BufferGeometry => new VoxelBuilder().box(-0.055, -0.3, -0.06, 0.11, 0.32, 0.12, PALETTE.playerJacket).box(-0.05, -0.36, -0.05, 0.1, 0.07, 0.1, PALETTE.playerSkin).build();
  const armL = part(arm(), mat, -0.25, 0.72, 0);
  const armR = new THREE.Group();
  armR.position.set(0.25, 0.72, 0);
  armR.add(part(arm(), mat, 0, 0, 0));
  const lantern = new VoxelBuilder()
    .box(-0.07, -0.56, -0.07, 0.14, 0.04, 0.14, PALETTE.lanternBody)
    .box(-0.07, -0.42, -0.07, 0.14, 0.04, 0.14, PALETTE.lanternBody)
    .box(-0.015, -0.38, -0.015, 0.03, 0.06, 0.03, PALETTE.lanternBody)
    .build();
  armR.add(part(lantern, mat, 0, 0, 0.02));
  const lanternGlow = new THREE.Mesh(new VoxelBuilder().box(-0.055, -0.52, -0.055, 0.11, 0.1, 0.11, PALETTE.lanternGlow).build(), materials().glow);
  lanternGlow.position.z = 0.02;
  armR.add(lanternGlow);
  body.add(legL, legR, armL, armR);
  return { root, body, legL, legR, armL, armR, head, lanternGlow };
}

export function buildTenant(rng: Rng): CharacterRig {
  const mat = materials().vertex;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const top = rng.pick([PALETTE.tenantTop, 0x5d8a9e, 0x9e6a5d]);
  const leg = (): THREE.BufferGeometry => new VoxelBuilder().box(-0.07, -0.34, -0.08, 0.14, 0.34, 0.16, PALETTE.tenantPants).build();
  const legL = part(leg(), mat, -0.09, 0.38, 0);
  const legR = part(leg(), mat, 0.09, 0.38, 0);
  body.add(part(new VoxelBuilder().box(-0.18, 0.36, -0.12, 0.36, 0.38, 0.24, top).build(), mat, 0, 0, 0));
  const head = new THREE.Group();
  head.position.set(0, 0.74, 0);
  head.add(
    part(
      new VoxelBuilder()
        .box(-0.14, 0, -0.13, 0.28, 0.26, 0.26, PALETTE.playerSkin)
        .box(-0.16, 0.2, -0.15, 0.32, 0.12, 0.3, PALETTE.tenantHair)
        .box(-0.16, 0.05, -0.15, 0.05, 0.2, 0.3, PALETTE.tenantHair)
        .box(0.11, 0.05, -0.15, 0.05, 0.2, 0.3, PALETTE.tenantHair)
        .box(-0.08, 0.1, 0.13, 0.04, 0.04, 0.01, 0x2a1d14)
        .box(0.04, 0.1, 0.13, 0.04, 0.04, 0.01, 0x2a1d14)
        .build(),
      mat,
      0,
      0,
      0,
    ),
  );
  body.add(head);
  const arm = (): THREE.BufferGeometry => new VoxelBuilder().box(-0.05, -0.32, -0.06, 0.1, 0.34, 0.12, top).box(-0.045, -0.37, -0.05, 0.09, 0.06, 0.1, PALETTE.playerSkin).build();
  const armL = part(arm(), mat, -0.24, 0.72, 0);
  const armR = part(arm(), mat, 0.24, 0.72, 0);
  body.add(legL, legR, armL, armR);
  return { root, body, legL, legR, armL, armR, head };
}

export interface CreatureRig extends CharacterRig {
  material: THREE.MeshLambertMaterial;
  eyeMaterial: THREE.MeshBasicMaterial;
  eyes: THREE.Mesh;
}

/** The lanky shadow: long legs and arms, a small head with two pale eyes. */
export function buildCreature(): CreatureRig {
  const material = new THREE.MeshLambertMaterial({ color: PALETTE.creature, emissive: PALETTE.creatureRim, transparent: true });
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.creatureEye, toneMapped: false, transparent: true });
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const box = (w: number, h: number, d: number, y0: number): THREE.BufferGeometry => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, y0 + h / 2, 0);
    return g;
  };
  const legL = new THREE.Mesh(box(0.12, 0.95, 0.12, -0.95), material);
  legL.position.set(-0.12, 0.98, 0);
  const legR = new THREE.Mesh(box(0.12, 0.95, 0.12, -0.95), material);
  legR.position.set(0.12, 0.98, 0);
  const torso = new THREE.Mesh(box(0.38, 0.62, 0.22, 0.95), material);
  const hips = new THREE.Mesh(box(0.32, 0.12, 0.2, 0.88), material);
  const armL = new THREE.Mesh(box(0.1, 0.95, 0.1, -0.95), material);
  armL.position.set(-0.26, 1.52, 0);
  const armR = new THREE.Mesh(box(0.1, 0.95, 0.1, -0.95), material);
  armR.position.set(0.26, 1.52, 0);
  const head = new THREE.Group();
  head.position.set(0, 1.58, 0.02);
  head.add(new THREE.Mesh(box(0.3, 0.3, 0.28, 0), material));
  const eyeGeom = new THREE.BufferGeometry();
  const eyes = new THREE.Mesh(
    (() => {
      const a = new THREE.BoxGeometry(0.06, 0.05, 0.02);
      a.translate(-0.07, 0.16, 0.145);
      const b = new THREE.BoxGeometry(0.06, 0.05, 0.02);
      b.translate(0.07, 0.16, 0.145);
      const pos = [...(a.getAttribute('position').array as Float32Array), ...(b.getAttribute('position').array as Float32Array)];
      const idxA = Array.from(a.getIndex()!.array);
      const idxB = Array.from(b.getIndex()!.array).map((i) => i + a.getAttribute('position').count);
      eyeGeom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      eyeGeom.setIndex([...idxA, ...idxB]);
      a.dispose();
      b.dispose();
      return eyeGeom;
    })(),
    eyeMaterial,
  );
  head.add(eyes);
  body.add(legL, legR, hips, torso, armL, armR, head);
  return { root, body, legL, legR, armL, armR, head, material, eyeMaterial, eyes };
}

/** Dispose geometries under an object (materials are shared unless `withMaterials`). */
export function disposeObject(obj: THREE.Object3D, withMaterials = false): void {
  obj.traverse((o) => {
    if ((o as THREE.Sprite).isSprite) return; // sprites share one internal geometry
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (withMaterials && m.material) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) mat.dispose();
    }
  });
}
