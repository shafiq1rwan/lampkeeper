// Compact HUD over the canvas. Writes to the DOM only when values change.

import { ICONS } from './icons';
import { STR } from './strings';

export interface HudState {
  repairs: number;
  required: number;
  exitOpen: boolean;
  on: readonly boolean[];
  pending: readonly boolean[];
  used: number;
  capacity: number;
  safe: boolean;
  /** Screen position for the contextual hint, or null. */
  hint: { x: number; y: number; text: string; sub: string; progress: number } | null;
  /** Direction (screen radians) from player to threat when it is warning/chasing, or null. */
  threat: { x: number; y: number; angle: number; level: number } | null;
}

const set = (el: HTMLElement, text: string): void => {
  if (el.textContent !== text) el.textContent = text;
};

export class Hud {
  readonly root: HTMLDivElement;
  readonly pauseButton: HTMLButtonElement;
  private readonly repairsEl: HTMLSpanElement;
  private readonly repairsLabel: HTMLSpanElement;
  private readonly statusEl: HTMLDivElement;
  private readonly powerCount: HTMLSpanElement;
  private readonly chips: HTMLDivElement[] = [];
  private readonly hintEl: HTMLDivElement;
  private readonly hintText: HTMLDivElement;
  private readonly hintSub: HTMLDivElement;
  private readonly hintRing: SVGCircleElement;
  private readonly threatEl: HTMLDivElement;
  private readonly toastBox: HTMLDivElement;
  private readonly storyEl: HTMLDivElement;
  readonly tutorialEl: HTMLDivElement;
  private readonly tutorialText: HTMLDivElement;
  readonly tutorialSkip: HTMLButtonElement;
  private readonly keysEl: HTMLDivElement;
  private last = '';
  private storyTimer = 0;

  constructor(parent: HTMLElement) {
    this.root = div('hud hidden');
    const tl = div('hud-tl');
    tl.appendChild(div('hud-title', STR.title));
    const rep = div('hud-repairs');
    rep.innerHTML = ICONS.lamp;
    this.repairsLabel = span('', STR.repairs);
    this.repairsEl = span('hud-count', '0 / 3');
    rep.append(this.repairsLabel, this.repairsEl);
    tl.appendChild(rep);
    this.statusEl = div('hud-status');
    tl.appendChild(this.statusEl);

    const tc = div('hud-tc');
    const pw = div('hud-power');
    pw.append(span('hud-power-label', STR.power), (this.powerCount = span('hud-count', '0 / 2')));
    tc.appendChild(pw);
    const chips = div('hud-chips');
    for (let c = 0; c < 3; c++) {
      const chip = div('chip');
      chip.innerHTML = `<span class="chip-sym">${STR.circuitSymbol[c]}</span><span class="chip-letter">${STR.circuit[c]}</span>`;
      chips.appendChild(chip);
      this.chips.push(chip);
    }
    tc.appendChild(chips);

    this.pauseButton = document.createElement('button');
    this.pauseButton.className = 'hud-pause';
    this.pauseButton.type = 'button';
    this.pauseButton.innerHTML = ICONS.pause;
    this.pauseButton.setAttribute('aria-label', STR.pause.title);

    this.hintEl = div('hud-hint hidden');
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 40 40');
    svg.classList.add('hint-ring');
    this.hintRing = document.createElementNS(svgNS, 'circle');
    this.hintRing.setAttribute('cx', '20');
    this.hintRing.setAttribute('cy', '20');
    this.hintRing.setAttribute('r', '16');
    svg.appendChild(this.hintRing);
    const hintBody = div('hint-body');
    this.hintText = div('hint-text');
    this.hintSub = div('hint-sub');
    hintBody.append(this.hintText, this.hintSub);
    this.hintEl.append(svg, hintBody);

    this.threatEl = div('hud-threat hidden');
    this.threatEl.innerHTML = `<div class="threat-arrow"></div><div class="threat-eye">${ICONS.eye}</div>`;

    this.toastBox = div('hud-toasts');
    this.storyEl = div('hud-story hidden');
    this.tutorialEl = div('hud-tutorial hidden');
    this.tutorialText = div('tutorial-text');
    this.tutorialSkip = document.createElement('button');
    this.tutorialSkip.type = 'button';
    this.tutorialSkip.className = 'tutorial-skip';
    this.tutorialSkip.textContent = STR.tutorial.skip;
    this.tutorialEl.append(this.tutorialText, this.tutorialSkip);
    this.keysEl = div('hud-keys', 'WASD / ←↑→↓ move · E / Space act · Esc pause');

    this.root.append(tl, tc, this.pauseButton, this.hintEl, this.threatEl, this.toastBox, this.tutorialEl, this.storyEl, this.keysEl);
    parent.appendChild(this.root);
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }

