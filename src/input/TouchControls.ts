// Virtual joystick (lower left, floating origin) and contextual action button (lower right).
// Each control owns its own pointer id with pointer capture, so move + action work together.

import type { InteractKind } from '../game/types';
import type { Input } from './Input';
import { ICONS } from '../ui/icons';
import { STR } from '../ui/strings';

const RADIUS = 56;
const DEADZONE = 0.14;

export type TouchMode = 'auto' | 'on' | 'off';

export class TouchControls {
  readonly root: HTMLDivElement;
  private readonly zone: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private readonly icon: HTMLSpanElement;
  private readonly label: HTMLSpanElement;
  private readonly ring: SVGCircleElement;
  private stickId = -1;
  private buttonId = -1;
  private ox = 0;
  private oy = 0;
  private sawTouch = false;
  private mode: TouchMode = 'auto';
  private kind: InteractKind | null | undefined = undefined;

  constructor(
    parent: HTMLElement,
    private readonly input: Input,
  ) {
    this.root = el('div', 'touch');
    this.zone = el('div', 'touch-zone');
    this.base = el('div', 'stick-base');
    this.knob = el('div', 'stick-knob');
    this.base.appendChild(this.knob);
    this.zone.appendChild(this.base);
    this.button = document.createElement('button');
    this.button.className = 'action-btn';
    this.button.type = 'button';
    this.button.tabIndex = -1;
    this.button.setAttribute('aria-label', STR.action.none);
    this.icon = el('span', 'action-icon');
    this.label = el('span', 'action-label');
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.classList.add('action-ring');
    this.ring = document.createElementNS(svgNS, 'circle');
    this.ring.setAttribute('cx', '50');
    this.ring.setAttribute('cy', '50');
    this.ring.setAttribute('r', '46');
    svg.appendChild(this.ring);
    this.button.append(svg, this.icon);
    this.root.append(this.zone, this.button, this.label);
    parent.appendChild(this.root);
    this.resetStick();
    this.setKind(null, 0);

    this.zone.addEventListener('pointerdown', (e) => this.stickDown(e));
    this.zone.addEventListener('pointermove', (e) => this.stickMove(e));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      this.zone.addEventListener(t, (e) => {
        if (e.pointerId === this.stickId) this.stickUp();
      });
    }
    this.button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.buttonId = e.pointerId;
      this.button.setPointerCapture(e.pointerId);
      this.button.classList.add('pressed');
      this.input.setTouchAction(true);
    });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      this.button.addEventListener(t, (e) => {
        if (e.pointerId !== this.buttonId) return;
        this.buttonId = -1;
        this.button.classList.remove('pressed');
        this.input.setTouchAction(false);
      });
    }
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && !this.sawTouch) {
        this.sawTouch = true;
        this.refreshVisibility();
      }
    });
    // Safety net: if a release lands elsewhere (lost capture, finger slid off-screen), still let go.
    for (const t of ['pointerup', 'pointercancel'] as const) {
      window.addEventListener(t, (e) => {
        if (e.pointerId === this.stickId) this.stickUp();
        if (e.pointerId === this.buttonId) {
          this.buttonId = -1;
          this.button.classList.remove('pressed');
          this.input.setTouchAction(false);
        }
      });
    }
    for (const t of ['touchend', 'touchcancel'] as const) {
      document.addEventListener(t, (e) => {
        if (e.touches.length === 0) this.release();
      });
    }
    window.addEventListener('orientationchange', () => this.release());
    window.addEventListener('blur', () => this.release());
  }

  setMode(mode: TouchMode): void {
    this.mode = mode;
    this.refreshVisibility();
  }

  /** Touch controls show on touch-capable devices (including wide tablets), with a manual override. */
  get visible(): boolean {
    if (this.mode === 'on') return true;
    if (this.mode === 'off') return false;
    const coarse = typeof matchMedia === 'function' && matchMedia('(any-pointer: coarse)').matches;
    return coarse || navigator.maxTouchPoints > 0 || this.sawTouch;
  }

  private refreshVisibility(): void {
    this.root.classList.toggle('hidden', !this.visible);
    document.body.classList.toggle('touch-ui', this.visible);
  }

  setEnabled(on: boolean): void {
    this.root.classList.toggle('disabled', !on);
    if (!on) this.release();
  }

  /** Update the contextual button for the highlighted target and repair progress (0..1). */
  setKind(kind: InteractKind | null, progress: number): void {
    if (kind !== this.kind) {
      this.kind = kind;
      this.button.dataset.kind = kind ?? 'none';
      this.icon.innerHTML = kind ? ICONS[kind] : '';
      this.label.textContent = kind ? STR.action[kind] : '';
      this.button.setAttribute('aria-label', kind ? STR.action[kind] : STR.action.none);
    }
    const c = 2 * Math.PI * 46;
    this.ring.style.strokeDasharray = `${c}`;
    this.ring.style.strokeDashoffset = `${c * (1 - progress)}`;
  }

  /** Release both controls (cancel, blur, orientation change, overlays). */
  release(): void {
    if (this.stickId >= 0) this.stickUp();
    if (this.buttonId >= 0) {
      this.buttonId = -1;
      this.button.classList.remove('pressed');
    }
    this.input.setTouchAction(false);
    this.input.setTouchMove(0, 0);
  }

  private stickDown(e: PointerEvent): void {
    if (this.stickId >= 0) return;
    e.preventDefault();
    this.stickId = e.pointerId;
    this.zone.setPointerCapture(e.pointerId);
    const r = this.zone.getBoundingClientRect();
    // Floating origin: the stick centres where the thumb lands (kept inside the zone).
    this.ox = Math.min(Math.max(e.clientX - r.left, RADIUS + 8), r.width - RADIUS - 8);
    this.oy = Math.min(Math.max(e.clientY - r.top, RADIUS + 8), r.height - RADIUS - 8);
    this.base.style.left = `${this.ox}px`;
    this.base.style.top = `${this.oy}px`;
    this.base.classList.add('active');
    this.stickMove(e);
  }

  private stickMove(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    const r = this.zone.getBoundingClientRect();
    let dx = e.clientX - r.left - this.ox;
    let dy = e.clientY - r.top - this.oy;
    const d = Math.hypot(dx, dy);
    if (d > RADIUS) {
      dx = (dx / d) * RADIUS;
      dy = (dy / d) * RADIUS;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    let mx = dx / RADIUS;
    let my = -dy / RADIUS;
    const m = Math.hypot(mx, my);
    if (m < DEADZONE) {
      mx = 0;
      my = 0;
    } else {
      // Rescale past the deadzone; push to full speed near the rim for a forgiving feel.
      const k = Math.min(1, ((m - DEADZONE) / (1 - DEADZONE)) * 1.25) / m;
      mx *= k;
      my *= k;
    }
    this.input.setTouchMove(mx, my);
  }

  private stickUp(): void {
    this.stickId = -1;
    this.input.setTouchMove(0, 0);
    this.resetStick();
  }

  private resetStick(): void {
    this.knob.style.transform = 'translate(0px, 0px)';
    this.base.classList.remove('active');
    this.base.style.left = '';
    this.base.style.top = '';
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
