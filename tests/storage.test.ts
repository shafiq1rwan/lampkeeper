import { describe, expect, it } from 'vitest';
import { SAVE_KEY, SaveStore, sanitize, type KeyValueStorage } from '../src/platform/storage';

class MemStorage implements KeyValueStorage {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

describe('save data', () => {
  it('round-trips progress, records and settings', () => {
    const mem = new MemStorage();
    const a = new SaveStore(mem);
    a.completeShift(1);
    a.addRecord(3);
    a.data.settings.quality = 'low';
    a.save();
    const b = new SaveStore(mem);
    expect(b.data.completed).toEqual([1]);
    expect(b.data.records).toEqual([3]);
    expect(b.data.tutorialDone).toBe(true);
    expect(b.data.settings.quality).toBe('low');
    expect(b.unlockedShift).toBe(2);
  });

  it('resets gracefully on corrupt JSON', () => {
    const mem = new MemStorage();
    mem.setItem(SAVE_KEY, '{not json');
    const s = new SaveStore(mem);
    expect(s.recovered).toBe(true);
    expect(s.data.completed).toEqual([]);
    expect(s.persistent).toBe(true);
  });

  it('sanitises wrong types and out-of-range values', () => {
    const d = sanitize({ completed: [1, 1, 9, 'x', 3], records: [6, 0, 2.5], settings: { ambience: 7, quality: 'ultra', touch: 'on' }, best: { 2: 3, 9: 1, 3: 'x' } });
    expect(d.completed).toEqual([1, 3]);
    expect(d.records).toEqual([6]);
    expect(d.settings.ambience).toBe(1);
    expect(d.settings.quality).toBe('high');
    expect(d.settings.touch).toBe('on');
    expect(d.best).toEqual({ 2: 3 });
  });

  it('migrates the older v1 shape', () => {
    const d = sanitize({ version: 1, shifts: [1, 2, 3, 4, 5], records: [1] });
    expect(d.version).toBe(2);
    expect(d.completed).toEqual([1, 2, 3, 4, 5]);
    expect(d.replayUnlocked).toBe(true);
    expect(d.tutorialDone).toBe(true);
  });

  it('stays playable with session-only progress when storage throws', () => {
    const throwing: KeyValueStorage = {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('SecurityError');
      },
    };
    const s = new SaveStore(throwing);
    expect(s.persistent).toBe(false);
    s.completeShift(1);
    expect(s.addRecord(1)).toBe(true);
    expect(s.data.completed).toEqual([1]);
    expect(s.unlockedShift).toBe(2);
  });

  it('notices when writes start failing (quota) and keeps progress in memory', () => {
    const mem = new MemStorage();
    const s = new SaveStore(mem);
    mem.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    s.addRecord(2);
    expect(s.persistent).toBe(false);
    expect(s.data.records).toEqual([2]);
  });

  it('handles a missing storage object', () => {
    const s = new SaveStore(null);
    expect(s.persistent).toBe(false);
    s.completeShift(5);
    expect(s.data.replayUnlocked).toBe(true);
  });

  it('records found survive a failed attempt (they are saved immediately)', () => {
    const mem = new MemStorage();
    const s = new SaveStore(mem);
    s.addRecord(4); // found mid-run, then the run ends in a capture
    expect(new SaveStore(mem).data.records).toEqual([4]);
    expect(s.addRecord(4)).toBe(false);
  });
});
