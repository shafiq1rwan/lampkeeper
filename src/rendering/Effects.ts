// Pooled visual effects: repair sparks, shadow smoke, sound ripples and the guide path.
// All buffers are preallocated; nothing allocates per frame.

import * as THREE from 'three';
import { EFFECTS, PALETTE } from './theme';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();

class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private next = 0;

  constructor(
    private readonly count: number,
    material: THREE.Material,
    private readonly gravity: number,
  ) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.size = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      tmpM.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, tmpM);
      this.mesh.setColorAt(i, tmpC.setHex(0xffffff));
    }
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.mesh.setColorAt(i, tmpC.setHex(color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] += this.gravity * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const s = this.life[i] > 0 ? this.size[i] * (0.3 + 0.7 * k) : 0;
      tmpM.compose(tmpV.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]), tmpQ.identity(), tmpS.set(s, s, s));
      this.mesh.setMatrixAt(i, tmpM);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    tmpM.makeScale(0, 0, 0);
    for (let i = 0; i < this.count; i++) this.mesh.setMatrixAt(i, tmpM);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}

export class Effects {
  readonly root = new THREE.Group();
  private readonly sparks: ParticlePool;
  private readonly smoke: ParticlePool;
  private readonly sparkMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  private readonly smokeMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false });
  private readonly ripples: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number }[] = [];
  private readonly dashMesh: THREE.InstancedMesh;
  private readonly dashMat = new THREE.MeshBasicMaterial({ color: PALETTE.guide, transparent: true, opacity: 0.85, toneMapped: false });
  private readonly ringGeom = new THREE.RingGeometry(0.42, 0.5, 40);
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.sparks = new ParticlePool(EFFECTS.sparkCount, this.sparkMat, -6);
    this.smoke = new ParticlePool(EFFECTS.smokeCount, this.smokeMat, 0.6);
    this.root.add(this.sparks.mesh, this.smoke.mesh);
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(this.ringGeom, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.root.add(mesh);
      this.ripples.push({ mesh, mat, t: 10 });
    }
    this.dashMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.02, 0.09), this.dashMat, EFFECTS.guideDashes);
    this.dashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dashMesh.count = 0;
    this.dashMesh.frustumCulled = false;
    this.dashMesh.renderOrder = 5;
    this.root.add(this.dashMesh);
    scene.add(this.root);
  }

  burstSparks(x: number, y: number, z: number, reduced: boolean): void {
    const n = reduced ? 8 : 18;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.8 + Math.random() * 1.6;
      this.sparks.emit(x, y, z, Math.cos(a) * s, 1.5 + Math.random() * 2, Math.sin(a) * s, 0.5 + Math.random() * 0.4, 0.06, Math.random() < 0.5 ? PALETTE.sparks : 0xffffff);
    }
  }

  /** Continuous dark wisps where the shadow is forming or fading. */
  smokeAt(x: number, z: number, rate: number, dt: number): void {
    const n = Math.random() < rate * dt ? 1 : 0;
    for (let i = 0; i < n; i++) {
      this.smoke.emit(x + (Math.random() - 0.5) * 0.7, 0.1 + Math.random() * 0.6, z + (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.3, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.3, 1.1, 0.22, PALETTE.smoke);
    }
  }

  /** Expanding ring marking a noise the creature may investigate. */
  ripple(x: number, z: number): void {
    const r = this.ripples.find((p) => p.t >= 1) ?? this.ripples[0];
    r.t = 0;
    r.mesh.position.set(x, 0.03, z);
    r.mesh.visible = true;
  }

  /** Dashed guide along a path of world points (x, z pairs). */
  setGuide(points: Float32Array, count: number): void {
    const n = Math.min(count, EFFECTS.guideDashes);
    for (let i = 0; i < n; i++) {
      const x = points[i * 2];
      const z = points[i * 2 + 1];
      const nx = i + 1 < count ? points[i * 2 + 2] : x;
      const nz = i + 1 < count ? points[i * 2 + 3] : z;
      const yaw = Math.atan2(nx - x, nz - z) + Math.PI / 2;
      tmpM.compose(tmpV.set(x, 0.035, z), tmpQ.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), tmpS.set(1, 1, 1));
      this.dashMesh.setMatrixAt(i, tmpM);
    }
    this.dashMesh.count = n;
    this.dashMesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    this.time += dt;
    this.sparks.update(dt);
    this.smoke.update(dt);
    for (const r of this.ripples) {
      if (r.t >= 1) continue;
      r.t += dt / 1.2;
      const s = 0.6 + r.t * 3.2;
      r.mesh.scale.set(s, s, s);
      r.mat.opacity = 0.6 * (1 - r.t);
      if (r.t >= 1) r.mesh.visible = false;
    }
    this.dashMat.opacity = 0.55 + 0.25 * Math.sin(this.time * 3);
  }

  clear(): void {
    this.sparks.clear();
    this.smoke.clear();
    for (const r of this.ripples) {
      r.t = 10;
      r.mesh.visible = false;
    }
    this.dashMesh.count = 0;
  }
}
