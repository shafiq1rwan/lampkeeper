// Renders a level and its live state. Reads the simulation; never changes it.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { K, ZONE, type LevelData } from '../levels/LevelData';
import { deriveSeed, Rng } from '../simulation/rng';
import type { World } from '../simulation/World';
import {
  BULB,
  buildProp,
  buildTenant,
  decorGeometry,
  disposeObject,
  doorLeafGeometry,
  exitDoorGeometry,
  lampPostGeometry,
  leverGeometry,
  materials,
  mountGroup,
  sconceGeometry,
  switchHousingGeometry,
  wallUnitGeometry,
  type CharacterRig,
} from './models';
import { ANIMATION, CAMERA, GEOMETRY, LIGHTING, PALETTE } from './theme';
import { blobTexture, circuitTagTexture, iconTexture, plaqueTexture } from './textures';
import { SurfaceLighting } from './SurfaceLighting';
import { VoxelBuilder } from './voxel';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

interface WallInstance {
  cell: number;
  x: number;
  z: number;
  height: number;
  target: number;
  width: number;
  depth: number;
  attachments: THREE.Object3D[];
}

interface FixtureView {
  bulbIndex: number;
  /** Seconds since this bulb last turned on (for the ignition animation). */
  ignite: number;
  wasLit: boolean;
  marker: THREE.Sprite | null;
}

export interface OverlayFlags {
  /** Circuit whose coverage should be previewed (selected switch), or -1. */
  previewCircuit: number;
  reducedMotion: boolean;
  /** Development: show collision cells. */
  debugCollision: boolean;
}

export class LevelView {
  readonly root = new THREE.Group();
  private readonly level: LevelData;
  private readonly walls: WallInstance[] = [];
  private readonly wallIndex = new Map<number, number>();
  private wallMesh!: THREE.InstancedMesh;
  private wallWarmWeights: { idx: number; w: number }[][] = [];
  private emergencyWarm: { idx: number; w: number }[] = [];
  private readonly warm: Float32Array;
  private bulbMesh!: THREE.InstancedMesh;
  private readonly bulbTransforms: THREE.Matrix4[] = [];
  private readonly fixtures: FixtureView[] = [];
  private emergencyBulbs = 0;
  private readonly levers: { mesh: THREE.Mesh; mat: THREE.MeshLambertMaterial; circuit: number; angle: number }[] = [];
  private readonly maskData: Uint8Array;
  private readonly maskTex: THREE.DataTexture;
  private readonly glowData: Uint8Array;
  private readonly glowTex: THREE.DataTexture;
  private readonly overlayMat: THREE.ShaderMaterial;
  private readonly ownedMaterials: THREE.Material[] = [];
  private tenant: CharacterRig | null = null;
  private tenantMarker: THREE.Sprite | null = null;
  private exitMarker!: THREE.Sprite;
  private exitLight!: THREE.Mesh;
  private exitLightMat!: THREE.MeshBasicMaterial;
  private lastProtVersion = -1;
  private lastPreview = -2;
  private time = 0;
  private readonly lightCandidates: { x: number; z: number; d: number }[] = [];
  private readonly surfaceLighting: SurfaceLighting;
  private readonly emergencyLights: { x: number; z: number }[] = [];

  constructor(
    private readonly world: World,
    private readonly lights: THREE.PointLight[],
  ) {
    const level = world.level;
    this.level = level;
    this.surfaceLighting = new SurfaceLighting(level);
    const cosmetic = new Rng(deriveSeed(world.setup.seed, `cosmetic:${level.template.id}`));
    this.warm = new Float32Array(0);
    this.buildFloor(cosmetic);
    this.buildWalls();
    this.warm = new Float32Array(this.walls.length);
    this.buildProps(cosmetic);
    this.buildDoors();
    this.buildFixtures();
    this.buildSwitches();
    this.buildDecor(cosmetic);
    this.buildArchitecture(cosmetic);
    this.buildContactShadows();
    this.buildTenant(cosmetic);
    this.buildExit();

    const n = level.w * level.h;
    this.maskData = new Uint8Array(n * 4);
    this.maskTex = new THREE.DataTexture(this.maskData, level.w, level.h, THREE.RGBAFormat);
    this.maskTex.magFilter = THREE.NearestFilter;
    this.maskTex.minFilter = THREE.NearestFilter;
    this.glowData = new Uint8Array(n * 4);
    this.glowTex = new THREE.DataTexture(this.glowData, level.w, level.h, THREE.RGBAFormat);
    this.glowTex.magFilter = THREE.LinearFilter;
    this.glowTex.minFilter = THREE.LinearFilter;
    this.overlayMat = this.buildOverlay();
    this.computeWarmWeights();
  }

  // ------------------------------------------------------------------ build

