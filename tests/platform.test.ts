import { describe, expect, it } from 'vitest';
import { PauseController } from '../src/platform/PauseController';
import { PlatformSession, PokiAdapter, type PlatformAdapter } from '../src/platform/Platform';

class StubAdapter implements PlatformAdapter {
  readonly name = 'poki' as const;
  calls: string[] = [];
  resolveBreak: (() => void) | null = null;
  rejectBreak: ((e: Error) => void) | null = null;
  async init(): Promise<void> {
    this.calls.push('init');
  }
  gameLoadingFinished(): void {
    this.calls.push('gameLoadingFinished');
  }
  gameplayStart(): void {
    this.calls.push('gameplayStart');
  }
  gameplayStop(): void {
    this.calls.push('gameplayStop');
  }
  commercialBreak(onStart: () => void): Promise<void> {
    this.calls.push('commercialBreak');
    onStart();
    return new Promise((res, rej) => {
      this.resolveBreak = res;
      this.rejectBreak = rej;
    });
  }
}

describe('platform session', () => {
  it('reports loading once and never duplicates gameplay start/stop', () => {
    const a = new StubAdapter();
    const s = new PlatformSession(a);
    s.loadingFinished();
    s.loadingFinished();
    s.setGameplay(true);
    s.setGameplay(true);
    s.setGameplay(false);
    s.setGameplay(false);
    s.setGameplay(true);
    expect(a.calls).toEqual(['gameLoadingFinished', 'gameplayStart', 'gameplayStop', 'gameplayStart']);
  });

  it('stops gameplay before a break and emits nothing during it', async () => {
    const a = new StubAdapter();
    const s = new PlatformSession(a);
    s.setGameplay(true);
    let muted = false;
    const p = s.commercialBreak(() => (muted = true));
    expect(s.inAd).toBe(true);
    expect(muted).toBe(true);
    s.setGameplay(true); // e.g. a stray resume during the ad
    s.setGameplay(false);
    expect(a.calls).toEqual(['gameplayStart', 'gameplayStop', 'commercialBreak']);
    a.resolveBreak!();
    await p;
    expect(s.inAd).toBe(false);
    s.setGameplay(true);
    expect(a.calls.at(-1)).toBe('gameplayStart');
  });

  it('continues after an ad error or a no-ad outcome', async () => {
    const a = new StubAdapter();
    const s = new PlatformSession(a);
    const p = s.commercialBreak();
    a.rejectBreak!(new Error('adblock'));
    await expect(p).resolves.toBeUndefined();
    expect(s.inAd).toBe(false);
    s.setGameplay(true);
    expect(a.calls.at(-1)).toBe('gameplayStart');
  });

  it('ignores a second break request while one is active', async () => {
    const a = new StubAdapter();
    const s = new PlatformSession(a);
    const p1 = s.commercialBreak();
    await s.commercialBreak();
    expect(a.calls.filter((c) => c === 'commercialBreak').length).toBe(1);
    a.resolveBreak!();
    await p1;
  });

  it('the Poki adapter tolerates a missing SDK and a hanging init', async () => {
    const g = globalThis as { PokiSDK?: unknown };
    delete g.PokiSDK;
    const none = new PokiAdapter(50);
    await none.init();
    none.gameplayStart();
    await none.commercialBreak(() => {});
    const calls: string[] = [];
    g.PokiSDK = {
      init: () => new Promise(() => {}), // never resolves
      gameLoadingFinished: () => calls.push('loaded'),
      gameplayStart: () => calls.push('start'),
      gameplayStop: () => calls.push('stop'),
      commercialBreak: (cb: () => void) => {
        cb();
        calls.push('break');
        return Promise.reject(new Error('no fill'));
      },
    };
    const hanging = new PokiAdapter(50);
    const t0 = Date.now();
    await hanging.init();
    expect(Date.now() - t0).toBeLessThan(1000);
    hanging.gameplayStart();
    await hanging.commercialBreak(() => calls.push('mute'));
    expect(calls).toEqual(['start', 'mute', 'break']);
    delete g.PokiSDK;
  });
});

describe('composable pause reasons', () => {
  it('an ad finishing does not override a hidden tab or an open pause menu', () => {
    const p = new PauseController();
    const changes: boolean[] = [];
    p.onChange = (v) => changes.push(v);
    p.add('menu');
    p.add('hidden');
    p.add('ad');
    p.remove('ad');
    expect(p.paused).toBe(true);
    p.remove('hidden');
    expect(p.paused).toBe(true); // the pause menu still needs a deliberate resume
    p.remove('menu');
    expect(p.paused).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('removing a reason that was never added changes nothing', () => {
    const p = new PauseController();
    p.add('hidden');
    p.remove('menu');
    expect(p.paused).toBe(true);
  });
});