  update(s: HudState, dt: number): void {
    set(this.repairsLabel, s.exitOpen ? STR.exitOpen : STR.repairs);
    set(this.repairsEl, `${s.repairs} / ${s.required}`);
    this.repairsEl.classList.toggle('done', s.exitOpen);
    set(this.powerCount, `${s.used} / ${s.capacity}`);
    const sig = `${s.on.join()}|${s.pending.join()}|${s.safe}`;
    if (sig !== this.last) {
      this.last = sig;
      for (let c = 0; c < 3; c++) {
        this.chips[c].classList.toggle('on', s.on[c] && !s.pending[c]);
        this.chips[c].classList.toggle('pending', s.pending[c]);
      }
      this.statusEl.className = `hud-status ${s.safe ? 'safe' : 'dark'}`;
      this.statusEl.innerHTML = `${s.safe ? ICONS.lamp : ICONS.moon}<span>${s.safe ? STR.safe : STR.dark}</span>`;
    }

    if (s.hint) {
      this.hintEl.classList.remove('hidden');
      this.hintEl.style.transform = `translate(${Math.round(s.hint.x)}px, ${Math.round(s.hint.y)}px)`;
      set(this.hintText, s.hint.text);
      set(this.hintSub, s.hint.sub);
      this.hintSub.classList.toggle('hidden', !s.hint.sub);
      const c = 2 * Math.PI * 16;
      this.hintRing.style.strokeDasharray = `${c}`;
      this.hintRing.style.strokeDashoffset = `${c * (1 - s.hint.progress)}`;
      this.hintEl.classList.toggle('progress', s.hint.progress > 0);
    } else this.hintEl.classList.add('hidden');

    if (s.threat) {
      this.threatEl.classList.remove('hidden');
      this.threatEl.style.transform = `translate(${Math.round(s.threat.x)}px, ${Math.round(s.threat.y)}px)`;
      (this.threatEl.firstElementChild as HTMLElement).style.transform = `rotate(${s.threat.angle}rad)`;
      this.threatEl.classList.toggle('chase', s.threat.level > 0.5);
    } else this.threatEl.classList.add('hidden');

    if (this.storyTimer > 0) {
      this.storyTimer -= dt;
      if (this.storyTimer <= 0) this.storyEl.classList.add('hidden');
    }
  }

  toast(text: string, kind: 'info' | 'warn' | 'good' = 'info'): void {
    // Replace an identical visible toast rather than stacking duplicates.
    for (const t of Array.from(this.toastBox.children)) if (t.textContent === text) t.remove();
    const t = div(`toast ${kind}`, text);
    this.toastBox.prepend(t);
    while (this.toastBox.children.length > 2) this.toastBox.lastElementChild!.remove();
    setTimeout(() => t.classList.add('fade'), 2200);
    setTimeout(() => t.remove(), 2700);
  }

  story(title: string, text: string): void {
    this.storyEl.innerHTML = '';
    this.storyEl.append(div('story-title', title), div('story-text', text));
    this.storyEl.classList.remove('hidden');
    this.storyTimer = 6;
  }

  tutorial(text: string | null, canSkip = true): void {
    if (!text) {
      this.tutorialEl.classList.add('hidden');
      return;
    }
    set(this.tutorialText, text);
    this.tutorialSkip.classList.toggle('hidden', !canSkip);
    this.tutorialEl.classList.remove('hidden');
  }

  clearTransient(): void {
    this.toastBox.innerHTML = '';
    this.storyEl.classList.add('hidden');
    this.storyTimer = 0;
    this.hintEl.classList.add('hidden');
    this.threatEl.classList.add('hidden');
  }
}

function div(cls: string, text?: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
}

function span(cls: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}
