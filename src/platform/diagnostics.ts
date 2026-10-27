// Bounded, local-only diagnostics buffer. Nothing here is ever sent anywhere; it exists to aid
// observation and testing (it is not retention analytics).

export interface DiagEvent {
  t: number;
  type: string;
  data?: Record<string, unknown>;
}

export class Diagnostics {
  private readonly buf: DiagEvent[] = [];
  private readonly t0 = performance.now();

  constructor(private readonly capacity = 200) {}

  log(type: string, data?: Record<string, unknown>): void {
    this.buf.push({ t: Math.round(performance.now() - this.t0), type, data });
    if (this.buf.length > this.capacity) this.buf.shift();
  }

  events(): DiagEvent[] {
    return this.buf.slice();
  }

  count(type: string): number {
    return this.buf.reduce((n, e) => (e.type === type ? n + 1 : n), 0);
  }
}
