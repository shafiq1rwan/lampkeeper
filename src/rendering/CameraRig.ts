// Orthographic three-quarter camera with stable tracking and viewport-aware framing.

import * as THREE from 'three';
import { CAMERA } from './theme';

export class CameraRig {
  readonly camera: THREE.OrthographicCamera;
  private tx = 0;
  private tz = 0;
  private aspect = 16 / 9;
  /** Extra zoom-out factor (e.g. for the ending). */
  zoom = 1;
  private currentZoom = 1;

  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  }

  /** Screen-up direction projected onto the floor (world x, z). */
  static forward(): { x: number; z: number } {
    return { x: -Math.sin(CAMERA.yaw), z: -Math.cos(CAMERA.yaw) };
  }

  static right(): { x: number; z: number } {
    return { x: Math.cos(CAMERA.yaw), z: -Math.sin(CAMERA.yaw) };
  }

  resize(width: number, height: number): void {
    this.aspect = Math.max(0.2, width / Math.max(1, height));
    this.applyFrustum();
  }

  private applyFrustum(): void {
    let vh = Math.max(CAMERA.viewHeight, CAMERA.minViewWidth / this.aspect);
    vh = Math.min(vh, CAMERA.maxViewHeight) * this.currentZoom;
    const vw = vh * this.aspect;
    const c = this.camera;
    c.left = -vw / 2;
    c.right = vw / 2;
    c.top = vh / 2;
    c.bottom = -vh / 2;
    c.updateProjectionMatrix();
  }

  snap(x: number, z: number): void {
    this.tx = x;
    this.tz = z;
    this.place();
  }

  follow(x: number, z: number, vx: number, vz: number, dt: number, reducedMotion: boolean): void {
    const ahead = reducedMotion ? 0 : CAMERA.lookAhead;
    const gx = x + vx * ahead;
    const gz = z + vz * ahead;
    const k = Math.min(1, dt * CAMERA.followLerp);
    this.tx += (gx - this.tx) * k;
    this.tz += (gz - this.tz) * k;
    if (Math.abs(this.zoom - this.currentZoom) > 0.001) {
      this.currentZoom += (this.zoom - this.currentZoom) * Math.min(1, dt * 2);
      this.applyFrustum();
    }
    this.place();
  }

  get targetX(): number {
    return this.tx;
  }

  get targetZ(): number {
    return this.tz;
  }

  private place(): void {
    const d = CAMERA.distance;
    const cp = Math.cos(CAMERA.pitch);
    this.camera.position.set(this.tx + Math.sin(CAMERA.yaw) * d * cp, d * Math.sin(CAMERA.pitch), this.tz + Math.cos(CAMERA.yaw) * d * cp);
    this.camera.lookAt(this.tx, 0, this.tz);
  }
}
