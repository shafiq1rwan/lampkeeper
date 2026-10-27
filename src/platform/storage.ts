// Small versioned save with validation, migration, and in-memory fallback when storage fails.

export interface Settings {
  muted: boolean;
  ambience: number;
  effects: number;
  quality: 'high' | 'low';
  reducedMotion: boolean;
  scare: 'gentle' | 'normal';
  touch: 'auto' | 'on' | 'off';
}

export interface SaveData {
  version: 2;
  completed: number[];
  records: number[];
  tutorialDone: boolean;
  /** Highest tutorial step reached (so retries never replay completed steps). */
  tutorialStep: number;
  replayUnlocked: boolean;
  /** Best lamp rating per shift id. */
  best: Record<string, number>;
  settings: Settings;
}

export const SAVE_KEY = 'lampkeeper.save';
export const SAVE_VERSION = 2;

export function defaultSettings(): Settings {
  return { muted: false, ambience: 0.6, effects: 0.8, quality: 'high', reducedMotion: false, scare: 'normal', touch: 'auto' };
}

export function defaultSave(): SaveData {
  return { version: 2, completed: [], records: [], tutorialDone: false, tutorialStep: 0, replayUnlocked: false, best: {}, settings: defaultSettings() };
}

/** Minimal storage surface so tests can inject failing or fake storage. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const intList = (v: unknown, min: number, max: number): number[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is number => Number.isInteger(x) && x >= min && x <= max))].sort((a, b) => a - b) : [];
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);
const pick = <T extends string>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d);

/** Validate and migrate arbitrary parsed JSON into a SaveData (never throws). */
export function sanitize(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  // v1 stored completed shifts as `shifts` and had no tutorialStep/best.
  const completed = intList(r.completed ?? r.shifts, 1, 5);
  const s = (r.settings && typeof r.settings === 'object' ? r.settings : {}) as Record<string, unknown>;
  const ds = d.settings;
  const best: Record<string, number> = {};
  if (r.best && typeof r.best === 'object') {
    for (const [k, v] of Object.entries(r.best as Record<string, unknown>)) {
      if (/^[0-5]$/.test(k) && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 3) best[k] = v as number;
    }
  }
  return {
    version: 2,
    completed,
    records: intList(r.records, 1, 6),
    tutorialDone: r.tutorialDone === true || completed.includes(1),
    tutorialStep: Number.isInteger(r.tutorialStep) ? Math.max(0, Math.min(10, r.tutorialStep as number)) : 0,
    replayUnlocked: r.replayUnlocked === true || completed.includes(5),
    best,
    settings: {
      muted: s.muted === true,
      ambience: num(s.ambience, ds.ambience),
      effects: num(s.effects, ds.effects),
      quality: pick(s.quality, ['high', 'low'] as const, ds.quality),
      reducedMotion: s.reducedMotion === true,
      scare: pick(s.scare, ['gentle', 'normal'] as const, ds.scare),
      touch: pick(s.touch, ['auto', 'on', 'off'] as const, ds.touch),
    },
  };
}

export class SaveStore {
  data: SaveData;
  /** False when the browser refused storage; progress then lasts for this session only. */
  persistent = true;
  /** True when a stored save was unreadable and had to be reset. */
  recovered = false;

  constructor(private readonly storage: KeyValueStorage | null = safeLocalStorage()) {
    this.data = defaultSave();
    if (!storage) {
      this.persistent = false;
      return;
    }
    try {
      const text = storage.getItem(SAVE_KEY);
      if (text) {
        try {
          this.data = sanitize(JSON.parse(text));
        } catch {
          this.recovered = true;
          this.data = defaultSave();
        }
      }
    } catch {
      this.persistent = false;
    }
  }

  save(): void {
    if (!this.storage || !this.persistent) return;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {
      this.persistent = false;
    }
  }

  completeShift(id: number): void {
    if (id >= 1 && id <= 5 && !this.data.completed.includes(id)) {
      this.data.completed.push(id);
      this.data.completed.sort((a, b) => a - b);
    }
    if (id === 1) this.data.tutorialDone = true;
    if (id === 5) this.data.replayUnlocked = true;
    this.save();
  }

  /** Returns true when the record is new. Found records survive failed attempts. */
  addRecord(id: number): boolean {
    if (this.data.records.includes(id)) return false;
    this.data.records.push(id);
    this.data.records.sort((a, b) => a - b);
    this.save();
    return true;
  }

  /** Highest unlocked story shift. */
  get unlockedShift(): number {
    let n = 1;
    while (n < 5 && this.data.completed.includes(n)) n++;
    return n;
  }
}

function safeLocalStorage(): KeyValueStorage | null {
  try {
    const s = window.localStorage;
    const probe = '__lk_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}
