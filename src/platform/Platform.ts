// Platform adapter (local or Poki) plus a session wrapper that owns gameplay-event state,
// so start/stop are never duplicated and nothing leaks during an ad request.

export interface PlatformAdapter {
  readonly name: 'local' | 'poki';
  init(): Promise<void>;
  gameLoadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  /** Resolves when the break is over (ad shown, no ad, or error). */
  commercialBreak(onStart: () => void): Promise<void>;
}

/** Local mode: no SDK, no simulated ads. */
export class LocalAdapter implements PlatformAdapter {
  readonly name = 'local' as const;
  async init(): Promise<void> {}
  gameLoadingFinished(): void {}
  gameplayStart(): void {}
  gameplayStop(): void {}
  async commercialBreak(): Promise<void> {}
}

interface PokiSDKLike {
  init(): Promise<unknown>;
  gameLoadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  commercialBreak(onStart?: () => void): Promise<unknown>;
}

/**
 * Poki mode. The SDK is loaded by the official script tag that the Poki build injects into
 * index.html (see vite.config.ts). If it is missing or fails, the game continues without it.
 */
export class PokiAdapter implements PlatformAdapter {
  readonly name = 'poki' as const;
  private sdk: PokiSDKLike | null = null;

  constructor(private readonly timeoutMs = 4000) {}

  async init(): Promise<void> {
    const sdk = (globalThis as { PokiSDK?: PokiSDKLike }).PokiSDK;
    if (!sdk) return;
    try {
      // Never block the game indefinitely on SDK initialisation.
      await Promise.race([sdk.init(), new Promise((resolve) => setTimeout(resolve, this.timeoutMs))]);
      this.sdk = sdk;
    } catch {
      // Poki guidance: continue to the game when init fails (e.g. ad blockers).
      this.sdk = sdk;
    }
  }

  gameLoadingFinished(): void {
    try {
      this.sdk?.gameLoadingFinished();
    } catch {
      /* ignore */
    }
  }

  gameplayStart(): void {
    try {
      this.sdk?.gameplayStart();
    } catch {
      /* ignore */
    }
  }

  gameplayStop(): void {
    try {
      this.sdk?.gameplayStop();
    } catch {
      /* ignore */
    }
  }

  async commercialBreak(onStart: () => void): Promise<void> {
    if (!this.sdk) return;
    try {
      await this.sdk.commercialBreak(onStart);
    } catch {
      /* no-ad and error outcomes both continue */
    }
  }
}

export type PlatformEvent = 'loadingFinished' | 'gameplayStart' | 'gameplayStop' | 'commercialBreak' | 'commercialBreakDone';

export class PlatformSession {
  private gameplay = false;
  private loadingReported = false;
  private adActive = false;
  /** Event log for tests and local diagnostics. */
  readonly log: PlatformEvent[] = [];

  constructor(readonly adapter: PlatformAdapter) {}

  get inAd(): boolean {
    return this.adActive;
  }

  get gameplayActive(): boolean {
    return this.gameplay;
  }

  loadingFinished(): void {
    if (this.loadingReported) return;
    this.loadingReported = true;
    this.log.push('loadingFinished');
    this.adapter.gameLoadingFinished();
  }

  /** Report whether real play is happening. Duplicates are ignored; nothing fires during ads. */
  setGameplay(active: boolean): void {
    if (this.adActive || active === this.gameplay) return;
    this.gameplay = active;
    this.log.push(active ? 'gameplayStart' : 'gameplayStop');
    if (active) this.adapter.gameplayStart();
    else this.adapter.gameplayStop();
  }

  /**
   * Request a commercial break at a natural transition back into play. Gameplay is stopped
   * first; the caller freezes input/simulation and mutes audio until the promise settles.
   */
  async commercialBreak(onStart: () => void = () => {}): Promise<void> {
    if (this.adActive) return;
    this.setGameplay(false);
    this.adActive = true;
    this.log.push('commercialBreak');
    try {
      await this.adapter.commercialBreak(onStart);
    } catch {
      // Error and no-ad outcomes both simply continue the game.
    } finally {
      this.adActive = false;
      this.log.push('commercialBreakDone');
    }
  }
}

export function createAdapter(): PlatformAdapter {
  return import.meta.env.VITE_PLATFORM === 'poki' ? new PokiAdapter() : new LocalAdapter();
}