  private buildFloor(rng: Rng): void {
    const { level } = this;
    const vb = new VoxelBuilder();
    for (let z = 0; z < level.h; z++) {
      for (let x = 0; x < level.w; x++) {
        const i = z * level.w + x;
        const k = level.kind[i];
        if (k === K.Wall) {
          // Fill the recess around the thinner rendered partition. The simulation still
          // owns the original wall cell; this introduces no traversable space.
          const nearFloor = [i - 1, i + 1, i - level.w, i + level.w].some((c) => c >= 0 && c < level.kind.length && level.kind[c] !== K.Wall);
          if (nearFloor) vb.quad(x, -0.002, z, 1, 1, PALETTE.floorCorridorAlt);
          continue;
        }
        const room = k === K.Room || k === K.Furniture;
        vb.quad(x, -0.006, z, 1, 1, room ? 0x73563b : 0x8a7154);
        // Real small-scale geometry, not one flat colour per gameplay cell. The corridor
        // uses inset stone tiles; apartments use staggered wooden boards.
        const columns = room ? 2 : 4;
        for (let tz = 0; tz < 4; tz++) for (let tx = 0; tx < columns; tx++) {
          const base = room
            ? (rng.next() < 0.5 ? PALETTE.floorRoom : PALETTE.floorRoomAlt)
            : (rng.next() < 0.5 ? PALETTE.floorCorridor : PALETTE.floorCorridorAlt);
          let color = base;
          if (level.zone[i] === ZONE.Nook) color = PALETTE.floorNook;
          if (level.zone[i] === ZONE.Landing) color = PALETTE.floorLanding;
          tmpC.setHex(color).multiplyScalar(0.89 + rng.next() * 0.20);
          const gap = room ? 0.004 : 0.005;
          vb.quad(x + tx / columns + gap, 0, z + tz / 4 + gap, 1 / columns - gap * 2, 0.25 - gap * 2, tmpC.getHex());
          if (room && rng.next() < 0.3) vb.quad(x + tx / columns + 0.05, 0.001, z + tz / 4 + 0.1, 0.25, 0.008, PALETTE.floorRoomAlt);
        }
      }
    }
    // Rugs in larger rooms (cosmetic only).
    const seen = new Uint8Array(level.w * level.h);
    for (let i = 0; i < level.w * level.h; i++) {
      if (seen[i] || level.kind[i] !== K.Room) continue;
      const region: number[] = [i];
      seen[i] = 1;
      for (let j = 0; j < region.length; j++) {
        const c = region[j];
        for (const nb of [c + 1, c - 1, c + level.w, c - level.w]) {
          if (!seen[nb] && (level.kind[nb] === K.Room || level.kind[nb] === K.Furniture)) {
            seen[nb] = 1;
            region.push(nb);
          }
        }
      }
      if (region.length < 16 || rng.next() < 0.25) continue;
      const xs = region.map((c) => c % level.w);
      const zs = region.map((c) => Math.floor(c / level.w));
      const cx = (Math.min(...xs) + Math.max(...xs) + 1) / 2;
      const cz = (Math.min(...zs) + Math.max(...zs) + 1) / 2;
      const rw = 2 + rng.int(2);
      const rd = 1.5 + rng.int(2) * 0.5;
      vb.quad(cx - rw / 2, 0.004, cz - rd / 2, rw, rd, PALETTE.rug);
      vb.quad(cx - rw / 2 + 0.15, 0.006, cz - rd / 2 + 0.15, rw - 0.3, rd - 0.3, 0x5f828b);
    }
    const mesh = new THREE.Mesh(vb.build(), materials().vertex);
    this.surfaceLighting.register(mesh.geometry);
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  private buildWalls(): void {
    const { level } = this;
    const solidVisible = (k: number): boolean => k === K.Wall || k === K.DoorClosed || k === K.Exit;
    for (let z = 0; z < level.h; z++) {
      for (let x = 0; x < level.w; x++) {
        const i = z * level.w + x;
        if (!solidVisible(level.kind[i])) continue;
        let near = false;
        for (let dz = -1; dz <= 1 && !near; dz++)
          for (let dx = -1; dx <= 1 && !near; dx++) {
            const nx = x + dx;
            const nz = z + dz;
            if (nx < 0 || nz < 0 || nx >= level.w || nz >= level.h) continue;
            if (!solidVisible(level.kind[nz * level.w + nx])) near = true;
          }
        if (!near) continue;
        this.wallIndex.set(i, this.walls.length);
        const open = (c: number): boolean => c >= 0 && c < level.kind.length && !solidVisible(level.kind[c]);
        const horizontal = open(i - level.w) || open(i + level.w);
        const vertical = (x > 0 && open(i - 1)) || (x < level.w - 1 && open(i + 1));
        const width = vertical && !horizontal ? 0.24 : 1;
        const depth = horizontal && !vertical ? 0.24 : 1;
        this.walls.push({ cell: i, x, z, width, depth, height: GEOMETRY.wallHeight, target: GEOMETRY.wallHeight, attachments: [] });
      }
    }
    const mesh = new THREE.InstancedMesh(wallUnitGeometry(), materials().wall, this.walls.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.walls.forEach((w, idx) => {
      // Door and exit cells are lower so their doors read clearly.
      const isDoor = level.kind[w.cell] !== K.Wall;
      w.height = w.target = isDoor ? GEOMETRY.wallHeight : GEOMETRY.wallHeight;
      this.setWallMatrix(mesh, idx, w);
      mesh.setColorAt(idx, tmpC.setRGB(...LIGHTING.wallCool));
    });
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.wallMesh = mesh;
    this.root.add(mesh);
  }

  private setWallMatrix(mesh: THREE.InstancedMesh, idx: number, w: WallInstance): void {
    const isDoor = this.level.kind[w.cell] !== K.Wall;
    // Door cells only draw the lintel band above the door, so the door leaf stays visible.
    if (isDoor) {
      const y0 = Math.min(w.height, GEOMETRY.doorHeight + 0.08);
      tmpM.compose(tmpV.set(w.x + (1 - w.width) / 2, y0, w.z + (1 - w.depth) / 2), tmpQ.identity(), tmpS.set(w.width, Math.max(0.001, w.height - y0), w.depth));
    } else {
      tmpM.compose(tmpV.set(w.x + (1 - w.width) / 2, 0, w.z + (1 - w.depth) / 2), tmpQ.identity(), tmpS.set(w.width, w.height, w.depth));
    }
    mesh.setMatrixAt(idx, tmpM);
  }

  private attach(wallCell: number, obj: THREE.Object3D): void {
    this.root.add(obj);
    const idx = this.wallIndex.get(wallCell);
    if (idx !== undefined) {
      const wall = this.walls[idx];
      const dx = Math.sign(wall.x + 0.5 - obj.position.x) * (1 - wall.width) / 2;
      const dz = Math.sign(wall.z + 0.5 - obj.position.z) * (1 - wall.depth) / 2;
      obj.position.x += dx;
      obj.position.z += dz;
      if (typeof obj.userData.bulbIndex === 'number') {
        this.bulbMesh.getMatrixAt(obj.userData.bulbIndex, tmpM);
        tmpM.elements[12] += dx;
        tmpM.elements[14] += dz;
        this.bulbMesh.setMatrixAt(obj.userData.bulbIndex, tmpM);
        this.bulbMesh.instanceMatrix.needsUpdate = true;
      }
      wall.attachments.push(obj);
    }
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.material === materials().vertex) this.surfaceLighting.register(mesh.geometry, mesh.matrixWorld);
    });
  }

  private buildProps(rng: Rng): void {
    const geoms = this.level.props.map((p) => buildProp(p, rng));
    if (geoms.length === 0) return;
    const merged = mergeGeometries(geoms, false);
    for (const g of geoms) g.dispose();
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, materials().vertex);
    this.surfaceLighting.register(merged);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  private buildDoors(): void {
    const { level } = this;
    const w = level.w;
    const tenantDoor = this.world.tenantActive ? level.tenants[this.world.setup.tenant].doorCell : -1;
    const staticVb = new VoxelBuilder();
    for (const door of level.doors) {
      for (const cell of door.cells) {
        const x = cell % w;
        const z = Math.floor(cell / w);
        if (door.open) {
          // Frame posts at the doorway edges plus a threshold strip.
          if (door.alongX) {
            staticVb.box(x, 0, z + 0.38, 0.08, GEOMETRY.doorHeight + 0.1, 0.24, PALETTE.doorFrame);
            staticVb.box(x + 0.92, 0, z + 0.38, 0.08, GEOMETRY.doorHeight + 0.1, 0.24, PALETTE.doorFrame);
            staticVb.box(x + 0.08, 0, z + 0.1, 0.84, 0.02, 0.8, PALETTE.woodDark);
          } else {
            staticVb.box(x + 0.38, 0, z, 0.24, GEOMETRY.doorHeight + 0.1, 0.08, PALETTE.doorFrame);
            staticVb.box(x + 0.38, 0, z + 0.92, 0.24, GEOMETRY.doorHeight + 0.1, 0.08, PALETTE.doorFrame);
            staticVb.box(x + 0.1, 0, z + 0.08, 0.8, 0.02, 0.84, PALETTE.woodDark);
          }
        } else {
          for (const [dx, dz] of [
            [0, 1],
            [0, -1],
            [1, 0],
            [-1, 0],
          ]) {
            const nb = (z + dz) * w + (x + dx);
            if (!level.walk[nb]) continue;
            const g = mountGroup(x + dx, z + dz, -dx, -dz);
            const leaf = new THREE.Mesh(doorLeafGeometry(1, false), materials().vertex);
            if (cell === tenantDoor) {
              leaf.geometry.dispose();
              leaf.geometry = doorLeafGeometry(1, true);
            }
            g.add(leaf);
            this.attach(cell, g);
          }
        }
        if (door.label) {
          // Number plaque on the wall beside the door, facing the corridor side.
          const side = this.corridorSide(cell);
          if (side) {
            const plaqueWall = door.alongX ? cell + 1 : cell + w;
            const g = mountGroup(x + side.dx, z + side.dz, -side.dx, -side.dz);
            const mat = new THREE.MeshBasicMaterial({ map: plaqueTexture(door.label), transparent: true });
            this.ownedMaterials.push(mat);
            const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.21), mat);
            plate.position.set(door.alongX ? 0.62 : -0.62, GEOMETRY.doorHeight + 0.05, -0.47);
            if (level.kind[plaqueWall] !== K.Wall) plate.position.x = 0;
            g.add(plate);
            this.attach(level.kind[plaqueWall] === K.Wall ? plaqueWall : cell, g);
          }
        }
      }
    }
    if (!staticVb.empty) {
      const geometry = staticVb.build();
      this.surfaceLighting.register(geometry);
      this.root.add(new THREE.Mesh(geometry, materials().vertex));
    }
  }

  private corridorSide(cell: number): { dx: number; dz: number } | null {
    const { level } = this;
    const w = level.w;
    const opts = [
      { dx: 0, dz: 1 },
      { dx: 0, dz: -1 },
      { dx: 1, dz: 0 },
      { dx: -1, dz: 0 },
    ];
    for (const o of opts) {
      const nb = cell + o.dz * w + o.dx;
      if (level.kind[nb] === K.Corridor) return o;
    }
    for (const o of opts) if (level.walk[cell + o.dz * w + o.dx]) return o;
    return null;
  }

  private buildFixtures(): void {
    const { level } = this;
    const nookEmergency = this.emergencyMounts();
    for (const m of nookEmergency) this.emergencyLights.push({ x: m.cx + 0.5 + m.dx * 0.60, z: m.cz + 0.5 + m.dz * 0.60 });
    this.emergencyBulbs = nookEmergency.length;
    const count = level.fixtures.length + this.emergencyBulbs;
    this.bulbMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(BULB.w, BULB.h, BULB.d), materials().bulb, count);
    const sconce = sconceGeometry();
    const post = lampPostGeometry();
    const place = (cx: number, cz: number, dx: number, dz: number, bulbIdx: number, circuit: number): THREE.Group => {
      const free = dx === 0 && dz === 0;
      const g = free ? mountGroup(cx, cz, 0, -1) : mountGroup(cx, cz, dx, dz);
      g.add(new THREE.Mesh((free ? post : sconce).clone(), materials().vertex));
      g.updateMatrixWorld(true);
      const local = free ? tmpV.set(0, GEOMETRY.fixtureHeight + BULB.h / 2 - 0.05, 0) : tmpV.set(BULB.x + BULB.w / 2, BULB.y + BULB.h / 2, BULB.z + BULB.d / 2);
      local.applyMatrix4(g.matrixWorld);
      tmpM.compose(local, tmpQ.setFromAxisAngle(UP, g.rotation.y), tmpS.set(1, 1, 1));
      this.bulbMesh.setMatrixAt(bulbIdx, tmpM);
      g.userData.bulbIndex = bulbIdx;
      if (circuit >= 0) {
        const mat = new THREE.MeshBasicMaterial({ map: circuitTagTexture(circuit), transparent: true });
        this.ownedMaterials.push(mat);
        const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15), mat);
        tag.position.set(0, GEOMETRY.fixtureHeight + 0.3, free ? 0.05 : -0.46);
        g.add(tag);
      }
      return g;
    };
    for (const f of level.fixtures) {
      const g = place(f.cx, f.cz, f.mount.dx, f.mount.dz, f.id, f.circuit);
      const wallCell = (f.cz + f.mount.dz) * level.w + (f.cx + f.mount.dx);
      if (f.mount.dx === 0 && f.mount.dz === 0) this.root.add(g);
      else this.attach(wallCell, g);
      let marker: THREE.Sprite | null = null;
      if (this.world.setup.faults.includes(f.id)) {
        const mat = new THREE.SpriteMaterial({ map: iconTexture('repair'), depthTest: false, transparent: true });
        this.ownedMaterials.push(mat);
        marker = new THREE.Sprite(mat);
        marker.scale.set(0.55, 0.55, 1);
        marker.position.set(f.cx + 0.5, 2.0, f.cz + 0.5);
        marker.renderOrder = 10;
        this.root.add(marker);
      }
      this.fixtures.push({ bulbIndex: f.id, ignite: 10, wasLit: false, marker });
    }
    nookEmergency.forEach((m, i) => {
      const g = place(m.cx, m.cz, m.dx, m.dz, level.fixtures.length + i, -1);
      this.attach((m.cz + m.dz) * level.w + (m.cx + m.dx), g);
      this.bulbMesh.setColorAt(level.fixtures.length + i, tmpC.setRGB(...PALETTE.bulbNook));
    });
    for (const f of level.fixtures) this.bulbMesh.setColorAt(f.id, tmpC.setRGB(...PALETTE.bulbOff));
    for (let i = 0; i < count; i++) {
      const matrix = new THREE.Matrix4();
      this.bulbMesh.getMatrixAt(i, matrix);
      this.bulbTransforms.push(matrix);
    }
    this.root.add(this.bulbMesh);
    sconce.dispose();
    post.dispose();
  }

  /** Emergency lamps: one in the nook and one on the exit landing (always on). */
  private emergencyMounts(): { cx: number; cz: number; dx: number; dz: number }[] {
    const { level } = this;
    const out: { cx: number; cz: number; dx: number; dz: number }[] = [];
    const pick = (cells: number[]): void => {
      for (const c of cells) {
        const x = c % level.w;
        const z = Math.floor(c / level.w);
        if (level.fixtures.some((f) => f.cell === c) || level.switches.some((s) => s.cell === c)) continue;
        if (level.kind[c - level.w] === K.Wall) {
          out.push({ cx: x, cz: z, dx: 0, dz: -1 });
          return;
        }
      }
    };
    pick(level.nookCells);
    pick(level.landingCells);
    return out;
  }

  private buildSwitches(): void {
    const { level } = this;
    const housing = switchHousingGeometry();
    for (const s of level.switches) {
      const g = mountGroup(s.cx, s.cz, s.mount.dx, s.mount.dz);
      g.add(new THREE.Mesh(housing.clone(), materials().vertex));
      const mat = new THREE.MeshLambertMaterial({ color: PALETTE.leverOff, emissive: 0x000000 });
      this.ownedMaterials.push(mat);
      const lever = new THREE.Mesh(leverGeometry(), mat);
      lever.position.set(0, 0.8, -0.38);
      g.add(lever);
      const tagMat = new THREE.MeshBasicMaterial({ map: circuitTagTexture(s.circuit), transparent: true });
      this.ownedMaterials.push(tagMat);
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.19), tagMat);
      tag.position.set(0, 1.12, -0.39);
      g.add(tag);
      this.attach((s.cz + s.mount.dz) * level.w + (s.cx + s.mount.dx), g);
      this.levers.push({ mesh: lever, mat, circuit: s.circuit, angle: 0.6 });
    }
    housing.dispose();
  }

  private buildDecor(rng: Rng): void {
    const { level } = this;
    const w = level.w;
    // A few frames/clocks on north walls facing the camera.
    const candidates: number[] = [];
    for (let i = w; i < level.w * level.h; i++) {
      if (!level.walk[i] || level.kind[i - w] !== K.Wall) continue;
      if (level.fixtures.some((f) => f.cell === i) || level.switches.some((s) => s.cell === i)) continue;
      if (level.zone[i] !== ZONE.None) continue;
      candidates.push(i);
    }
    rng.shuffle(candidates);
    const count = Math.min(candidates.length, 9);
    for (let k = 0; k < count; k++) {
      const c = candidates[k];
      const g = mountGroup(c % w, Math.floor(c / w), 0, -1);
      const decor = new THREE.Mesh(decorGeometry(rng.next() < 0.75 ? 0 : 1, rng), materials().vertex);
      decor.scale.setScalar(1.25);
      g.add(decor);
      this.attach(c - w, g);
      g.updateMatrixWorld(true);
    }
  }

  /** Architectural dressing lives on existing walls/floors, keeping all routes unchanged. */
  private buildArchitecture(rng: Rng): void {
    const { level } = this;
    const foundation = new VoxelBuilder();
    const details = new VoxelBuilder();
    for (let z = 0; z < level.h; z++) for (let x = 0; x < level.w; x++) {
      const c = z * level.w + x;
      if (level.kind[c] !== K.Wall || this.wallIndex.has(c)) {
        foundation.box(x, -0.34, z, 1, 0.32, 1, PALETTE.void);
        foundation.box(x, -0.08, z, 1, 0.06, 1, 0x39434a);
      }
      // Recessed windows and a sill on apartment back walls. Windows are decoration,
      // never a new light-safety source or a gap in the collision wall.
      if (level.kind[c] !== K.Room || level.kind[c - level.w] !== K.Wall) continue;
      if (x % 3 !== 1 || rng.next() < 0.3 || level.fixtures.some((f) => f.cell === c)) continue;
      const g = mountGroup(x, z, 0, -1);
      const vb = new VoxelBuilder()
        .box(-0.40, 0.82, -0.495, 0.80, 0.94, 0.06, PALETTE.woodDark)
        .box(-0.34, 0.89, -0.425, 0.68, 0.80, 0.015, 0x416575)
        .box(-0.02, 0.89, -0.402, 0.04, 0.80, 0.025, PALETTE.woodDark)
        .box(-0.34, 1.25, -0.402, 0.68, 0.04, 0.025, PALETTE.woodDark)
        .box(-0.44, 0.78, -0.48, 0.88, 0.07, 0.20, PALETTE.wood);
      const mesh = new THREE.Mesh(vb.build(), materials().vertex);
      g.add(mesh);
      this.attach(c - level.w, g);
      g.updateMatrixWorld(true);
    }
    for (const door of level.doors) for (const cell of door.cells) {
      const side = this.corridorSide(cell);
      if (!side) continue;
      const x = cell % level.w, z = Math.floor(cell / level.w);
      const mx = x + 0.5 + side.dx * 0.85, mz = z + 0.5 + side.dz * 0.85;
      const mw = side.dz ? 0.78 : 0.50, md = side.dz ? 0.50 : 0.78;
      details.quad(mx - mw / 2, 0.008, mz - md / 2, mw, md, 0x61462b);
      details.quad(mx - mw / 2 + 0.04, 0.010, mz - md / 2 + 0.04, mw - 0.08, md - 0.08, 0xa17c43);
      for (let j = 1; j < 5; j++) details.quad(mx - mw / 2 + 0.07, 0.012, mz - md / 2 + md * j / 6, mw - 0.14, 0.015, 0x73542e);
      // An open door leaf rests against the jamb, within the doorway's existing side post.
      if (door.open) {
        if (door.alongX) details.box(x + 0.04, 0, z + 0.08, 0.055, GEOMETRY.doorHeight, 0.80, PALETTE.doorWood);
        else details.box(x + 0.08, 0, z + 0.04, 0.80, GEOMETRY.doorHeight, 0.055, PALETTE.doorWood);
      }
    }
    const base = new THREE.Mesh(foundation.build(), materials().vertex);
    base.receiveShadow = true;
    this.root.add(base);
    if (!details.empty) {
      const mesh = new THREE.Mesh(details.build(), materials().vertex);
      this.surfaceLighting.register(mesh.geometry);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
  }

  private buildContactShadows(): void {
    const mat = new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0x080b10, transparent: true, opacity: 0.45, depthWrite: false });
    this.ownedMaterials.push(mat);
    const shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, this.level.props.length);
    tmpQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    this.level.props.forEach((p, i) => {
      tmpM.compose(tmpV.set((p.x0 + p.x1 + 1) / 2, 0.023, (p.z0 + p.z1 + 1) / 2), tmpQ, tmpS.set(p.x1 - p.x0 + 1.45, p.z1 - p.z0 + 1.45, 1));
      shadows.setMatrixAt(i, tmpM);
    });
    shadows.renderOrder = 3;
    this.root.add(shadows);
  }

  private buildTenant(rng: Rng): void {
    if (!this.world.tenantActive) return;
    const { level } = this;
    const spot = level.tenants[this.world.setup.tenant];
    const w = level.w;
    const px = (spot.porchCell % w) + 0.5;
    const pz = Math.floor(spot.porchCell / w) + 0.5;
    const dx = (spot.doorCell % w) + 0.5 - px;
    const dz = Math.floor(spot.doorCell / w) + 0.5 - pz;
    const rig = buildTenant(rng);
    rig.root.position.set(px + dx * 0.45, 0, pz + dz * 0.45);
    rig.root.rotation.y = Math.atan2(-dx, -dz);
    this.root.add(rig.root);
    this.tenant = rig;
    const mat = new THREE.SpriteMaterial({ map: iconTexture('help'), depthTest: false, transparent: true });
    this.ownedMaterials.push(mat);
    this.tenantMarker = new THREE.Sprite(mat);
    this.tenantMarker.scale.set(0.5, 0.5, 1);
    this.tenantMarker.position.set(px + dx * 0.45, 1.55, pz + dz * 0.45);
    this.tenantMarker.renderOrder = 10;
    this.root.add(this.tenantMarker);
  }

  private buildExit(): void {
    const { level } = this;
    const w = level.w;
    for (const cell of level.exitCells) {
      const x = cell % w;
      const z = Math.floor(cell / w);
      for (const [dx, dz] of [
        [0, -1],
        [-1, 0],
        [1, 0],
        [0, 1],
      ]) {
        const nb = (z + dz) * w + (x + dx);
        if (level.zone[nb] !== ZONE.Landing) continue;
        const g = mountGroup(x + dx, z + dz, -dx, -dz);
        g.add(new THREE.Mesh(exitDoorGeometry(1), materials().vertex));
        this.attach(cell, g);
      }
    }
    this.exitLightMat = new THREE.MeshBasicMaterial({ color: PALETTE.exitLocked, toneMapped: false });
    this.ownedMaterials.push(this.exitLightMat);
    this.exitLight = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), this.exitLightMat);
    this.exitLight.position.set(level.exitX, GEOMETRY.wallHeight + 0.08, level.exitZ);
    this.root.add(this.exitLight);
    const label = level.template.exitLabel;
    if (label) {
      const mat = new THREE.SpriteMaterial({ map: plaqueTexture(label), depthTest: false, transparent: true });
      this.ownedMaterials.push(mat);
      const s = new THREE.Sprite(mat);
      s.scale.set(0.8, 0.4, 1);
      s.position.set(level.exitX, GEOMETRY.wallHeight + 0.55, level.exitZ);
      s.renderOrder = 9;
      this.root.add(s);
    }
    const mat = new THREE.SpriteMaterial({ map: iconTexture('locked'), depthTest: false, transparent: true });
    this.ownedMaterials.push(mat);
    this.exitMarker = new THREE.Sprite(mat);
    this.exitMarker.scale.set(0.5, 0.5, 1);
    this.exitMarker.position.set(level.exitX, GEOMETRY.wallHeight + 1.05, level.exitZ);
    this.exitMarker.renderOrder = 10;
    this.root.add(this.exitMarker);
  }

  private buildOverlay(): THREE.ShaderMaterial {
    const { level } = this;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uMask: { value: this.maskTex },
        uGlow: { value: this.glowTex },
        uSize: { value: new THREE.Vector2(level.w, level.h) },
        uTime: { value: 0 },
        uReduced: { value: 0 },
        uSafe: { value: new THREE.Vector3(...PALETTE.safeFill) },
        uEdge: { value: new THREE.Vector3(...PALETTE.safeEdge) },
        uDark: { value: new THREE.Vector3(...PALETTE.darkTint) },
        uPreview: { value: new THREE.Vector3(...PALETTE.previewEdge) },
        uDebug: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMask;
        uniform sampler2D uGlow;
        uniform vec2 uSize;
        uniform float uTime;
        uniform float uReduced;
        uniform vec3 uSafe;
        uniform vec3 uEdge;
        uniform vec3 uDark;
        uniform vec3 uPreview;
        uniform float uDebug;
        varying vec2 vWorld;
        vec4 cellAt(vec2 c) { return texture2D(uMask, (c + 0.5) / uSize); }
        void main() {
          vec2 cell = floor(vWorld);
          vec2 f = vWorld - cell;
          vec4 m = cellAt(cell);
          if (m.b < 0.5) {
            if (uDebug > 0.5) { gl_FragColor = vec4(1.0, 0.1, 0.3, 0.45); return; }
            discard;
          }
          float prot = step(0.5, m.r);
          float fading = step(0.5, m.g);
          float preview = step(0.5, m.a);
          vec4 l = cellAt(cell + vec2(-1.0, 0.0));
          vec4 r = cellAt(cell + vec2(1.0, 0.0));
          vec4 u = cellAt(cell + vec2(0.0, -1.0));
          vec4 d = cellAt(cell + vec2(0.0, 1.0));
          float ew = 0.035;
          float edge = 0.0;
          if (prot > 0.5) {
            if (l.b > 0.5 && l.r < 0.5 && f.x < ew) edge = 1.0;
            if (r.b > 0.5 && r.r < 0.5 && f.x > 1.0 - ew) edge = 1.0;
            if (u.b > 0.5 && u.r < 0.5 && f.y < ew) edge = 1.0;
            if (d.b > 0.5 && d.r < 0.5 && f.y > 1.0 - ew) edge = 1.0;
          }
          float pedge = 0.0;
          if (preview > 0.5) {
            if (l.a < 0.5 && f.x < ew) pedge = 1.0;
            if (r.a < 0.5 && f.x > 1.0 - ew) pedge = 1.0;
            if (u.a < 0.5 && f.y < ew) pedge = 1.0;
            if (d.a < 0.5 && f.y > 1.0 - ew) pedge = 1.0;
          }
          float glow = texture2D(uGlow, vWorld / uSize).r;
          vec3 col;
          float a;
          if (prot > 0.5) {
            float pulse = 1.0;
            if (fading > 0.5) {
              // Slow, low-contrast pulse (about 1.5 Hz) – never rapid flashing.
              pulse = uReduced > 0.5 ? 0.55 : 0.5 + 0.35 * cos(uTime * 9.42);
            }
            col = uSafe * (0.85 + glow * 0.30);
            a = (0.025 + glow * 0.045) * pulse;
            if (edge > 0.5) {
              bool dash = fading > 0.5 && fract((vWorld.x + vWorld.y) * 2.0) < 0.5;
              col = uEdge;
              a = dash ? 0.10 : 0.62 * max(pulse, 0.6);
            }
          } else {
            col = uDark;
            a = 0.025;
          }
          if (pedge > 0.5 && fract((vWorld.x + vWorld.y) * 2.5) < 0.6) {
            col = uPreview;
            a = 0.75;
          }
          gl_FragColor = vec4(col, a);
        }`,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(level.w, level.h), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(level.w / 2, 0.015, level.h / 2);
    plane.renderOrder = 2;
    this.root.add(plane);
    return mat;
  }

  private computeWarmWeights(): void {
    const { level } = this;
    const w = level.w;
    const add = (list: { idx: number; w: number }[], cells: ArrayLike<number>, ox: number, oz: number, radius: number): void => {
      const best = new Map<number, number>();
      for (let k = 0; k < cells.length; k++) {
        const c = cells[k];
        for (const nb of [c + 1, c - 1, c + w, c - w]) {
          const idx = this.wallIndex.get(nb);
          if (idx === undefined) continue;
          const d = Math.hypot((nb % w) + 0.5 - ox, Math.floor(nb / w) + 0.5 - oz);
          const weight = Math.max(0.3, Math.min(1, 1.15 - d / (radius + 1.2)));
          best.set(idx, Math.max(best.get(idx) ?? 0, weight));
        }
      }
      for (const [idx, wt] of best) list.push({ idx, w: wt });
    };
    this.wallWarmWeights = level.fixtures.map((f) => {
      const list: { idx: number; w: number }[] = [];
      add(list, f.coverage, f.cx + 0.5, f.cz + 0.5, f.room ? 3.1 : 2.6);
      return list;
    });
    const em: number[] = [];
    for (let i = 0; i < level.w * level.h; i++) if (level.emergency[i]) em.push(i);
    const list: { idx: number; w: number }[] = [];
    add(list, em, -999, -999, 1);
    for (const e of list) e.w = 0.75;
    this.emergencyWarm = list;
  }

  // ------------------------------------------------------------------ update

  update(dt: number, flags: OverlayFlags, viewX: number, viewZ: number): void {
    const world = this.world;
    this.time += dt;
    this.overlayMat.uniforms.uTime.value = this.time;
    this.overlayMat.uniforms.uReduced.value = flags.reducedMotion ? 1 : 0;
    this.overlayMat.uniforms.uDebug.value = flags.debugCollision ? 1 : 0;

    if (world.prot.version !== this.lastProtVersion || flags.previewCircuit !== this.lastPreview) {
      this.lastProtVersion = world.prot.version;
      this.lastPreview = flags.previewCircuit;
      this.refreshMask(flags.previewCircuit);
      this.refreshWarmth();
    }
    this.updateBulbs(dt);
    this.updateWalls(dt, world.px, world.pz);
    this.updateLevers(dt);
    this.updateMarkers();
    this.assignLights(viewX, viewZ);
  }

  private refreshMask(preview: number): void {
    const { level, world } = this;
    const n = level.w * level.h;
    const md = this.maskData;
    const gd = this.glowData;
    gd.fill(0);
    for (let i = 0; i < n; i++) {
      md[i * 4] = world.prot.mask[i] ? 255 : 0;
      md[i * 4 + 1] = world.prot.fading[i] ? 255 : 0;
      md[i * 4 + 2] = level.walk[i] ? 255 : 0;
      md[i * 4 + 3] = 0;
    }
    for (const f of level.fixtures) {
      const lit = !world.broken[f.id] && world.circuits.on[f.circuit];
      if (preview === f.circuit && !world.broken[f.id]) for (const c of f.coverage) md[c * 4 + 3] = 255;
      if (!lit) continue;
      const r = f.room ? 3.1 : 2.6;
      for (const c of f.coverage) {
        const d = Math.hypot((c % level.w) - f.cx, Math.floor(c / level.w) - f.cz);
        const v = Math.round(255 * Math.max(0, 1 - d / (r + 0.6)) ** 0.8);
        if (v > gd[c * 4]) gd[c * 4] = v;
      }
    }
    for (let i = 0; i < n; i++) if (level.emergency[i] && gd[i * 4] < 150) gd[i * 4] = 150;
    this.maskTex.needsUpdate = true;
    this.glowTex.needsUpdate = true;
    this.surfaceLighting.refresh(gd);
  }

  private refreshWarmth(): void {
    const { level, world } = this;
    const warm = this.warm;
    warm.fill(0);
    for (const e of this.emergencyWarm) warm[e.idx] = Math.max(warm[e.idx], e.w);
    for (const f of level.fixtures) {
      if (world.broken[f.id] || !world.circuits.on[f.circuit]) continue;
      for (const e of this.wallWarmWeights[f.id]) if (e.w > warm[e.idx]) warm[e.idx] = e.w;
    }
    const [wr, wg, wb] = LIGHTING.wallWarm;
    const [cr, cg, cb] = LIGHTING.wallCool;
    for (let i = 0; i < this.walls.length; i++) {
      const t = warm[i];
      this.wallMesh.setColorAt(i, tmpC.setRGB(cr + (wr - cr) * t, cg + (wg - cg) * t, cb + (wb - cb) * t));
    }
    if (this.wallMesh.instanceColor) this.wallMesh.instanceColor.needsUpdate = true;
  }

  private updateBulbs(dt: number): void {
    const { level, world } = this;
    let dirty = false;
    for (const f of level.fixtures) {
      const v = this.fixtures[f.id];
      const powered = world.circuits.on[f.circuit];
      const pending = world.circuits.isPending(f.circuit);
      const broken = world.broken[f.id] === 1;
      const lit = powered && !broken;
      if (lit && !v.wasLit) v.ignite = 0;
      v.wasLit = lit;
      v.ignite += dt;
      let c: [number, number, number];
      if (broken) c = PALETTE.bulbBroken;
      else if (!powered) c = PALETTE.bulbOff;
      else {
        let k = 1;
        if (v.ignite < ANIMATION.bulbIgnite) {
          const t = v.ignite / ANIMATION.bulbIgnite;
          k = t < 0.3 ? t * 2 : t < 0.45 ? 0.35 : t;
        }
        if (pending) k *= 0.55 + 0.45 * Math.cos(this.time * 9.42);
        const on = PALETTE.bulbOn;
        const off = PALETTE.bulbOff;
        c = [off[0] + (on[0] - off[0]) * k, off[1] + (on[1] - off[1]) * k, off[2] + (on[2] - off[2]) * k];
      }
      this.bulbMesh.setColorAt(v.bulbIndex, tmpC.setRGB(c[0], c[1], c[2]));
      dirty = true;
    }
    if (dirty && this.bulbMesh.instanceColor) this.bulbMesh.instanceColor.needsUpdate = true;
  }

  private updateWalls(dt: number, px: number, pz: number): void {
    const cdx = Math.sin(CAMERA.yaw);
    const cdz = Math.cos(CAMERA.yaw);
    const rx = Math.cos(CAMERA.yaw);
    const rz = -Math.sin(CAMERA.yaw);
    const k = Math.min(1, dt * ANIMATION.wallCutSpeed);
    let dirty = false;
    for (let i = 0; i < this.walls.length; i++) {
      const w = this.walls[i];
      const ox = w.x + 0.5 - px;
      const oz = w.z + 0.5 - pz;
      const fwd = ox * cdx + oz * cdz;
      const lat = ox * rx + oz * rz;
      const cut = fwd > -0.4 && fwd < GEOMETRY.cutForward && Math.abs(lat) < GEOMETRY.cutLateral + fwd * 0.25;
      w.target = cut ? GEOMETRY.wallCutHeight : GEOMETRY.wallHeight;
      if (Math.abs(w.height - w.target) > 0.002) {
        w.height += (w.target - w.height) * k;
        if (Math.abs(w.height - w.target) <= 0.002) w.height = w.target;
        this.setWallMatrix(this.wallMesh, i, w);
        const show = w.height > 0.95;
        for (const a of w.attachments) {
          a.visible = show;
          const bulbIndex = a.userData.bulbIndex;
          if (typeof bulbIndex === 'number') {
            this.bulbMesh.setMatrixAt(bulbIndex, show ? this.bulbTransforms[bulbIndex] : tmpM.makeScale(0, 0, 0));
            this.bulbMesh.instanceMatrix.needsUpdate = true;
          }
        }
        dirty = true;
      }
    }
    if (dirty) this.wallMesh.instanceMatrix.needsUpdate = true;
  }

  private updateLevers(dt: number): void {
    const world = this.world;
    for (const l of this.levers) {
      const on = world.circuits.on[l.circuit];
      const pending = world.circuits.isPending(l.circuit as 0 | 1 | 2);
      const target = on && !pending ? -0.6 : 0.6;
      l.angle += (target - l.angle) * Math.min(1, dt * 14);
      l.mesh.rotation.x = l.angle;
      l.mat.color.setHex(on ? PALETTE.leverOn : PALETTE.leverOff);
      l.mat.emissive.setHex(on ? 0x5a3a08 : 0x000000);
    }
  }

  private updateMarkers(): void {
    const world = this.world;
    const bob = Math.sin(this.time * 3) * 0.06;
    for (const f of this.level.fixtures) {
      const v = this.fixtures[f.id];
      if (!v.marker) continue;
      v.marker.visible = world.broken[f.id] === 1;
      v.marker.position.y = 1.95 + bob;
    }
    if (this.tenantMarker) {
      const helped = world.tenantHelped;
      const mat = this.tenantMarker.material as THREE.SpriteMaterial;
      const tex = iconTexture(helped ? 'helped' : 'help');
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
      this.tenantMarker.position.y = 1.5 + bob;
    }
    if (this.tenant) {
      this.tenant.armR.rotation.x = world.tenantHelped ? -2.4 + Math.sin(this.time * 8) * 0.3 : Math.sin(this.time * 1.5) * 0.05;
      this.tenant.body.position.y = Math.sin(this.time * 2) * 0.01;
    }
    const exitTex = iconTexture(world.exitUnlocked ? 'exit' : 'locked');
    const em = this.exitMarker.material as THREE.SpriteMaterial;
    if (em.map !== exitTex) {
      em.map = exitTex;
      em.needsUpdate = true;
    }
    this.exitMarker.position.y = GEOMETRY.wallHeight + 1.0 + bob;
    this.exitLightMat.color.setHex(world.exitUnlocked ? PALETTE.exitOpen : PALETTE.exitLocked);
  }

  /** Point the pooled warm lights at the powered fixtures nearest the view centre. */
  private assignLights(viewX: number, viewZ: number): void {
    const { level, world } = this;
    const cands = this.lightCandidates;
    cands.length = 0;
    for (const e of this.emergencyLights) cands.push({ x: e.x, z: e.z, d: (e.x - viewX) ** 2 + (e.z - viewZ) ** 2 });
    for (const f of level.fixtures) {
      if (world.broken[f.id] || !world.circuits.on[f.circuit]) continue;
      const x = f.cx + 0.5 + f.mount.dx * 0.60;
      const z = f.cz + 0.5 + f.mount.dz * 0.60;
      cands.push({ x, z, d: (x - viewX) ** 2 + (z - viewZ) ** 2 });
    }
    cands.sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      const c = cands[i];
      if (c) {
        l.position.set(c.x, GEOMETRY.fixtureHeight + 0.2, c.z);
        l.intensity = LIGHTING.warmIntensity;
      } else l.intensity = 0;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    disposeObject(this.root);
    for (const m of this.ownedMaterials) m.dispose();
    this.overlayMat.dispose();
    this.maskTex.dispose();
    this.glowTex.dispose();
    this.wallMesh.dispose();
    this.bulbMesh.dispose();
  }
}
