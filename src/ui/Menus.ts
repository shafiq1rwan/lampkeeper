// Overlay screens. One screen at a time; keyboard users move focus with arrows and use Enter.

import { RECORDS } from '../levels/story';
import type { SaveData, Settings } from '../platform/storage';
import { ICONS } from './icons';
import { STR } from './strings';

export interface ResultInfo {
  shift: number;
  repairs: number;
  tenant: 'none' | 'helped' | 'missed';
  time: number;
  seed: number;
  criteria: { label: string; met: boolean }[];
  newRecords: { title: string; text: string }[];
  hasNext: boolean;
}

export interface CaptureInfo {
  headline: string;
  detail: string;
}

type Handler = () => void;

export class Menus {
  readonly root: HTMLDivElement;
  current: string | null = null;
  private onEscape: Handler | null = null;
  private onAnyKey: Handler | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'overlay hidden';
    this.root.setAttribute('role', 'dialog');
    parent.appendChild(this.root);
    window.addEventListener('keydown', (e) => this.key(e));
  }

  get open(): boolean {
    return this.current !== null;
  }

  private key(e: KeyboardEvent): void {
    if (!this.current) return;
    if (e.code === 'Escape' && this.onEscape) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.onEscape();
      return;
    }
    if (this.onAnyKey && !['Tab', 'Escape', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'ControlLeft', 'MetaLeft'].includes(e.code)) {
      const t = e.target as HTMLElement;
      if (!(t instanceof HTMLButtonElement && this.root.contains(t) && (e.code === 'Enter' || e.code === 'Space'))) {
        if (!e.repeat) this.onAnyKey();
        return;
      }
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      const items = Array.from(this.root.querySelectorAll<HTMLElement>('button:not([disabled]), input'));
      if (items.length === 0) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      const dir = e.code === 'ArrowUp' || e.code === 'ArrowLeft' ? -1 : 1;
      items[(i + dir + items.length) % items.length].focus();
    }
  }

  hide(): void {
    this.current = null;
    this.onEscape = null;
    this.onAnyKey = null;
    this.root.onpointerdown = null;
    this.root.classList.add('hidden');
    this.root.className = 'overlay hidden';
    this.root.innerHTML = '';
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  private screen(name: string, cls: string, build: (panel: HTMLDivElement) => void, focusFirst = true): void {
    this.current = name;
    this.onEscape = null;
    this.onAnyKey = null;
    this.root.className = `overlay ${cls}`;
    this.root.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'panel';
    build(panel);
    this.root.appendChild(panel);
    if (focusFirst) {
      const first = panel.querySelector<HTMLElement>('button.primary, button');
      first?.focus({ preventScroll: true });
    }
  }

  // ---------------------------------------------------------------- screens

  showStart(info: { label: string; intro: string; touch: boolean; sessionOnly: boolean }, onStart: Handler, onShifts: Handler, onSettings: Handler): void {
    this.screen(
      'start',
      'start',
      (p) => {
        p.append(h('div', 'start-title', STR.title), h('div', 'start-shift', info.label), h('div', 'start-intro', info.intro));
        const go = h('div', 'start-go', info.touch ? STR.startTouch : STR.startKeys);
        p.appendChild(go);
        if (info.sessionOnly) p.appendChild(h('div', 'note', STR.sessionOnly));
        const row = h('div', 'row');
        row.append(button(STR.pause.shifts, onShifts, 'small'), button(STR.pause.settings, onSettings, 'small'));
        p.appendChild(row);
      },
      false,
    );
    this.onAnyKey = onStart;
    this.root.onpointerdown = (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      onStart();
    };
  }

  showPause(onResume: Handler, onRestart: Handler, onSettings: Handler, onRecords: Handler, onShifts: Handler): void {
    this.root.onpointerdown = null;
    this.screen('pause', 'dim', (p) => {
      p.append(h('h2', '', STR.pause.title));
      p.append(
        button(STR.pause.resume, onResume, 'primary'),
        button(STR.pause.restart, onRestart),
        button(STR.pause.settings, onSettings),
        button(STR.pause.records, onRecords),
        button(STR.pause.shifts, onShifts),
      );
    });
    this.onEscape = onResume;
  }

  showSettings(s: Settings, touchAvailable: boolean, onChange: (s: Settings) => void, onBack: Handler): void {
    this.root.onpointerdown = null;
    const draw = (): void =>
      this.screen('settings', 'dim', (p) => {
        p.append(h('h2', '', STR.settings.title));
        const opt = <T>(label: string, value: T, options: [T, string][], apply: (v: T) => void): void => {
          const row = h('div', 'setting');
          row.appendChild(h('span', 'setting-label', label));
          const group = h('div', 'seg');
          for (const [v, text] of options) {
            const b = button(text, () => {
              apply(v);
              onChange(s);
              draw();
              (this.root.querySelector(`[data-key="${label}"][data-val="${String(v)}"]`) as HTMLElement | null)?.focus();
            });
            b.dataset.key = label;
            b.dataset.val = String(v);
            b.classList.toggle('selected', v === value);
            b.setAttribute('aria-pressed', String(v === value));
            group.appendChild(b);
          }
          row.appendChild(group);
          p.appendChild(row);
        };
        opt(STR.settings.sound, !s.muted, [[true, STR.settings.on], [false, STR.settings.off]], (v) => (s.muted = !v));
        const levels: [number, string][] = [[0, '0'], [0.3, '1'], [0.6, '2'], [1, '3']];
        const near = (v: number): number => levels.reduce((b, l) => (Math.abs(l[0] - v) < Math.abs(b - v) ? l[0] : b), 0);
        opt(STR.settings.ambience, near(s.ambience), levels, (v) => (s.ambience = v));
        opt(STR.settings.effects, near(s.effects), levels, (v) => (s.effects = v));
        opt<Settings['quality']>(STR.settings.quality, s.quality, [['high', STR.settings.high], ['low', STR.settings.low]], (v) => (s.quality = v));
        opt(STR.settings.motion, s.reducedMotion, [[false, STR.settings.off], [true, STR.settings.on]], (v) => (s.reducedMotion = v));
        opt<Settings['scare']>(STR.settings.scare, s.scare, [['gentle', STR.settings.gentle], ['normal', STR.settings.normal]], (v) => (s.scare = v));
        if (touchAvailable || s.touch !== 'auto')
          opt<Settings['touch']>(STR.settings.touch, s.touch, [['auto', STR.settings.auto], ['on', STR.settings.on], ['off', STR.settings.off]], (v) => (s.touch = v));
        p.appendChild(button(STR.settings.back, onBack, 'primary'));
      });
    draw();
    this.onEscape = onBack;
  }

  showRecords(found: number[], onBack: Handler): void {
    this.root.onpointerdown = null;
    this.screen('records', 'dim', (p) => {
      p.append(h('h2', '', STR.records.title), h('div', 'note', STR.records.found(found.length)));
      const list = h('div', 'records');
      for (const r of RECORDS) {
        const has = found.includes(r.id);
        const item = h('div', `record ${has ? '' : 'locked'}`);
        item.append(h('div', 'record-title', has ? r.title : `${r.id}. ${STR.records.unknown}`));
        if (has) item.append(h('div', 'record-text', r.text));
        list.appendChild(item);
      }
      p.append(list, button(STR.records.back, onBack, 'primary'));
    });
    this.onEscape = onBack;
  }

  showShifts(save: SaveData, unlocked: number, onPick: (shift: number, seed?: number) => void, onBack: Handler): void {
    this.root.onpointerdown = null;
    this.screen('shifts', 'dim', (p) => {
      p.append(h('h2', '', STR.shifts.title));
      const grid = h('div', 'shift-grid');
      for (let n = 1; n <= 5; n++) {
        const done = save.completed.includes(n);
        const b = button(`${STR.shifts.shift(n)}${done ? ' ✓' : ''}`, () => onPick(n), n === unlocked ? 'primary' : '');
        if (n > unlocked) {
          b.disabled = true;
          b.textContent = `${STR.shifts.shift(n)} · ${STR.shifts.locked}`;
        }
        grid.appendChild(b);
      }
      p.appendChild(grid);
      const replay = h('div', 'replay-row');
      if (save.replayUnlocked) {
        const input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'numeric';
        input.placeholder = STR.shifts.seed;
        input.maxLength = 10;
        input.setAttribute('aria-label', STR.shifts.seed);
        replay.append(
          button(STR.shifts.replay, () => {
            const v = parseInt(input.value, 10);
            onPick(0, Number.isFinite(v) && v > 0 ? v >>> 0 : undefined);
          }),
          input,
        );
      } else replay.appendChild(h('div', 'note', STR.shifts.replayLocked));
      p.append(replay, button(STR.shifts.back, onBack));
    });
    this.onEscape = onBack;
  }

  showResults(r: ResultInfo, onNext: Handler, onReplay: Handler, onShifts: Handler): void {
    this.root.onpointerdown = null;
    this.screen('results', 'dim', (p) => {
      p.append(h('h2', '', STR.results.complete(r.shift)));
      const lamps = h('div', 'lamps');
      for (const c of r.criteria) {
        const l = h('div', `lamp ${c.met ? 'lit' : ''}`);
        l.innerHTML = ICONS.lamp;
        lamps.appendChild(l);
      }
      p.appendChild(lamps);
      const crit = h('ul', 'criteria');
      for (const c of r.criteria) crit.appendChild(h('li', c.met ? 'met' : '', `${c.met ? '✓' : '–'} ${c.label}`));
      p.appendChild(crit);
      const stats = h('div', 'stats');
      const tenant = r.tenant === 'none' ? STR.results.none : r.tenant === 'helped' ? STR.results.helped : STR.results.notHelped;
      stats.append(stat(STR.results.repairs, `${r.repairs} / 3`), stat(STR.results.tenant, tenant), stat(STR.results.time, formatTime(r.time)), stat(STR.results.seed, String(r.seed)));
      p.appendChild(stats);
      for (const rec of r.newRecords) {
        const box = h('div', 'new-record');
        box.append(h('div', 'record-title', `${STR.results.newRecord}: ${rec.title}`), h('div', 'record-text', rec.text));
        p.appendChild(box);
      }
      const row = h('div', 'row');
      if (r.hasNext) row.appendChild(button(STR.results.next, onNext, 'primary'));
      row.append(button(STR.results.replay, onReplay, r.hasNext ? '' : 'primary'), button(STR.results.shifts, onShifts));
      p.appendChild(row);
    });
  }

  showCapture(c: CaptureInfo, onRetry: Handler, onShifts: Handler): void {
    this.root.onpointerdown = null;
    this.screen('capture', 'capture', (p) => {
      p.append(h('h2', '', STR.capture.title), h('div', 'capture-head', c.headline), h('div', 'capture-detail', c.detail));
      const row = h('div', 'row');
      row.append(button(STR.capture.retry, onRetry, 'primary'), button(STR.capture.shifts, onShifts));
      p.appendChild(row);
    });
    this.onEscape = onRetry;
  }

  showEndingSkip(onSkip: Handler): void {
    this.root.onpointerdown = null;
    this.screen(
      'ending-skip',
      'ending-skip',
      (p) => {
        p.appendChild(button(STR.ending.skip, onSkip, 'small'));
      },
      false,
    );
    this.onEscape = onSkip;
  }

  showEnding(onReplay: Handler, onRecords: Handler, onShifts: Handler): void {
    this.root.onpointerdown = null;
    this.screen('ending', 'dim ending', (p) => {
      p.append(h('h2', '', STR.ending.title), h('div', 'ending-quote', RECORDS[5].text), h('div', 'note', STR.ending.body), h('div', 'note good', STR.ending.replayUnlocked));
      const row = h('div', 'row');
      row.append(button(STR.ending.replay, onReplay, 'primary'), button(STR.ending.records, onRecords), button(STR.ending.shifts, onShifts));
      p.appendChild(row);
    });
  }

  showError(msg: string, hint: string): void {
    this.root.onpointerdown = null;
    this.screen('error', 'dim', (p) => {
      p.append(h('h2', '', STR.title), h('div', 'capture-head', msg), h('div', 'note', hint), button(STR.error.reload, () => location.reload(), 'primary'));
    });
  }
}

export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(text: string, onClick: Handler, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  if (cls) b.className = cls;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function stat(label: string, value: string): HTMLDivElement {
  const d = h('div', 'stat');
  d.append(h('span', 'stat-label', label), h('span', 'stat-value', value));
  return d;
}
