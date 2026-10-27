// Composable pause reasons: the game runs only when no reason is active. Clearing one reason
// (e.g. an ad finishing) never overrides another (a hidden tab or an open pause menu).

export type PauseReason = 'menu' | 'hidden' | 'ad' | 'overlay';

export class PauseController {
  private readonly reasons = new Set<PauseReason>();
  onChange: (paused: boolean) => void = () => {};

  add(r: PauseReason): void {
    const was = this.paused;
    this.reasons.add(r);
    if (!was) this.onChange(true);
  }

  remove(r: PauseReason): void {
    const was = this.paused;
    this.reasons.delete(r);
    if (was && !this.paused) this.onChange(false);
  }

  has(r: PauseReason): boolean {
    return this.reasons.has(r);
  }

  get paused(): boolean {
    return this.reasons.size > 0;
  }

  list(): PauseReason[] {
    return [...this.reasons];
  }

  clear(): void {
    const was = this.paused;
    this.reasons.clear();
    if (was) this.onChange(false);
  }
}
