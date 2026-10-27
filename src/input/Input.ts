// Input abstraction: keyboard and touch feed one movement vector (screen space) and one action.

export type InputDevice = 'keyboard' | 'touch' | 'mouse';

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};
const ACTION_KEYS = new Set(['KeyE', 'Space']);

export class Input {
  /** Screen-space movement: x right, y up. Magnitude ≤ 1. */
  moveX = 0;
  moveY = 0;
  lastDevice: InputDevice = 'keyboard';
  /** Gameplay keys are captured only while true (menus keep native keyboard behaviour). */
  gameplayActive = false;
  onPauseKey: () => void = () => {};
  onAnyGesture: (device: InputDevice) => void = () => {};
  onDeviceChange: (device: InputDevice) => void = () => {};

  private readonly keys = new Set<string>();
  private touchX = 0;
  private touchY = 0;
  private touchAction = false;
  private readonly listeners: [EventTarget, string, EventListener, AddEventListenerOptions | undefined][] = [];

  attach(): void {
    this.on(window, 'keydown', (e) => this.keyDown(e as KeyboardEvent));
    this.on(window, 'keyup', (e) => this.keyUp(e as KeyboardEvent));
    this.on(window, 'blur', () => this.clear());
    this.on(window, 'pointerdown', (e) => {
      const pe = e as PointerEvent;
      this.setDevice(pe.pointerType === 'touch' || pe.pointerType === 'pen' ? 'touch' : 'mouse');
      this.onAnyGesture(this.lastDevice);
    });
    // Keep gameplay gestures and wheel from scrolling or zooming the host page.
    this.on(window, 'wheel', (e) => e.preventDefault(), { passive: false });
    this.on(document, 'touchmove', (e) => e.preventDefault(), { passive: false });
    this.on(document, 'gesturestart', (e) => e.preventDefault(), { passive: false });
    this.on(document, 'contextmenu', (e) => e.preventDefault());
  }

  detach(): void {
    for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
    this.listeners.length = 0;
    this.clear();
  }

  private on(t: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions): void {
    t.addEventListener(type, fn, opts);
    this.listeners.push([t, type, fn, opts]);
  }

  private setDevice(d: InputDevice): void {
    if (d !== this.lastDevice) {
      this.lastDevice = d;
      this.onDeviceChange(d);
    }
  }

  private keyDown(e: KeyboardEvent): void {
    if (e.code === 'Escape') {
      e.preventDefault();
      if (!e.repeat) this.onPauseKey();
      return;
    }
    const game = e.code in MOVE_KEYS || ACTION_KEYS.has(e.code);
    if (this.gameplayActive && game) {
      // Space/arrows must never scroll the page or activate a focused button during play.
      e.preventDefault();
      this.keys.add(e.code);
      this.setDevice('keyboard');
    } else if (!this.gameplayActive && game && !isTextField(e.target)) {
      // Remember held movement keys so the start gesture can begin moving immediately.
      if (e.code in MOVE_KEYS) this.keys.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) {
        if (!(e.target instanceof HTMLButtonElement) || e.code !== 'Space') e.preventDefault();
      }
    }
    if (!e.repeat) this.onAnyGesture('keyboard');
  }

  private keyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
  }

  /** Called by the touch joystick. */
  setTouchMove(x: number, y: number): void {
    this.touchX = x;
    this.touchY = y;
  }

  setTouchAction(down: boolean): void {
    this.touchAction = down;
  }

  get action(): boolean {
    return this.touchAction || this.keys.has('KeyE') || this.keys.has('Space');
  }

  /** Drop every held input (focus loss, pause, overlays, orientation changes). */
  clear(): void {
    this.keys.clear();
    this.touchX = 0;
    this.touchY = 0;
    this.touchAction = false;
    this.moveX = 0;
    this.moveY = 0;
  }

  /** Clear only the action so a menu click cannot become a gameplay press. */
  clearAction(): void {
    this.keys.delete('KeyE');
    this.keys.delete('Space');
    this.touchAction = false;
  }

  update(): void {
    let x = 0;
    let y = 0;
    for (const k of this.keys) {
      const m = MOVE_KEYS[k];
      if (m) {
        x += m[0];
        y += m[1];
      }
    }
    x = Math.max(-1, Math.min(1, x));
    y = Math.max(-1, Math.min(1, y));
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    if (Math.hypot(this.touchX, this.touchY) > len) {
      x = this.touchX;
      y = this.touchY;
    }
    this.moveX = x;
    this.moveY = y;
  }
}

function isTextField(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
}
