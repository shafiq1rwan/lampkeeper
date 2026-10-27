// Character presentation: animation driven by simulation state, never the other way round.

import * as THREE from 'three';
import type { Creature } from '../ai/Creature';
import { PLAYER } from '../game/config';
import type { World } from '../simulation/World';
import { buildCreature, buildPlayer, disposeObject, type CreatureRig, type PlayerRig } from './models';
import { ANIMATION, LIGHTING, PALETTE } from './theme';
import { blobTexture } from './textures';

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export interface PresentationSettings {
  reducedMotion: boolean;
  gentle: boolean;
}

export class PlayerView {
  readonly rig: PlayerRig;
  readonly lantern: THREE.PointLight;
  private phase = 0;
  private yaw = Math.PI;
  private repairT = 0;
  private raise = 0;

  constructor(scene: THREE.Scene) {
    this.rig = buildPlayer();
    this.rig.root.traverse((o) => {
      o.castShadow = true;
    });
    this.lantern = new THREE.PointLight(LIGHTING.lanternColor, LIGHTING.lanternIntensity, LIGHTING.lanternDistance, 2);
    this.lantern.position.set(0.32, 0.45, 0.18);
    this.rig.root.add(this.lantern);
    scene.add(this.rig.root);
  }

  /** Lift the lantern (used by the ending). 0..1 */
  setRaise(v: number): void {
    this.raise = v;
  }

  update(dt: number, w: World, s: PresentationSettings): void {
    const r = this.rig;
    r.root.position.set(w.px, 0, w.pz);
    let targetYaw = w.facing;
    if (w.repairing && w.target) targetYaw = Math.atan2(w.target.x - w.px, w.target.z - w.pz);
    this.yaw = lerpAngle(this.yaw, targetYaw, Math.min(1, dt * 14));
    r.root.rotation.y = this.yaw;

    const moving = w.pSpeed > 0.2;
    const speedK = Math.min(1.2, w.pSpeed / PLAYER.speed);
    if (moving) this.phase += dt * ANIMATION.stepRate * speedK;
    else this.phase *= 0.85;
    const swing = Math.sin(this.phase) * ANIMATION.walkSwing * speedK;
    r.legL.rotation.x = swing;
    r.legR.rotation.x = -swing;
    r.armL.rotation.x = -swing * 0.8;
    const bob = s.reducedMotion ? 0 : Math.abs(Math.sin(this.phase)) * ANIMATION.walkBob * speedK;
    r.body.position.y = bob;

    this.repairT = w.repairing ? this.repairT + dt : 0;
    if (w.repairing) {
      // Reach up and tinker: a small oscillating wrist motion.
      r.armL.rotation.x = -2.3 + Math.sin(this.repairT * 18) * (s.reducedMotion ? 0.05 : 0.18);
      r.head.rotation.x = -0.35;
    } else {
      r.head.rotation.x *= 0.8;
    }
    r.armR.rotation.x = -0.35 - swing * 0.3 - this.raise * 2.2;
    r.body.rotation.x = w.captured ? 0.25 : 0;
    this.lantern.intensity = LIGHTING.lanternIntensity * (1 + this.raise * 0.6);
  }

  dispose(): void {
    this.rig.root.removeFromParent();
    disposeObject(this.rig.root);
  }
}

export class CreatureView {
  readonly rig: CreatureRig;
  private readonly shadow: THREE.Mesh;
  private readonly shadowMat: THREE.MeshBasicMaterial;
  private phase = 0;
  private yaw = 0;
  private time = 0;
  /** Ending override: when set, the view is driven by the ending sequence, not the simulation. */
  ending: { x: number; z: number; yaw: number; opacity: number; alert: number } | null = null;

  constructor(scene: THREE.Scene) {
    this.rig = buildCreature();
    this.rig.root.traverse((o) => {
      o.castShadow = true;
    });
    this.shadowMat = new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.02;
    this.shadow.renderOrder = 3;
    this.rig.root.add(this.shadow);
    this.rig.root.visible = false;
    scene.add(this.rig.root);
  }

  update(dt: number, c: Creature, s: PresentationSettings): void {
    this.time += dt;
    const r = this.rig;
    if (this.ending) {
      const e = this.ending;
      r.root.visible = e.opacity > 0.01;
      r.root.position.set(e.x, 0, e.z);
      r.root.rotation.y = e.yaw;
      this.applyOpacity(e.opacity);
      this.pose(0, 0, e.alert, 0, s);
      return;
    }
    const visible = c.state !== 'inactive' && c.state !== 'gone';
    r.root.visible = visible;
    if (!visible) return;
    r.root.position.set(c.x, 0, c.z);
    this.yaw = lerpAngle(this.yaw, c.facing, Math.min(1, dt * 8));
    r.root.rotation.y = this.yaw;

    let opacity = 1;
    if (c.state === 'emerging') opacity = Math.min(1, c.t / c.tuning.emergeTime);
    else if (c.state === 'staged' && c.t < c.tuning.emergeTime) opacity = Math.min(1, c.t / c.tuning.emergeTime);
    else if (c.state === 'dissolving') opacity = Math.max(0, 1 - c.t / c.tuning.dissolveTime);
    else if (c.state === 'retreat') opacity = 0.7;
    this.applyOpacity(opacity);

    const alert = c.state === 'warn' ? Math.min(1, c.t / 0.25) : c.state === 'chase' || c.state === 'capturing' ? 1 : c.state === 'staged' && c.stagedPhase === 'watch' ? 0.6 : 0;
    const lean = c.state === 'chase' ? 0.22 : c.state === 'capturing' ? 0.45 : c.state === 'retreat' ? -0.18 : 0;
    const rise = c.state === 'warn' ? 0.06 : 0;
    this.phase += dt * 6 * Math.min(1.5, c.speed / 1.5);
    this.pose(c.speed, lean, alert, rise, s);
    if (c.state === 'capturing') {
      r.armL.rotation.x = -1.3;
      r.armR.rotation.x = -1.3;
    }
  }

  private pose(speed: number, lean: number, alert: number, rise: number, s: PresentationSettings): void {
    const r = this.rig;
    const swing = Math.sin(this.phase) * Math.min(0.6, speed * 0.25);
    r.legL.rotation.x = swing;
    r.legR.rotation.x = -swing;
    const sway = s.reducedMotion ? 0 : Math.sin(this.time * 1.7) * ANIMATION.creatureSway;
    r.armL.rotation.x = -swing * 0.6 + sway;
    r.armR.rotation.x = swing * 0.6 - sway;
    r.armL.rotation.z = -0.08 - alert * 0.25;
    r.armR.rotation.z = 0.08 + alert * 0.25;
    r.body.rotation.x = lean;
    r.body.position.y = rise + (s.reducedMotion ? 0 : Math.sin(this.time * 1.3) * 0.015);
    r.head.rotation.z = alert > 0 ? Math.sin(this.time * 2) * 0.05 : 0.12 * Math.sin(this.time * 0.6);
    const eyeScale = 1 + alert * (s.gentle ? 0.35 : 0.8);
    r.eyes.scale.set(eyeScale, eyeScale, 1);
    r.eyeMaterial.color.setHex(alert > 0.5 ? PALETTE.creatureEyeAlert : PALETTE.creatureEye);
  }

  private applyOpacity(o: number): void {
    this.rig.material.opacity = o;
    this.rig.material.depthWrite = o > 0.95;
    this.rig.eyeMaterial.opacity = o;
    this.shadowMat.opacity = 0.55 * o;
  }

  dispose(): void {
    this.rig.root.removeFromParent();
    disposeObject(this.rig.root, true);
  }
}
