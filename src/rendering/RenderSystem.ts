// WebGL renderer, scene lights, quality modes, bloom and context-loss handling.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CameraRig } from './CameraRig';
import { CAMERA, EFFECTS, LIGHTING, PALETTE } from './theme';

export type Quality = 'high' | 'low';

export class RenderSystem {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig = new CameraRig();
  readonly warmLights: THREE.PointLight[] = [];
  private readonly moon: THREE.DirectionalLight;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private quality: Quality = 'high';
  private width = 1;
  private height = 1;
  contextLost = false;
  onContextLost: () => void = () => {};
  onContextRestored: () => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.setClearColor(PALETTE.background, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(PALETTE.background);

    this.scene.add(new THREE.HemisphereLight(LIGHTING.hemiSky, LIGHTING.hemiGround, LIGHTING.hemiIntensity));
    this.moon = new THREE.DirectionalLight(LIGHTING.moonColor, LIGHTING.moonIntensity);
    this.moon.shadow.mapSize.set(1024, 1024);
    const sc = this.moon.shadow.camera;
    sc.left = -16;
    sc.right = 16;
    sc.top = 16;
    sc.bottom = -16;
    sc.near = 1;
    sc.far = 60;
    this.moon.shadow.bias = -0.0015;
    this.scene.add(this.moon, this.moon.target);

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.onContextLost();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.onContextRestored();
    });
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const pool = q === 'high' ? LIGHTING.warmPoolHigh : LIGHTING.warmPoolLow;
    while (this.warmLights.length < pool) {
      const l = new THREE.PointLight(LIGHTING.warmColor, 0, LIGHTING.warmDistance, 2);
      this.warmLights.push(l);
      this.scene.add(l);
    }
    while (this.warmLights.length > pool) this.warmLights.pop()!.removeFromParent();
    this.renderer.shadowMap.enabled = q === 'high';
    this.moon.castShadow = q === 'high';
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat) => (mat.needsUpdate = true));
    });
    if (q === 'high' && !this.composer) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.rig.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), EFFECTS.bloomStrength, EFFECTS.bloomRadius, EFFECTS.bloomThreshold);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.resize(this.width, this.height);
  }

  getQuality(): Quality {
    return this.quality;
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    const maxDpr = this.quality === 'high' ? CAMERA.maxPixelRatio : CAMERA.maxPixelRatioLow;
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.composer?.setPixelRatio(dpr);
    this.composer?.setSize(this.width, this.height);
    this.rig.resize(this.width, this.height);
  }

  render(): void {
    if (this.contextLost) return;
    // Keep the shadow frustum centred on the view.
    const tx = this.rig.targetX;
    const tz = this.rig.targetZ;
    this.moon.position.set(tx - 6, 18, tz + 10);
    this.moon.target.position.set(tx, 0, tz);
    this.renderer.info.reset();
    if (this.quality === 'high' && this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.rig.camera);
  }

  /** Project a world point to CSS pixels relative to the canvas. */
  project(x: number, y: number, z: number, out: { x: number; y: number; visible: boolean }): void {
    const v = projV.set(x, y, z).project(this.rig.camera);
    out.x = (v.x * 0.5 + 0.5) * this.width;
    out.y = (-v.y * 0.5 + 0.5) * this.height;
    out.visible = v.x >= -1 && v.x <= 1 && v.y >= -1 && v.y <= 1;
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }
}

const projV = new THREE.Vector3();

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
